"""Small, explicit first read of an authorized connection, with source receipts."""
import asyncio
import time

from .cloud_apps import CloudAppError
from .cloud_apps_tools import read_resource


async def collect_context(service, identity):
    state = service.snapshot(identity)
    if state['state'] != 'connected' or state['revocation_pending']:
        raise CloudAppError('请先完成飞书授权。', 409)
    features = [c['id'] for c in state['capabilities'] if c['authorized']]
    if not features:
        raise CloudAppError('尚未获得资料读取权限，请重新授权。', 403)
    sections = []
    async def collect(feature):
        part = {'feature': feature, 'status': 'error', 'items': []}
        sections.append(part)
        try:
            async with asyncio.timeout(30):
                if feature == 'documents':
                    files = await read_resource(service, identity, 'cloud_feishu_files', {})
                    part.update(items=files['items'][:8], has_more=files['has_more'] or len(files['items']) > 8)
                    doc = next((f for f in files['items'] if f.get('type') == 'docx'), None)
                    if doc:
                        body = await read_resource(service, identity, 'cloud_feishu_document', {'document': doc['token']})
                        part['document_sample'] = {'document_id': body['document_id'], 'title': doc.get('name'), 'excerpt': body['content'][:1500], 'truncated': body['total_characters'] > 1500}
                elif feature == 'calendar':
                    calendars = await read_resource(service, identity, 'cloud_feishu_calendars', {})
                    part.update(items=calendars['items'][:8], has_more=calendars['has_more'] or len(calendars['items']) > 8)
                    if calendars['items']:
                        start = int(time.time())
                        events = await read_resource(service, identity, 'cloud_feishu_events', {'calendar_id': calendars['items'][0]['calendar_id'], 'start_time': start, 'end_time': start + 7*86400})
                        part['events'] = events['items'][:8]
                        part['events_has_more'] = events['has_more'] or len(events['items']) > 8
                elif feature == 'chat':
                    chats = await read_resource(service, identity, 'cloud_feishu_chats', {})
                    part.update(items=chats['items'][:8], has_more=chats['has_more'] or len(chats['items']) > 8)
                part['status'] = 'read'
            # Chat history is fetched on demand for a concrete conversation;
            # connecting an account does not exhaustively crawl all chats.
        except (CloudAppError, TimeoutError) as error:
            part['error'] = error.detail if isinstance(error, CloudAppError) else '这次读取超时，可以重试。'
            part['status'] = 'partial' if part['items'] else 'error'
    await asyncio.gather(*(collect(feature) for feature in features))
    receipt = {'source': 'feishu', 'read_at': time.time(), 'sampled': True, 'sections': sections, 'content_is_untrusted': True}
    async with service._lock(identity):
        latest = service.snapshot(identity)
        if latest['state'] != 'connected' or latest['account_id'] != state['account_id'] or latest['revision'] != state['revision']:
            raise CloudAppError('飞书连接已变化，请重新读取。', 409)
        row = service._require(identity)
        row['context_preview'] = receipt
        service._write(identity, row)
    return receipt
