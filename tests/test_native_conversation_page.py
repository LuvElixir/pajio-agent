import httpx
import pytest
from pajio.app import create_app
from pajio.config import Settings
from pajio.cloud.worker import TenantBoundary

A, B = 'a' * 64, 'b' * 64

async def test_keyset_windows_watch_and_owner_boundary(tmp_path):
    app = create_app(Settings(tmp_path), engine_autostart=False, local_devices=False)
    app.add_middleware(TenantBoundary, tenant_id='fixture', gateway_key='fixture-internal')
    store = app.state.activity.store
    tasks=[]
    for i in range(105):
        task=store.create_message('synthetic '+str(i))
        with store.connection() as db:
            store.bind_task_principal(db, task['id'], A)
            # Equal timestamps deliberately exercise the lexical id tie breaker.
            db.execute("UPDATE messages SET created_at='2026-10-12T00:00:00+00:00' WHERE task_id=?", (task['id'],))
        store.update(task['id'],status='completed_unverified',output='fixture response')
        tasks.append(task['id'])
    foreign=store.create_message('private other owner')
    with store.connection() as db: store.bind_task_principal(db,foreign['id'],B)
    headers={'Authorization':'Bearer fixture-internal','X-Pajio-Tenant':'fixture','X-Pajio-Storage-Scope':A}
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://testserver',headers=headers) as client:
        old=(await client.get('/api/conversation')).json()
        assert len(old)==105
        data=(await client.get('/api/conversation?limit=40')).json()
        assert len(data['items'])==40 and data['has_more']
        assert data['items']==old[-40:]
        head=data['latest_cursor'];seen={m['id'] for m in data['items']}
        while data['next_cursor']:
            data=(await client.get('/api/conversation',params={'limit':40,'before':data['next_cursor']})).json()
            assert not seen & {m['id'] for m in data['items']}
            seen.update(m['id'] for m in data['items'])
        assert seen=={m['id'] for m in old}
        store.update(tasks[0],status='running',output='new streaming text')
        data=(await client.get('/api/conversation',params={'limit':40,'after':head,'watch':tasks[0]+','+foreign['id']})).json()
        assert [m['task_id'] for m in data['items']]==[tasks[0]]
        assert data['items'][0]['turn']['output']=='new streaming text'
        assert data['latest_cursor']==head and not data['has_more']
        assert (await client.get('/api/conversation',params={'limit':40,'before':head,'after':head})).status_code==422
        assert (await client.get('/api/conversation?limit=0')).status_code==422
        client.headers['X-Pajio-Storage-Scope']=B
        assert (await client.get('/api/conversation',params={'limit':40,'before':head})).status_code==422
        assert [m['task_id'] for m in (await client.get('/api/conversation?limit=40')).json()['items']]==[foreign['id']]
    await app.state.service.hermes.close()

async def test_only_page_tasks_are_hydrated_and_delta_has_no_gap(tmp_path):
    app=create_app(Settings(tmp_path),engine_autostart=False)
    store=app.state.activity.store
    for i in range(90):store.create_message('history '+str(i))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://testserver') as client:
        count=[]; original=app.state.service.require
        def counted(task_id):count.append(task_id);return original(task_id)
        app.state.service.require=counted
        first=(await client.get('/api/conversation?limit=20')).json()
        assert len(count)==20
        for i in range(45):store.create_message('new '+str(i))
        cursor=first['latest_cursor'];seen=set()
        while True:
            page=(await client.get('/api/conversation',params={'limit':20,'after':cursor})).json()
            assert not seen & {m['id'] for m in page['items']}
            seen.update(m['id'] for m in page['items']);cursor=page['latest_cursor']
            if not page['has_more']:break
        assert len(seen)==45
    await app.state.service.hermes.close()
