"""First-party native password entry. Provider credentials never enter Agent Core.

Uses a separate confidential Keycloak Direct Grant client, disabled unless
explicitly configured. Keycloak retains password, OTP and lockout validation;
this endpoint cannot provision identities or grant memberships.
"""
from datetime import datetime, timezone
import hashlib
import hmac
import json
import re
import time

import httpx
from sqlalchemy import delete, insert, select
from starlette.responses import JSONResponse
from starlette.routing import Route

from .control import ControlError, digest, states
from .native_enrollment import unique_object

from .session_policy import DEVICE_SESSION_SECONDS


def session_response(store, sid):
    current = store.session(sid)
    if current is None:
        raise ControlError('登录未完成。')
    return JSONResponse({'access_token': sid, 'token_type': 'Bearer', 'user_id': current.user_id,
                         'tenant_id': current.tenant_id,
                         'expires_at': datetime.fromtimestamp(current.expires, timezone.utc).isoformat()},
                        headers={'Cache-Control': 'no-store'})


class NativeLogin:
    def __init__(self, config, store, *, transport=None):
        self.config, self.store, self.transport = config, store, transport

    def _rate(self, request, username):
        now = int(time.time())
        source = request.client.host if request.client else 'unknown'
        for label, value, maximum in [('source', source, 30), ('account', username, 8)]:
            hashed = hmac.new(self.config.session_key.get_secret_value().encode(), value.encode(), hashlib.sha256).hexdigest()
            key = digest('native-login:' + label + ':' + hashed)
            with self.store.transaction(mutating=True, state_hash=key) as db:
                row = db.execute(select(states).where(states.c.id_hash == key)).mappings().first()
                active = row and row['expires'] > now
                count = int(row['value']) if active else 0
                if count >= maximum:
                    return False
                db.execute(delete(states).where(states.c.id_hash == key))
                db.execute(insert(states).values(id_hash=key, value=str(count+1), expires=row['expires'] if active else now+60))
        return True

    @staticmethod
    def error(code, status):
        return JSONResponse({'code': code}, status_code=status, headers={'Cache-Control': 'no-store'})

    async def login(self, request):
        if not self.config.native_client_secret.get_secret_value():
            return self.error('login_unavailable', 503)
        if (request.scope.get('query_string') or request.headers.getlist('origin') not in ([], [self.config.public_origin])
                or request.headers.getlist('content-type') not in (['application/json'], ['application/json; charset=utf-8'])):
            return self.error('invalid_request', 400)
        raw = await request.body()
        if len(raw) > 4096:
            return self.error('invalid_request', 413)
        try:
            value = json.loads(raw, object_pairs_hook=unique_object)
            if not isinstance(value, dict) or set(value) not in ({'username','password'}, {'username','password','otp'}):
                raise ValueError()
            username, password = value['username'], value['password']
            if (not isinstance(username,str) or not re.fullmatch(r'[a-z][a-z0-9_.-]{3,31}', username)
                    or not isinstance(password,str) or not 1 <= len(password) <= 128
                    or 'otp' in value and (not isinstance(value['otp'], str) or not re.fullmatch(r'[0-9]{6,8}', value['otp']))):
                raise ValueError()
        except (ValueError, KeyError, TypeError):
            return self.error('invalid_credentials', 401)
        if not self._rate(request, username):
            return self.error('rate_limited', 429)
        token_base = self.config.issuer + '/protocol/openid-connect/'
        # Endpoints are derived from operator configuration, never from user input.
        try:
            async with httpx.AsyncClient(transport=self.transport, trust_env=False, follow_redirects=False,
                                         timeout=12) as wire:
                response = await wire.post(token_base+'token', data={
                    'grant_type':'password', 'client_id':self.config.native_client_id,
                    'client_secret':self.config.native_client_secret.get_secret_value(),
                    'scope':'openid', 'username':username, 'password':password,
                    **({'totp':value['otp']} if 'otp' in value else {})})
                if response.status_code in (400,401):
                    return self.error('invalid_credentials', 401)
                if response.status_code != 200 or len(response.content) > 65536:
                    return self.error('login_unavailable', 503)
                token = response.json()
                if not isinstance(token, dict) or token.get('token_type') not in ('Bearer', 'bearer') or not isinstance(token.get('access_token'),str) or not token['access_token']:
                    return self.error('login_unavailable', 503)
                info = await wire.get(token_base+'userinfo',headers={'Authorization':'Bearer '+token['access_token']})
                if info.status_code != 200 or len(info.content)>16384:
                    return self.error('login_unavailable', 503)
                profile = info.json()
                subject = profile.get('sub') if isinstance(profile, dict) else None
                if not isinstance(subject,str) or not re.fullmatch(r'[a-zA-Z0-9_-]{1,128}',subject):
                    return self.error('login_unavailable', 503)
            # Only existing, active invitation memberships can open a device session.
            sid = self.store.login(self.config.issuer, subject, lifetime=DEVICE_SESSION_SECONDS, auth_time=int(time.time()))
            return session_response(self.store, sid)
        except ControlError:
            return self.error('account_unavailable', 403)
        except (httpx.HTTPError, ValueError, TypeError):
            return self.error('login_unavailable', 503)

    def routes(self):
        return [Route('/auth/mobile/login', self.login, methods=['POST'])]
