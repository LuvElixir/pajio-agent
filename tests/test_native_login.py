import json
import time
from urllib.parse import parse_qs
import httpx
import pytest
from starlette.applications import Starlette
from wearing.cloud.control import ControlStore
from wearing.cloud.gateway import GatewayConfig
from wearing.cloud.native_login import NativeLogin, DEVICE_SESSION_SECONDS

@pytest.fixture
def native(tmp_path):
    store=ControlStore('sqlite:///'+str(tmp_path/'control.db'),initialize=True)
    cfg=GatewayConfig(public_origin='https://pajio.example',issuer='https://identity.example/realms/pajio',client_id='web',native_client_secret='server-only-test',session_key='x'*48,database_url='sqlite:///'+str(tmp_path/'control.db'),development=True)
    store.grant(cfg.issuer,'alice-subject','tenant_A')
    yield cfg,store
    store.close()

async def client_for(cfg,store,handler):
    route=NativeLogin(cfg,store,transport=httpx.MockTransport(handler))
    return httpx.AsyncClient(transport=httpx.ASGITransport(Starlette(routes=route.routes())),base_url=cfg.public_origin)

async def test_native_login_exchanges_only_with_fixed_provider_and_revokes(native):
    cfg,store=native;calls=[]
    def provider(r):
        calls.append(r)
        assert r.url.host=='identity.example'
        if r.url.path.endswith('/token'):
            form=parse_qs(r.content.decode());assert form=={'grant_type':['password'],'client_id':['pajio-native'],'client_secret':['server-only-test'],'scope':['openid'],'username':['alice'],'password':['test-password'],'totp':['123456']}
            return httpx.Response(200,json={'access_token':'provider-secret','token_type':'Bearer','refresh_token':'never-retained'})
        assert r.url.path.endswith('/userinfo') and r.headers['authorization']=='Bearer provider-secret'
        return httpx.Response(200,json={'sub':'alice-subject'})
    async with await client_for(cfg,store,provider) as c:
        r=await c.post('/auth/mobile/login',json={'username':'alice','password':'test-password','otp':'123456'})
        assert r.status_code==200 and r.headers['cache-control']=='no-store'
        assert 'provider-secret' not in r.text and 'test-password' not in r.text and 'never-retained' not in r.text
        session=store.session(r.json()['access_token']);assert session.tenant_id=='tenant_A'
        assert abs(session.expires-time.time()-DEVICE_SESSION_SECONDS)<2
        assert abs(session.auth_time-time.time())<2
        store.logout(r.json()['access_token']);assert store.session(r.json()['access_token']) is None
        assert len(calls)==2

@pytest.mark.parametrize('failure',['bad_password','required_action','disabled','malformed_token','malformed_profile','uninvited','network','redirect'])
async def test_login_fails_closed_without_provisioning_or_sensitive_errors(native,failure):
    cfg,store=native
    def provider(r):
        if failure=='network':raise httpx.ConnectError('private-provider-detail')
        if failure in ('bad_password','required_action','disabled'):return httpx.Response(400,json={'error_description':'private-provider-detail'})
        if failure=='redirect':return httpx.Response(302,headers={'Location':'https://foreign.example/'})
        if r.url.path.endswith('/token'):return httpx.Response(200,json=[] if failure=='malformed_token' else {'access_token':'provider-secret','token_type':'bearer'})
        return httpx.Response(200,json=[] if failure=='malformed_profile' else {'sub':'uninvited'})
    async with await client_for(cfg,store,provider) as c:
        r=await c.post('/auth/mobile/login',json={'username':'alice','password':'test-password'})
        assert r.status_code in (401,403,503) and 'private-provider-detail' not in r.text and 'access_token' not in r.text

async def test_rate_and_origin_body_limits_without_provider_access(native):
    cfg,store=native;calls=[]
    def provider(r):calls.append(r);return httpx.Response(400,json={})
    async with await client_for(cfg,store,provider) as c:
        for headers,body in [({'Origin':'https://foreign.example'}, {'username':'alice','password':'test'}),({}, {'username':'alice','password':'x'*4097}),({}, {'username':'alice','password':'test','otp':123456})]:
            assert (await c.post('/auth/mobile/login',json=body,headers=headers)).status_code in (400,401,413)
        assert calls==[]
        for _ in range(8):assert (await c.post('/auth/mobile/login',json={'username':'alice','password':'test'})).status_code==401
        assert (await c.post('/auth/mobile/login',json={'username':'alice','password':'test'})).status_code==429
        assert len(calls)==8
