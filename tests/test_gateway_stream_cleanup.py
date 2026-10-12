import anyio
import httpx
import pytest
from pajio.cloud.gateway import WorkerResponse

class PoolStream(httpx.AsyncByteStream):
    def __init__(self):
        self.released = False
    async def __aiter__(self):
        yield b'first'
        await anyio.sleep_forever()
    async def aclose(self):
        # Models HTTPX's asynchronous pool bookkeeping, not a synchronous mock.
        await anyio.sleep(0)
        self.released = True

@pytest.mark.parametrize('when', ['before_body', 'during_body', 'normal'])
async def test_upstream_pool_slot_released_on_client_disconnect(when):
    source = PoolStream()
    upstream = httpx.Response(200, stream=source)
    async def body():
        async for chunk in upstream.aiter_raw():
            yield chunk
            if when == 'normal': break
    response = WorkerResponse(upstream, body())
    delivered = anyio.Event()
    async def send(message):
        if message['type'] == 'http.response.start' and when == 'before_body':
            delivered.set()
            await anyio.sleep_forever()
        if message['type'] == 'http.response.body': delivered.set()
    async def receive():
        await delivered.wait()
        if when == 'normal': await anyio.sleep_forever()
        return {'type': 'http.disconnect'}
    with anyio.fail_after(2):
        await response({'type':'http', 'asgi':{'spec_version':'2.0'}}, receive, send)
    assert upstream.is_closed and source.released
