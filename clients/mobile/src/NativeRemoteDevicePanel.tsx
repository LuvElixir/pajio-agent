import {StateSwitch} from './experience/selection';
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {ActivityIndicator, AppState, Platform, StyleSheet, Text, TextInput, View} from 'react-native';
import {WebView, type WebViewMessageEvent} from 'react-native-webview';
import * as Crypto from 'expo-crypto';
import {ArrowLeft, ArrowRight, ChevronRight, Eye, Hand, Keyboard, Monitor, Power, RotateCw, Settings2, Smartphone} from 'lucide-react-native';
import {useAppTheme, useThemedStyles, type AppColors} from './app-theme';
import {palettes} from './appearance';
import {type Connection, connectionEndpoint} from './core';
import {registerAccountWork} from './account-work';
import {IconButton, PrimaryButton, Sheet, TactilePressable} from './experience/primitives';
import {serviceFetch} from './transport';
import {canStream, deviceIdentifier, RemoteDeviceApi, remoteStatusCopy, type RemoteAccess, type RemoteTransport} from './remote-device-model';
import {remoteViewerDocument} from './remote-viewer-document';
import {remoteTextIssue, remoteTextLimits, remoteTextNotice, type RemoteTextCapabilities} from './remote-text-input';

type Props = {connection: Connection; resource: string; name: string; kind: 'computer' | 'android'; onBack: () => void};
type Viewer = {access: RemoteAccess; transport: RemoteTransport; attempt: number};
type Capabilities = RemoteTextCapabilities & {keyboard?: boolean; touch?: boolean; pointer?: boolean; scroll?: boolean};
const messageOf = (error: unknown) => error instanceof Error ? error.message : '这次连接没有完成，请重新检查设备。';
const pauseCopy: Record<string, string> = {
  background: '你已离开接管页面，输入与画面已停止。设备保持暂停。',
  stale_video: '画面暂时没有更新，已停止操作。请重新连接后查看设备。',
  input_unconfirmed: '设备没有确认刚才的操作，已停止发送。请重新连接后检查实际结果。',
  geometry_changed: '设备画面尺寸改变，已停止操作。请重新连接。',
  expired: '本次接管已到期。设备保持暂停，可重新接管。',
  closed: '已结束画面连接。设备保持暂停。',
};
const noticeCopy: Record<string, string> = {
  ascii_only: '这台云手机当前只支持英文、数字和常用符号输入，不支持中文或 %。',
  frame_not_ready: '正在等待新画面，本次操作未发送。',
  input_unavailable: '这台设备暂不支持此操作，本次操作未发送。',
};
const sameSession = (a: RemoteAccess, b: RemoteAccess) => a.session_id === b.session_id && a.epoch === b.epoch;

/** The native boundary owns credentials; the isolated video document only sees one short-lived session. */
export function NativeRemoteDevicePanel({connection, resource, name, kind, onBack}: Props) {
  const styles = useThemedStyles(makeStyles), {colors} = useAppTheme();
  const web = useRef<WebView>(null), alive = useRef(false), foreground = useRef(AppState.currentState === 'active');
  const api = useMemo(() => new RemoteDeviceApi(connection, serviceFetch, () => false), [connection]);
  const current = useRef<RemoteAccess | null>(null), viewing = useRef<Viewer | null>(null);
  const desired = useRef(false), returning = useRef(false), opening = useRef(false), mutating = useRef(false), polling = useRef(false);
  const closing = useRef(new Set<string>());
  const attempt = useRef(0), read = useRef(0), deadline = useRef(0), offerPending = useRef(false);
  const [access, setAccess] = useState<RemoteAccess | null>(null), [viewer, setViewer] = useState<Viewer | null>(null);
  const [busy, setBusy] = useState(false), [live, setLive] = useState(false), [controlling, setControlling] = useState(false);
  const [isReturning, setIsReturning] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [rtt, setRtt] = useState<number | null>(null);
  const [capabilities, setCapabilities] = useState<Capabilities>({}), [text, setText] = useState('');
  const [panel, setPanel] = useState<'session' | 'keys' | 'keyboard' | null>(null);
  const [confirmReturn, setConfirmReturn] = useState(false), [safeScreen, setSafeScreen] = useState(false), [scopeConfirmed, setScopeConfirmed] = useState(false);
  const send = useCallback((value: object) => web.current?.injectJavaScript(`window.pajioReceive?.(${JSON.stringify(value).replace(/</g, '\\u003c')});true;`), []);
  const update = useCallback((next: RemoteAccess) => {current.current = next; if (alive.current) setAccess(next);}, []);

  const clearViewer = useCallback(() => {
    send({type: 'stop'}); viewing.current = null; opening.current = false; offerPending.current = false;
    if (alive.current) {setViewer(null); setLive(false); setControlling(false); setIsReturning(false); setPanel(null); setText(''); setRtt(null); setCapabilities({}); setConfirmReturn(false); setSafeScreen(false); setScopeConfirmed(false);}
  }, [send]);
  const stop = useCallback((reason: string, close = true) => {
    const previous = current.current, generation = ++attempt.current;
    read.current++; desired.current = false; returning.current = false; deadline.current = 0;
    clearViewer();
    if (alive.current) {setBusy(false); setNotice(previous?.session_id && previous.state !== 'agent_ready' ? '画面和输入已停止，正在确认设备暂停。' : '画面连接已结束。');}
    if (close && previous?.session_id && previous.state !== 'agent_ready') {
      const key = `${previous.session_id}:${previous.epoch}`;
      if (!closing.current.has(key)) {
        closing.current.add(key);
        void api.close(previous).then(next => {if (alive.current && generation === attempt.current) {update(next); setNotice(pauseCopy[reason] || '设备已保持暂停。重新连接后可继续。');}}).catch(() => {
          if (alive.current && generation === attempt.current) {setNotice('画面和输入已停止。'); setError('暂停回执尚未收到，请刷新设备状态；不会自动重新发送操作。');}
        }).finally(() => closing.current.delete(key));
      }
    }
  }, [api, clearViewer, update]);

  const attach = useCallback(async (next: RemoteAccess) => {
    if (!desired.current || !canStream(next) || opening.current || viewing.current || !foreground.current) return;
    const generation = attempt.current; opening.current = true;
    try {
      const transport = await api.transport(next);
      if (!alive.current || !foreground.current || generation !== attempt.current || !desired.current) return;
      const value = {access: next, transport, attempt: generation};
      viewing.current = value; setViewer(value);
    } catch (cause) {
      if (alive.current && generation === attempt.current) {stop('connection_lost'); setError(messageOf(cause));}
    } finally {if (generation === attempt.current) opening.current = false;}
  }, [api, stop]);

  const refresh = useCallback(async () => {
    if (!alive.current || !foreground.current || polling.current || mutating.current) return;
    polling.current = true; const revision = ++read.current;
    try {
      const next = await api.status(resource);
      if (!alive.current || !foreground.current || revision !== read.current) return;
      const previous = current.current;
      // Never close a newer session that replaced this viewer while a status read was in flight.
      if ((desired.current || returning.current) && previous?.session_id && !sameSession(previous, next)) {stop('session_changed'); update(next); return;}
      update(next);
      if (returning.current) {
        if (next.state === 'agent_ready' && next.device_confirmed && previous && sameSession(previous, next) && next.gateway_epoch !== null && next.gateway_epoch > (viewing.current?.access.gateway_epoch ?? -1)) {
          returning.current = false; desired.current = false; deadline.current = 0; attempt.current++;
          clearViewer(); setBusy(false); setNotice('设备已确认交还，Pajio 可以继续操作。');
        } else if (next.state === 'paused') stop('session_changed');
        return;
      }
      if (!desired.current) return;
      if (!['handoff_pending', 'human_private'].includes(next.state)) {stop('session_changed'); return;}
      if (viewing.current && (!canStream(next) || next.gateway_epoch !== viewing.current.access.gateway_epoch)) {stop('expired'); return;}
      if (canStream(next)) void attach(next);
    } catch (cause) {
      if (alive.current && revision === read.current) {
        if (desired.current || returning.current) stop('connection_lost');
        setError(messageOf(cause));
      }
    } finally {polling.current = false;}
  }, [api, resource, update, clearViewer, stop, attach]);

  useEffect(() => {
    alive.current = true; api.setUsable(() => alive.current && foreground.current); const initial = setTimeout(() => {void refresh();}, 0);
    const changed = AppState.addEventListener('change', state => {
      foreground.current = state === 'active';
      if (!foreground.current) stop('background'); else void refresh();
    });
    const blurred = Platform.OS === 'android' ? AppState.addEventListener('blur', () => stop('background')) : null;
    const unregister = registerAccountWork(connection, async () => {stop('closed');});
    const timer = setInterval(() => {
      if (!foreground.current) return;
      if (deadline.current && Date.now() > deadline.current) {stop('connection_lost'); setError('设备尚未确认这次连接，请重新检查后再试。');}
      else void refresh();
    }, 1500);
    return () => {alive.current = false; changed.remove(); blurred?.remove(); unregister(); clearTimeout(initial); clearInterval(timer); stop('closed');};
  }, [api, connection, refresh, stop]);

  async function begin() {
    if (mutating.current || !foreground.current || !deviceIdentifier(resource)) return;
    mutating.current = true; const generation = ++attempt.current; read.current++;
    desired.current = false; returning.current = false; clearViewer();
    setBusy(true); setError(''); setNotice('正在请求设备暂停 Pajio 的操作…');
    try {
      let previous = await api.status(resource);
      if (!alive.current || !foreground.current || generation !== attempt.current) return;
      if (!previous.supported) {update(previous); setNotice('此设备尚未开放远程接管。'); setBusy(false); return;}
      if (previous.session_id && !['agent_ready', 'paused'].includes(previous.state)) {
        previous = await api.close(previous);
        if (!alive.current || !foreground.current || generation !== attempt.current) return;
      }
      const next = await api.begin(previous, Crypto.randomUUID().replaceAll('-', ''));
      if (!alive.current || !foreground.current || generation !== attempt.current) {
        if (next.session_id) void api.close(next).catch(() => {});
        return;
      }
      update(next); desired.current = true; deadline.current = Date.now() + 35000;
      setNotice('等待设备确认，确认后才会连接画面。');
      if (canStream(next)) void attach(next);
    } catch (cause) {if (alive.current && generation === attempt.current) {stop('connection_lost'); setError(messageOf(cause));}}
    finally {mutating.current = false;}
  }
  async function giveBack() {
    const previous = current.current;
    if (!previous || !canStream(previous) || !safeScreen || !scopeConfirmed || mutating.current) return;
    const generation = attempt.current; mutating.current = true; returning.current = true; desired.current = false; read.current++;
    send({type: 'freeze'}); setLive(false); setControlling(false); setIsReturning(true); setPanel(null); setText(''); setConfirmReturn(false); setBusy(true);
    deadline.current = Date.now() + 30000; setNotice('等待设备确认交还…');
    try {
      const next = await api.giveBack(previous, true, true);
      if (alive.current && generation === attempt.current) update(next);
    } catch (cause) {if (alive.current && generation === attempt.current) {stop('connection_lost'); setError(messageOf(cause));}}
    finally {mutating.current = false;}
  }
  async function message(event: WebViewMessageEvent) {
    const frame = viewing.current;
    if (!frame || !alive.current || !foreground.current || frame.attempt !== attempt.current || event.nativeEvent.data.length > 150000) return;
    let value: Record<string, unknown>;
    try {value = JSON.parse(event.nativeEvent.data);} catch {stop('invalid_channel'); return;}
    if (!value || typeof value !== 'object') return;
    if (value.type === 'stopped') {if (!returning.current) stop(typeof value.reason === 'string' ? value.reason : 'connection_lost'); return;}
    if (returning.current || !desired.current) return;
    if (value.type === 'offer' && typeof value.sdp === 'string') {
      if (offerPending.current) {stop('negotiation_failed'); return;}
      offerPending.current = true;
      try {
        const answer = await api.offer(frame.access, value.sdp);
        if (alive.current && foreground.current && desired.current && frame.attempt === attempt.current) send(answer);
      } catch (cause) {if (alive.current && frame.attempt === attempt.current) {stop('connection_lost'); setError(messageOf(cause));}}
    } else if (value.type === 'live') {
      deadline.current = 0; setLive(true); setBusy(false); setNotice('画面已连接。点“开始操作”后，可直接触控设备。');
      if (value.capabilities && typeof value.capabilities === 'object') setCapabilities(value.capabilities as Capabilities);
    } else if (value.type === 'control') {setControlling(value.enabled === true); setNotice(value.enabled === true ? '你可以直接触控设备。结束后明确交还，Pajio 才会继续。' : '当前只查看画面。点“开始操作”后，可直接触控设备。');}
    else if (value.type === 'quality' && typeof value.rtt_ms === 'number' && Number.isFinite(value.rtt_ms)) setRtt(Math.max(0, Math.round(value.rtt_ms)));
    else if (value.type === 'notice') setError(remoteTextNotice(String(value.code), capabilities, kind) || noticeCopy[String(value.code)] || '设备拒绝了这次操作，操作不会自动重试。请检查画面后再操作。');
  }
  function submitText() {
    if (!alive.current || !foreground.current || !viewing.current || !controlling || capabilities.keyboard !== true || !text) return;
    const issue = remoteTextIssue(text, capabilities, kind);
    if (issue) {setError(remoteTextNotice(issue, capabilities, kind)!); return;}
    const draft = text; setText(''); setError(''); send({type: 'text', text: draft});
  }
  function sendKey(key: string) {
    if (!alive.current || !foreground.current || !viewing.current || !controlling || capabilities.keyboard !== true) return;
    send({type: 'key', key});
  }
  function sendScroll(delta: number) {
    if (!alive.current || !foreground.current || !viewing.current || !controlling || capabilities.scroll !== true) return;
    send({type: 'scroll', delta_y: delta});
  }
  const html = useMemo(() => viewer ? remoteViewerDocument(viewer.transport, kind, viewer.access.expires_at!) : '', [viewer, kind]);
  const baseUrl = new URL('/remote-viewer-native', connectionEndpoint(connection)).toString();
  const source = useMemo(() => ({html, baseUrl}), [html, baseUrl]);
  const connected = live && !!viewer && !isReturning;
  const keys = kind === 'android' ? [['Back', '返回'], ['Home', '主页'], ['Recents', '最近任务']] : [['Tab', 'Tab'], ['Escape', 'Esc'], ['ArrowUp', '↑'], ['ArrowDown', '↓'], ['ArrowLeft', '←'], ['ArrowRight', '→']];
  const inputReady = controlling && capabilities.keyboard === true;
  const deviceLabel = kind === 'android' ? '云手机' : '云电脑';
  function closePanel() {setPanel(null); setText(''); setConfirmReturn(false); setSafeScreen(false); setScopeConfirmed(false);}
  function changeMode(enabled: boolean) {
    if (!connected || enabled === controlling) return;
    closePanel(); send({type: 'control', enabled});
  }
  return <View style={styles.root}>
    <View style={styles.header}>
      <IconButton variant="plain" label="返回，设备保持暂停" onPress={() => {stop('closed'); onBack();}}><ArrowLeft size={22} color={colors.ink}/></IconButton>
      <View style={styles.heading}><Text numberOfLines={1} style={styles.title}>{name || deviceLabel}</Text>
        <View style={styles.statusRow}><View style={[styles.dot, {backgroundColor: connected ? colors.selectionIndicator : colors.outline}]}/><Text numberOfLines={1} accessibilityLiveRegion="polite" style={styles.status}>{connected ? controlling ? '由你操作 · Pajio 已暂停' : '仅查看 · Pajio 已暂停' : remoteStatusCopy(access)}</Text></View>
      </View>
      {connected ? <TactilePressable accessibilityLabel="完成接管，选择交还或断开" onPress={() => {closePanel(); setPanel('session');}} style={styles.done}><Text style={styles.doneText}>完成</Text></TactilePressable>
        : <IconButton variant="plain" label="刷新设备状态" disabled={busy} onPress={() => {setError(''); void refresh();}}><RotateCw size={20} color={colors.muted}/></IconButton>}
    </View>
    <View style={styles.videoBox}>
      {viewer && Platform.OS !== 'web' && <WebView ref={web} source={source} style={styles.video} originWhitelist={['*']}
        onShouldStartLoadWithRequest={request => request.url === 'about:blank' || request.url === baseUrl}
        onMessage={event => {void message(event);}} onError={() => stop('connection_lost')} onContentProcessDidTerminate={() => stop('connection_lost')}
        onRenderProcessGone={() => stop('connection_lost')} javaScriptEnabled domStorageEnabled={false} incognito sharedCookiesEnabled={false}
        thirdPartyCookiesEnabled={false} allowFileAccess={false} allowFileAccessFromFileURLs={false} allowUniversalAccessFromFileURLs={false}
        mixedContentMode="never" allowsInlineMediaPlayback mediaPlaybackRequiresUserAction={false} allowsBackForwardNavigationGestures={false}
        bounces={false} scrollEnabled={false} setSupportMultipleWindows={false} onOpenWindow={() => stop('unexpected_navigation')}
        webviewDebuggingEnabled={false}/>}
      {!connected && <View style={styles.cover}>
        <View style={styles.deviceBadge}>{busy ? <ActivityIndicator color={palettes.night.ink}/> : kind === 'android' ? <Smartphone size={32} strokeWidth={1.5} color={palettes.night.muted}/> : <Monitor size={36} strokeWidth={1.5} color={palettes.night.muted}/>}</View>
        <Text style={styles.coverTitle}>{busy ? isReturning ? '正在交还设备' : '正在连接设备' : access?.state === 'paused' ? '设备已暂停' : '你的'+deviceLabel}</Text>
        <Text style={styles.coverText}>{Platform.OS === 'web' ? '请在 iPhone 或 Android App 中接管设备。' : notice || '连接后先查看画面，准备好再开始操作。'}</Text>
      </View>}
    </View>
    {!!error && <View style={styles.errorBar}><Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text></View>}
    {connected ? <View style={styles.dockWrap}><View style={styles.dock}>
      <View style={styles.modes} accessibilityRole="tablist">
        {[{enabled: false, label: '查看', Icon: Eye}, {enabled: true, label: '操作', Icon: Hand}].map(({enabled, label, Icon}) => <TactilePressable key={label} accessibilityRole="tab" accessibilityLabel={enabled ? '开始操作远程设备' : '仅查看远程画面'} accessibilityState={{selected: controlling === enabled}} onPress={() => changeMode(enabled)} style={[styles.mode, controlling === enabled && styles.modeSelected]}>
          <Icon size={18} color={controlling === enabled ? colors.selectionInk : colors.muted}/><Text style={[styles.modeText, controlling === enabled && styles.modeTextSelected]}>{label}</Text>
        </TactilePressable>)}
      </View>
      <View style={styles.divider}/>
      <IconButton variant="plain" label="远程键盘" selected={panel === 'keyboard'} onPress={() => {closePanel(); setPanel('keyboard');}}><Keyboard size={21} color={colors.ink}/></IconButton>
      <IconButton variant="plain" label={kind === 'android' ? '手机导航与操作说明' : '电脑快捷键与操作说明'} selected={panel === 'keys'} onPress={() => {closePanel(); setPanel('keys');}}><Settings2 size={21} color={colors.ink}/></IconButton>
    </View></View> : <View style={styles.connectBar}>
      <PrimaryButton label={busy ? isReturning ? '结束画面并检查状态' : '取消连接' : access?.state === 'paused' ? '重新连接' : '连接'+deviceLabel} disabled={Platform.OS === 'web' || !access?.supported || !deviceIdentifier(resource)} onPress={() => {if (busy) stop('closed'); else void begin();}}/>
    </View>}
    <Sheet visible={connected && panel !== null} onDismiss={closePanel}
      title={panel === 'session' ? confirmReturn ? '交还 Pajio' : '完成这次接管' : panel === 'keyboard' ? '远程键盘' : kind === 'android' ? '手机操作' : '电脑操作'}
      subtitle={panel === 'session' ? confirmReturn ? '确认后，Pajio 会恢复查看和操作设备。' : '选择接下来由谁操作这台设备。' : panel === 'keyboard' ? '先在远程画面中点选输入框。' : kind === 'android' ? '直接轻点或滑动远程画面。' : '轻点点击，按住拖动。滚动页面可用下方按钮。'}>
      {panel === 'session' ? confirmReturn ? <View style={styles.sheetStack}>
        <View style={styles.confirmRow}><Text style={styles.flexText}>已离开密码、验证码等私密页面</Text><StateSwitch accessibilityLabel="已离开私密页面" value={safeScreen} onValueChange={setSafeScreen}/></View>
        <View style={styles.confirmRow}><Text style={styles.flexText}>允许 Pajio 继续操作这台设备</Text><StateSwitch accessibilityLabel="允许 Pajio 继续操作" value={scopeConfirmed} onValueChange={setScopeConfirmed}/></View>
        <PrimaryButton label="确认交还" disabled={!safeScreen || !scopeConfirmed} onPress={() => {void giveBack();}}/>
        <TactilePressable style={styles.textAction} onPress={() => setConfirmReturn(false)}><Text style={styles.caption}>返回其他选项</Text></TactilePressable>
      </View> : <View style={styles.sheetStack}>
        <TactilePressable style={[styles.sessionAction, styles.handoffAction]} accessibilityLabel="交还 Pajio，让助手继续操作" onPress={() => {setConfirmReturn(true); setSafeScreen(false); setScopeConfirmed(false);}}>
          <View style={styles.actionIcon}><ArrowRight size={22} color={colors.selectionInk}/></View><View style={styles.heading}><Text style={styles.actionTitle}>交还 Pajio</Text><Text style={styles.caption}>让助手继续处理事情</Text></View><ChevronRight size={18} color={colors.muted}/>
        </TactilePressable>
        <TactilePressable style={styles.sessionAction} accessibilityLabel="断开连接，设备保持暂停" onPress={() => stop('closed')}>
          <View style={styles.actionIcon}><Power size={21} color={colors.ink}/></View><View style={styles.heading}><Text style={styles.actionTitle}>断开连接</Text><Text style={styles.caption}>设备保持暂停，稍后再继续</Text></View><ChevronRight size={18} color={colors.muted}/>
        </TactilePressable>
        <View style={styles.connectionDetail}><Text style={styles.caption}>{deviceLabel} · 画面已连接</Text>{rtt !== null && <Text style={styles.caption}>延迟 {rtt} ms</Text>}</View>
      </View> : panel === 'keyboard' ? <View style={styles.sheetStack}>
        {!controlling ? <><Text style={styles.caption}>当前仅查看画面。切换到操作模式后即可输入。</Text><PrimaryButton label="开始操作" onPress={() => changeMode(true)}/></> : capabilities.keyboard !== true || capabilities.text !== 'unicode' ? <Text style={styles.caption}>这台设备的私密文字输入暂未就绪。你仍可使用远程画面中的键盘。</Text> : <>
          <View style={styles.row}><TextInput accessibilityLabel="发送到远程输入框的文字" placeholder="输入文字" placeholderTextColor={colors.muted} style={styles.input} value={text} onChangeText={setText} secureTextEntry autoCapitalize="none" autoCorrect={false} textContentType="none" autoComplete="off" returnKeyType="send" onSubmitEditing={submitText}/>
            <IconButton label="输入到远程设备" disabled={!text} onPress={submitText} style={styles.send}><ArrowRight size={22} color={colors.onAction}/></IconButton></View>
          <Text style={styles.caption}>内容隐藏显示，发送后清空。每次最多 {remoteTextLimits(capabilities, kind).chars} 个字符。</Text>
          {!!error && <Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text>}
          <View style={styles.keyRow}>{[['Backspace', '删除'], ['Enter', '回车']].map(([key, label]) => <TactilePressable key={key} accessibilityLabel={`远程${label}`} style={styles.key} onPress={() => sendKey(key)}><Text style={styles.keyText}>{label}</Text></TactilePressable>)}</View>
        </>}
      </View> : <View style={styles.sheetStack}>
        {!controlling && <Text style={styles.caption}>切换到操作模式后可使用快捷键。</Text>}
        <View style={styles.keyRow}>{keys.map(([key, label]) => <TactilePressable key={key} disabled={!inputReady} accessibilityLabel={`远程${label}`} style={styles.key} onPress={() => sendKey(key)}><Text style={styles.keyText}>{label}</Text></TactilePressable>)}</View>
        {kind === 'computer' && <View style={styles.keyRow}>{[[-320, '向上滚动'], [320, '向下滚动']].map(([delta, label]) => <TactilePressable key={label} disabled={!controlling || capabilities.scroll !== true} accessibilityLabel={String(label)} style={styles.key} onPress={() => sendScroll(Number(delta))}><Text style={styles.keyText}>{label}</Text></TactilePressable>)}</View>}
        {controlling && capabilities.keyboard !== true && <Text style={styles.caption}>设备暂未提供快捷键支持。</Text>}
        <Text style={styles.caption}>切换为“查看”会停止你的输入。点击顶部“完成”，可交还助手或断开连接。</Text>
      </View>}
    </Sheet>
  </View>;
}

const makeStyles = (c: AppColors) => StyleSheet.create({
  root: {flex: 1, backgroundColor: c.canvas},
  header: {flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingTop: 4, paddingBottom: 10},
  heading: {flex: 1, gap: 5}, title: {fontSize: 16, fontWeight: '600', color: c.ink},
  statusRow: {flexDirection: 'row', gap: 6, alignItems: 'center'}, dot: {width: 5, height: 5, borderRadius: 3}, status: {fontSize: 12, color: c.muted, flexShrink: 1},
  done: {minWidth: 48, minHeight: 44, alignItems: 'center', justifyContent: 'center'}, doneText: {fontSize: 15, fontWeight: '600', color: c.accent}, caption: {fontSize: 13, lineHeight: 20, color: c.muted},
  videoBox: {flex: 1, minHeight: 120, backgroundColor: palettes.night.canvas, overflow: 'hidden'}, video: {flex: 1, backgroundColor: palettes.night.canvas},
  cover: {position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 32, backgroundColor: palettes.night.canvas},
  deviceBadge: {width: 76, height: 76, borderRadius: 24, backgroundColor: palettes.night.surface, alignItems: 'center', justifyContent: 'center', marginBottom: 8},
  coverTitle: {fontSize: 20, fontWeight: '600', color: palettes.night.ink}, coverText: {maxWidth: 280, fontSize: 14, lineHeight: 23, color: palettes.night.muted, textAlign: 'center'},
  dockWrap: {paddingHorizontal: 16, paddingTop: 10, paddingBottom: 8},
  dock: {flexDirection: 'row', alignItems: 'center', gap: 6, padding: 6, borderRadius: 22, backgroundColor: c.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: c.line, maxWidth: 430, width: '100%', alignSelf: 'center'},
  modes: {flex: 1, flexDirection: 'row', gap: 2}, mode: {flex: 1, minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderWidth: 1, borderColor: 'transparent', borderRadius: 16},
  modeSelected: {backgroundColor: c.selectionSurface, borderColor: c.selectionBorder}, modeText: {fontSize: 14, color: c.muted}, modeTextSelected: {fontWeight: '600', color: c.selectionInk},
  divider: {width: StyleSheet.hairlineWidth, height: 24, backgroundColor: c.line, marginHorizontal: 2},
  connectBar: {padding: 16, gap: 12}, errorBar: {paddingHorizontal: 20, paddingTop: 10}, error: {fontSize: 13, lineHeight: 20, color: c.danger},
  row: {flexDirection: 'row', alignItems: 'center', gap: 10}, sheetStack: {gap: 16}, flexText: {flex: 1, fontSize: 15, lineHeight: 23, color: c.ink},
  keyRow: {flexDirection: 'row', flexWrap: 'wrap', gap: 8}, key: {minWidth: 54, minHeight: 48, paddingHorizontal: 18, justifyContent: 'center', alignItems: 'center', borderRadius: 12, backgroundColor: c.soft}, keyText: {fontSize: 15, color: c.ink},
  input: {flex: 1, minHeight: 52, fontSize: 16, color: c.ink, borderWidth: 1, borderColor: c.outline, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, textAlignVertical: 'center'}, send: {backgroundColor: c.action, borderRadius: 14, width: 52, height: 52},
  confirmRow: {flexDirection: 'row', alignItems: 'center', gap: 16, paddingVertical: 8}, textAction: {minHeight: 44, alignItems: 'center', justifyContent: 'center'},
  sessionAction: {flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 88, paddingHorizontal: 16, paddingVertical: 18, borderRadius: 18, backgroundColor: c.soft},
  handoffAction: {backgroundColor: c.selectionSurface, borderWidth: 1, borderColor: c.selectionBorder}, actionIcon: {width: 28, alignItems: 'center'}, actionTitle: {fontSize: 16, color: c.ink, fontWeight: '600'},
  connectionDetail: {flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, paddingHorizontal: 4},
});
