import test from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {remoteViewerDocument} from './remote-viewer-document';
import {remoteTextIssue, type RemoteTextCapabilities} from './remote-text-input';

type Message = Record<string, unknown>;
type Handler = (value?: unknown) => void;
async function harness(pointer = false) {
  const sent: Message[] = [], posted: Message[] = [], events: Record<string, Handler> = {}, page: Record<string, Handler> = {};
  let stamp = 1_000_000, frameCallback: (() => void) | null = null, closed = false, remoteDescriptions = 0;
  const intervals = new Map<number, () => void>(), shade = {style: {display: 'block'}}, cursor = {style: {}}, timeouts = new Map<number, () => void>();
  const rect = {left: 0, top: 0, width: 320, height: 400};
  const video = {style: {transform: ''}, videoWidth: 1080, videoHeight: 1920, srcObject: null, pause() {}, play: async () => {},
    addEventListener: (key: string, fn: Handler) => {events[key] = fn;},
    requestVideoFrameCallback: (fn: () => void) => {frameCallback = fn;}, setPointerCapture() {},
    getBoundingClientRect: () => rect};
  const channel = {readyState: 'open', bufferedAmount: 0, onopen: () => {}, onclose: () => {}, onerror: () => {}, onmessage: (_: {data: string}) => {},
    send: (text: string) => {sent.push(JSON.parse(text));}, close: () => {closed = true;}};
  class Peer {
    iceGatheringState = 'complete'; localDescription = {sdp: 'v=0\r\n'}; connectionState = 'connected';
    addTransceiver() {} createDataChannel() {return channel;} close() {closed = true;}
    createOffer = async () => this.localDescription; setLocalDescription = async () => {};
    setRemoteDescription = async () => {remoteDescriptions++;}; getStats = async () => new Map();
  }
  const bridge = {ReactNativeWebView: {postMessage: (text: string) => {posted.push(JSON.parse(text));}},
    addEventListener: (name: string, fn: Handler) => {page[name] = fn;}, pajioReceive: async (_: Message) => {}};
  const doc = {hidden: false, getElementById: (id: string) => id === 'screen' || id === 'viewport' ? video : id === 'cursor' ? cursor : shade,
    addEventListener: (name: string, fn: Handler) => {page[name] = fn;}};
  const html = remoteViewerDocument({kind: 'webrtc', session_id: 'human_one', epoch: 3, gateway_epoch: 7, ice_servers: []}, pointer ? 'computer' : 'android', 1600);
  const script = html.slice(html.indexOf('<script>') + 8, html.indexOf('</script>'));
  runInNewContext(script, {window: bridge, document: doc, RTCPeerConnection: Peer, TextEncoder, Date: {now: () => stamp},
    setInterval: (fn: () => void, ms: number) => {intervals.set(ms, fn); return ms;}, clearInterval: (ms: number) => intervals.delete(ms),
    setTimeout: (fn: () => void, ms: number) => {timeouts.set(ms, fn); return ms;}, clearTimeout: (ms: number) => timeouts.delete(ms), console});
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  channel.onopen();
  const fromHost = (value: Message) => channel.onmessage({data: JSON.stringify(value)});
  const scope = {session_id: 'human_one', epoch: 3, gateway_epoch: 7};
  const ready = (text = pointer ? 'unicode' : 'ascii', limits: Message = {}) => fromHost({type: 'ready', ...scope, capabilities: {pointer, keyboard: true, text, touch: true, ...limits}});
  const frame = (values: Message = {}) => {
    fromHost({type: 'frame', frame_id: 'frame_a', width: 1080, height: 1920, gateway_epoch: 7, ...values});
    events.loadeddata(); frameCallback?.();
  };
  const touch = (type: string, x = 160, y = 200, id = 1) => events[type]({pointerId: id, clientX: x, clientY: y, button: 0, preventDefault() {}});
  return {sent, posted, ready, frame, touch, fromHost, video, shade, scope,
    decodedFrame: () => frameCallback?.(), hold: () => {stamp += 420; timeouts.get(420)?.();}, cursor, rect,
    resize: () => page.resize(),
    native: bridge.pajioReceive, inputs: () => sent.filter(m => m.type === 'input'), isClosed: () => closed, descriptions: () => remoteDescriptions,
    wheel: () => events.wheel({deltaX: 4, deltaY: 80, preventDefault() {}}),
    tick: (ms: number) => {stamp += ms; intervals.get(300)?.();}, hide: () => {doc.hidden = true; page.visibilitychange();}, heartbeat: () => intervals.get(5000)?.()};
}
test('viewer waits for device ACK and decoded video; opening viewer does not enable input', async () => {
  const h = await harness(); h.frame(); assert.equal(h.posted.some(m => m.type === 'live'), false);
  h.ready(); h.frame(); assert.equal(h.posted.filter(m => m.type === 'live').length, 1);
  h.touch('pointerdown'); h.touch('pointerup'); assert.equal(h.inputs().length, 0);
  await h.native({type: 'control', enabled: true}); h.touch('pointerdown'); h.touch('pointerup');
  assert.equal(h.inputs().length, 1);
  assert.deepEqual(h.inputs()[0], {type: 'input', ...h.scope, seq: 1, frame_id: 'frame_a', action: 'tap', x: 540, y: 960});
});

test('brief idle video loss hides the picture and recovers as view-only without replay', async () => {
  const h = await harness(true); h.ready(); h.frame(); await h.native({type: 'control', enabled: true});
  h.tick(3100);
  assert.equal(h.isClosed(), false); assert.equal(h.posted.at(-1)?.type, 'buffering');
  assert.equal(h.shade.style.display, 'block');
  await h.native({type: 'control', enabled: true});
  await h.native({type: 'text', text: 'DO_NOT_REPLAY'});
  h.touch('pointerdown'); h.touch('pointerup'); assert.equal(h.inputs().length, 0);
  h.decodedFrame(); assert.equal(h.shade.style.display, 'block'); // metadata is still stale
  h.frame(); assert.equal(h.shade.style.display, 'none');
  h.touch('pointerdown'); h.touch('pointerup'); assert.equal(h.inputs().length, 0);
  await h.native({type: 'control', enabled: true}); h.touch('pointerdown'); h.touch('pointerup');
  assert.equal(h.inputs().length, 2); assert.equal(JSON.stringify(h.posted).includes('DO_NOT_REPLAY'), false);
});

test('persistent video loss and interrupted held gestures still fail closed', async () => {
  const h = await harness(); h.ready(); h.frame(); h.tick(3100); h.tick(10001);
  assert.equal(h.isClosed(), true); assert.equal(h.posted.at(-1)?.reason, 'stale_video');
  const held = await harness(true); held.ready(); held.frame(); await held.native({type: 'control', enabled: true});
  held.touch('pointerdown'); held.hold(); held.fromHost({type: 'input_ack', seq: 1}); held.tick(3100);
  assert.equal(held.isClosed(), true); assert.equal(held.posted.at(-1)?.reason, 'stale_video');
});
test('private input is never queued or replayed after an unacknowledged action', async () => {
  const h = await harness(); h.ready(); h.frame(); await h.native({type: 'control', enabled: true});
  h.touch('pointerdown'); h.touch('pointerup'); assert.equal(h.inputs().length, 1);
  h.tick(2600); assert.equal(h.isClosed(), true);
  await h.native({type: 'text', text: 'secret'}); h.touch('pointerdown'); h.touch('pointerup');
  assert.equal(h.inputs().length, 1); assert.equal(h.video.srcObject, null);
});
test('Android slow drags stay inside the device swipe duration contract without replay', async () => {
  for (const elapsed of [1000, 1200, 1500]) {
    const h = await harness(); h.ready(); h.frame(); await h.native({type: 'control', enabled: true});
    h.touch('pointerdown', 160, 150); h.tick(elapsed); h.touch('pointerup', 160, 250);
    assert.equal(h.inputs().length, 1);
    assert.equal(h.inputs()[0].action, 'swipe');
    assert.equal(h.inputs()[0].duration_ms, 1000);
    assert.equal(h.inputs()[0].x, 540); assert.equal(h.inputs()[0].y, 720);
    assert.equal(h.inputs()[0].to_x, 540); assert.equal(h.inputs()[0].to_y, 1200);
    h.frame(); h.heartbeat(); assert.equal(h.inputs().length, 1);
  }
});
test('actual viewer denies touch, pointer, scroll and native key/text bridge unless their capability is exactly true', async () => {
  for (const denied of [false, undefined, null, 0, 1, 'true', {}, []]) {
    const h = await harness(); h.ready('unicode', {pointer: denied, touch: denied, scroll: denied, keyboard: denied});
    h.frame(); await h.native({type: 'control', enabled: true});
    h.touch('pointerdown'); h.touch('pointermove', 160, 220); h.touch('pointerup', 160, 250); h.wheel();
    await h.native({type: 'key', key: 'Home'}); await h.native({type: 'text', text: 'SYNTHETIC'});
    assert.equal(h.inputs().length, 0); assert.equal(h.isClosed(), false);
    assert.equal(JSON.stringify(h.posted).includes('SYNTHETIC'), false);
    h.frame(); h.heartbeat(); assert.equal(h.inputs().length, 0);
  }
});
test('each negotiated input capability independently enables only its corresponding actions', async () => {
  for (const capability of ['touch', 'pointer', 'scroll', 'keyboard']) {
    const h = await harness(); h.ready('unicode', {pointer: false, touch: false, scroll: false, keyboard: false, [capability]: true});
    h.frame(); await h.native({type: 'control', enabled: true});
    h.touch('pointerdown'); h.touch('pointerup'); h.wheel();
    await h.native({type: 'key', key: 'Enter'}); await h.native({type: 'text', text: 'SYNTHETIC'});
    const expected = {touch: ['tap'], pointer: ['pointer', 'pointer'], scroll: ['scroll'], keyboard: ['key', 'key', 'text']}[capability];
    assert.deepEqual(h.inputs().map(value => value.action), expected);
  }
});
test('background immediately destroys private view and ignores late signaling', async () => {
  const h = await harness(); h.ready(); h.frame(); await h.native({type: 'control', enabled: true}); h.hide();
  assert.equal(h.isClosed(), true); assert.equal(h.shade.style.display, 'block');
  await h.native({type: 'answer', gateway_epoch: 7, sdp: 'v=0\r\n'});
  h.fromHost({type: 'ready', ...h.scope}); h.heartbeat();
  assert.equal(h.descriptions(), 0); assert.equal(h.inputs().length, 0);
  assert.equal(h.posted.filter(m => m.type === 'stopped').length, 1);
});
test('rotated video and stale metadata never map touches against another geometry', async () => {
  const h = await harness(true); h.ready(); h.frame(); await h.native({type: 'control', enabled: true});
  h.touch('pointerdown', 0, 200); assert.equal(h.inputs().length, 0);
  h.tick(1900); h.touch('pointerdown'); assert.equal(h.inputs().length, 0);
  h.frame(); h.touch('pointerdown'); h.hold(); assert.equal(h.inputs().length, 1);
  h.frame({width: 1920, height: 1080}); h.touch('pointerup');
  assert.equal(h.isClosed(), true); assert.equal(h.inputs().length, 1);
});
test('Android rejects unsupported text without echoing it and freeze prevents input but keeps heartbeat', async () => {
  const h = await harness(); h.ready(); h.frame(); await h.native({type: 'control', enabled: true});
  await h.native({type: 'text', text: '秘密%123'});
  assert.equal(h.inputs().length, 0); assert.equal(JSON.stringify(h.posted).includes('秘密'), false);
  await h.native({type: 'freeze'}); await h.native({type: 'text', text: 'secret'}); h.heartbeat();
  assert.equal(h.inputs().length, 0); assert.equal(h.isClosed(), false); assert.equal(h.shade.style.display, 'block');
  assert.equal(h.sent.filter(m => m.type === 'heartbeat').length, 2);
});
test('wrong gateway epoch fails closed before displaying a frame', async () => {
  const h = await harness(); h.fromHost({type: 'ready', ...h.scope, gateway_epoch: 8}); h.frame();
  assert.equal(h.isClosed(), true); assert.equal(h.posted.some(m => m.type === 'live'), false);
});
test('legacy adb ASCII and unavailable text capabilities cannot receive private text', async () => {
  for (const capability of ['ascii', 'unavailable', 'unexpected']) {
    const h = await harness(); h.ready(capability); h.frame(); await h.native({type: 'control', enabled: true});
    await h.native({type: 'text', text: 'Private123'});
    assert.equal(h.inputs().length, 0);
    assert.equal(h.posted.at(-1)?.code, 'text_unavailable');
    assert.equal(JSON.stringify(h.posted).includes('Private123'), false);
  }
});
test('actual viewer enforces the same negotiated code-point and byte limits before data-channel transmission', async () => {
  const cases: {text: string; limits: RemoteTextCapabilities}[] = [
    {text: '😀'.repeat(64), limits: {text_max_chars: 64, text_max_bytes: 4096}},
    {text: '😀'.repeat(65), limits: {text_max_chars: 64, text_max_bytes: 4096}},
    {text: 'e\u0301'.repeat(33), limits: {text_max_chars: 64, text_max_bytes: 4096}},
    {text: '😀'.repeat(1024), limits: {text_max_chars: 4096, text_max_bytes: 4096}},
    {text: '😀'.repeat(1025), limits: {text_max_chars: 4096, text_max_bytes: 4096}},
    {text: '中a', limits: {text_max_chars: 64, text_max_bytes: 3}},
    {text: 'private\ud800text', limits: {text_max_chars: 4096, text_max_bytes: 4096}},
    {text: 'private\nline', limits: {text_max_chars: 32, text_disallow_controls: true}},
    {text: 'private\nline', limits: {text_max_chars: 4096}},
    {text: 'private\u007fline', limits: {text_disallow_controls: true}},
    {text: '😀'.repeat(32), limits: {}},
    {text: '😀'.repeat(33), limits: {}},
    {text: 'x'.repeat(65), limits: {text_max_chars: -1}},
  ];
  for (const sample of cases) {
    const h = await harness(true); h.ready('unicode', sample.limits); h.frame(); await h.native({type: 'control', enabled: true});
    const issue = remoteTextIssue(sample.text, {text: 'unicode', ...sample.limits});
    await h.native({type: 'text', text: sample.text});
    if (issue) {
      assert.equal(h.inputs().length, 0); assert.equal(h.posted.at(-1)?.code, issue);
      assert.equal(JSON.stringify(h.posted).includes(sample.text), false);
      h.frame(); h.heartbeat(); assert.equal(h.inputs().length, 0); // no delayed segmentation/replay
    } else {
      assert.equal(h.inputs().length, 1); assert.equal(h.inputs()[0].text, sample.text);
    }
  }
});
test('actual viewer preserves old Android limits using trusted native configuration, not host-controlled kind', async () => {
  for (const pointer of [false, true]) {
    for (const text of ['x'.repeat(33), 'x'.repeat(4096), '😀'.repeat(1024), '😀'.repeat(1025)]) {
      const h = await harness(pointer); h.ready('unicode', {device_kind: pointer ? 'android' : 'computer'}); h.frame(); await h.native({type: 'control', enabled: true});
      const issue = remoteTextIssue(text, {text: 'unicode'}, pointer ? 'computer' : 'android');
      await h.native({type: 'text', text});
      assert.equal(h.inputs().length, issue ? 0 : 1);
      if (issue) assert.equal(h.posted.at(-1)?.code, issue);
      else assert.equal(h.inputs()[0].text, text);
    }
  }
});

test('native scroll controls require live control and scroll capability, clamp deltas and stop after freeze', async () => {
  const h = await harness(true); h.ready('unicode', {scroll: true}); h.frame();
  await h.native({type: 'scroll', delta_y: 320}); assert.equal(h.inputs().length, 0);
  await h.native({type: 'control', enabled: true});
  for (const delta_y of [NaN, Infinity, '320', null]) await h.native({type: 'scroll', delta_y});
  assert.equal(h.inputs().length, 0);
  await h.native({type: 'scroll', delta_y: 3000});
  assert.equal(h.inputs()[0].action, 'scroll'); assert.equal(h.inputs()[0].delta_y, 1000);
  await h.native({type: 'freeze'}); await h.native({type: 'scroll', delta_y: -320}); assert.equal(h.inputs().length, 1);
  const denied = await harness(true); denied.ready('unicode', {scroll: false}); denied.frame();
  await denied.native({type: 'control', enabled: true}); await denied.native({type: 'scroll', delta_y: 320}); assert.equal(denied.inputs().length, 0);
});

test('pinch zoom and two-finger pan are local even during control and cannot accidentally click', async () => {
  for (const computer of [true, false]) {
    const h = await harness(computer); h.ready(); h.frame(); await h.native({type: 'control', enabled: true});
    h.touch('pointerdown', 140, 200, 1); h.touch('pointerdown', 180, 200, 2);
    h.touch('pointermove', 220, 200, 2); // 2x, centred around the fingers
    h.touch('pointerup', 220, 200, 2); h.touch('pointermove', 160, 190, 1); h.touch('pointerup', 160, 190, 1);
    assert.equal(h.isClosed(), false); assert.equal(h.inputs().length, 0);
    assert.equal(h.posted.findLast(m => m.type === 'viewport')?.zoom, 200);
    assert.match(h.video.style.transform, /scale\(2\)/);
    await h.native({type: 'viewport', reset: true}); assert.match(h.video.style.transform, /scale\(1\)/);
  }
});
test('zoomed direct touches use inverse image transform, not unzoomed letterboxing', async () => {
  const h = await harness(); h.ready(); h.frame(); await h.native({type: 'control', enabled: true});
  await h.native({type: 'viewport', zoom: 2});
  h.touch('pointerdown', 200, 250); h.touch('pointerup', 200, 250);
  assert.equal(h.inputs()[0].x, 636); assert.equal(h.inputs()[0].y, 1080);
});
test('leaving image bounds or cancelling a drag releases the mouse without disconnecting', async () => {
  for (const cancelled of [false, true]) {
    const h = await harness(true); h.ready(); h.frame(); await h.native({type: 'control', enabled: true});
    await h.native({type: 'viewport', mode: 'direct'});
    h.touch('pointerdown', 160, 200); h.touch('pointermove', 0, -30);
    h.touch(cancelled ? 'pointercancel' : 'pointerup', 0, -30);
    assert.equal(h.isClosed(), false); const inputs = h.inputs();
    assert.equal(inputs[0].phase, 'down'); assert.equal(inputs.at(-1)?.phase, 'up');
    assert.equal(inputs.at(-1)?.x, 0); assert.equal(inputs.at(-1)?.y, 0);
  }
});
test('touchpad motion moves only the cursor, is ACK bounded, and clicking uses the final cursor position', async () => {
  const h = await harness(true); h.ready(); h.frame(); await h.native({type: 'control', enabled: true});
  h.touch('pointerdown');
  for(let i=1;i<30;i++) h.touch('pointermove', 160+i, 200+i);
  assert.deepEqual(h.inputs().map(m=>m.phase), ['move']);
  h.touch('pointerup', 189, 229); assert.equal(h.isClosed(), false);
  h.fromHost({type: 'input_ack', seq: 1});
  h.touch('pointerdown'); h.touch('pointerup');
  const down=h.inputs().find(m=>m.phase==='down');
  assert.ok(Number(down?.x)>540); assert.ok(Number(down?.y)>960);
  assert.equal(h.inputs().at(-1)?.phase, 'up');
});
test('second finger safely releases a held drag, and local resize keeps the session', async () => {
  const h = await harness(true); h.ready(); h.frame(); await h.native({type: 'control', enabled: true});
  h.touch('pointerdown'); h.hold(); h.touch('pointerdown', 180, 200, 2);
  assert.deepEqual(h.inputs().map(m=>m.phase), ['down','up']); assert.equal(h.isClosed(), false);
  h.touch('pointerup',180,200,2); h.touch('pointerup');
  h.rect.width=400; h.rect.height=320; h.resize();
  assert.equal(h.isClosed(),false);
});
test('view-only zoom and pan never transmit input and a stale finger is not replayed after recovery', async () => {
  const h = await harness(true); h.ready(); h.frame(); await h.native({type:'viewport',zoom:3});
  h.touch('pointerdown'); h.touch('pointermove',200,230); h.touch('pointerup');
  assert.equal(h.inputs().length,0); assert.match(h.video.style.transform,/scale\(3\)/);
  await h.native({type:'control',enabled:true}); h.touch('pointerdown'); h.tick(3100);
  assert.equal(h.isClosed(),false); h.frame(); h.touch('pointerup');
  assert.equal(h.inputs().length,0); assert.equal(h.posted.at(-1)?.type,'live');
});
