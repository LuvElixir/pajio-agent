"""Keyset windows for native chat. Visibility is checked before pagination."""
import base64
import json
from fastapi import HTTPException
from .task_visibility import predicate


def cursor(row, identity, owner):
    return base64.urlsafe_b64encode(json.dumps([identity, owner, row['created_at'], str(row['id'])], separators=(',', ':')).encode()).decode().rstrip('=')


def select_page(store, identity, owner, limit, before=None, after=None, watch=''):
    if not 1 <= limit <= 80 or before and after:
        raise HTTPException(422, '聊天分页参数无效。')
    boundary = None
    if before or after:
        try:
            raw = before or after
            if len(raw) > 2048:
                raise ValueError()
            value = json.loads(base64.urlsafe_b64decode(raw + '=' * (-len(raw) % 4)))
            if not isinstance(value, list) or len(value) != 4 or value[:2] != [identity, owner] or not all(isinstance(x, str) for x in value):
                raise ValueError()
            boundary = value[2:]
        except Exception:
            raise HTTPException(422, '聊天分页已失效，请重新打开。') from None
    watched = watch.split(',') if watch else []
    import re
    if len(watched) > 80 or any(not re.fullmatch('[a-f0-9]{32}', value) for value in watched):
        raise HTTPException(422, '聊天更新参数无效。')
    query = """WITH feed AS (
      SELECT CAST(m.id AS TEXT) AS id,m.task_id,m.created_at FROM messages m
      UNION ALL SELECT 'goal-'||g.task_id,g.task_id,g.created_at FROM goal_steps g
      UNION ALL SELECT 'schedule-'||o.task_id,o.task_id,o.created_at FROM schedule_occurrences o
        JOIN tasks st ON st.id=o.task_id
        WHERE o.task_id IS NOT NULL AND o.status!='silent' AND trim(st.output)!='[SILENT]'
          AND json_extract(o.spec,'$.goal_id') IS NULL
    ) SELECT f.* FROM feed f JOIN tasks t ON t.id=f.task_id
      WHERE t.identity_id=:identity AND """ + predicate('t.id')
    params = {'identity': identity, 'task_owner': owner, 'count': limit + 1}
    where = ''
    if boundary:
        params.update(stamp=boundary[0], row_id=boundary[1])
        where = ' AND (f.created_at,f.id) ' + ('<' if before else '>') + ' (:stamp,:row_id)'
    direction = 'ASC' if after else 'DESC'
    with store.connection() as db:
        rows = [dict(row) for row in db.execute(query + where + f' ORDER BY f.created_at {direction},f.id {direction} LIMIT :count', params)]
        updates = []
        if watched and not before:
            slots = ','.join('?' for _ in watched)
            updates = [dict(row) for row in db.execute(query.replace(':identity','?').replace(':task_owner','?') + f' AND f.task_id IN ({slots})', [identity, owner, *watched])]
    more = len(rows) > limit
    rows = rows[:limit]
    ordered = sorted(rows, key=lambda row: (row['created_at'], row['id']))
    return {'ids': {r['task_id'] for r in rows + updates}, 'next_cursor': cursor(ordered[0], identity, owner) if more and not after else None,
            'latest_cursor': cursor(ordered[-1], identity, owner) if ordered else after,
            'has_more': more, 'direction': 'after' if after else 'before'}
