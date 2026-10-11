import {useCallback,useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
import {ActivityIndicator,Alert,FlatList,Keyboard,Modal,ScrollView,Platform,Pressable,StyleSheet,Text,View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {useNetworkState} from 'expo-network';
import * as Crypto from 'expo-crypto';
import {ArrowDown,ArrowUpRight,Mic} from 'lucide-react-native';
import {useAppTheme,useThemedStyles,type AppColors} from './app-theme';
import {scopeOf} from './core';
import {storage} from './storage';
import {serviceFetch} from './transport';
import {registerAccountWork} from './account-work';
import VoiceComposer from './VoiceComposer';
import type {ComposerCommand,ComposerState} from './native-composer';
import type {ConversationProps} from './conversation-props';
import {useReducedMotion} from './experience/primitives';
import {AppDock} from './experience/AppDock';
import {isDeviceOffline} from './conversation-presentation';
import {NativeChatApi,ChatDraft,chatKey,liveStatuses,mergeChat,readChatPage,type ChatMessage,type ChatJournal} from './native-chat';
import {NativeDesktopDecision} from './NativeDesktopDecision';
import {NativeChatRow} from './NativeChatRow';

export default function Conversation(props:ConversationProps) {
  return <ConversationPage key={scopeOf(props.connection)+'|'+(props.connection.session?.credentialId||'local')+'|'+(props.record?.id||'')+'|'+(props.record?.revision||'')} {...props}/>;
}
function ConversationPage({connection,record,active=true,visible=true,showComposer=true,compactComposer=false,content,navigation,onCapture,onAdd,onSend,onOpenChat,onArtifact,onTask,reviewRequest,inputScope}:ConversationProps) {
  const {colors:c}=useAppTheme(),s=useThemedStyles(styles),offline=isDeviceOffline(useNetworkState()),reduced=useReducedMotion();
  const current=useRef({active,visible,offline,alive:true});
  useLayoutEffect(()=>{current.current={active,visible,offline,alive:true};},[active,visible,offline]);
  const api=useMemo(()=>new NativeChatApi(connection,serviceFetch,()=>current.current.alive&&current.current.active),[connection]);
  const [pageId]=useState(()=>Crypto.randomUUID());
  const contextKey=JSON.stringify({identity:connection.identity,...(record?{life:{id:record.id,revision:record.revision}}:{})});
  const draft=useMemo(()=>new ChatDraft(connection,storage,()=>Crypto.randomUUID(),contextKey),[connection,contextKey]);
  const journal=useRef<ChatJournal>({text:'',voiceIds:[]}),serial=useRef(Promise.resolve()),sequence=useRef(0),sending=useRef(false);
  const [snapshot,setSnapshot]=useState<ComposerState>({type:'wearing-composer-state',identity:connection.identity,pageId,contextKey,text:'',sending:false,ready:false,ackSeq:0,...(record?{contextLabel:'围绕记录 · '+record.title}:{})});
  const [messages,setMessages]=useState<ChatMessage[]>([]),messagesRef=useRef<ChatMessage[]>([]);
  const [loaded,setLoaded]=useState(false),[error,setError]=useState(''),[olderBusy,setOlderBusy]=useState(false),[hasOlder,setHasOlder]=useState(false),[away,setAway]=useState(false),[keyboard,setKeyboard]=useState(false);
  const oldest=useRef<string|null>(null),latest=useRef<string|null>(null),readBusy=useRef(false),readAgain=useRef(false),olderLock=useRef(false),nearLatest=useRef(true);
  const list=useRef<FlatList<ChatMessage>>(null);
  const decisions=useRef(new Set<string>());
  const [focusedMessage,setFocusedMessage]=useState<ChatMessage|null>(null);
  const cacheKey='native-chat-cache:v1:'+scopeOf(connection);
  const cachedRevision=useRef('');
  const apply=useCallback((items:ChatMessage[])=>{const next=mergeChat(messagesRef.current,items);messagesRef.current=next;setMessages(next);},[]);
  const read=useCallback(async(force=false):Promise<void>=>{
    if(!current.current.active||!current.current.visible||current.current.offline)return;
    if(readBusy.current){if(force)readAgain.current=true;return;}
    readBusy.current=true;
    try {
      let more=true,rounds=0;
      while(more&&rounds++<5) {
        const after=latest.current||undefined;
        const page=await api.page({after,watch:[...new Set((force?messagesRef.current.slice(0,40):messagesRef.current.filter(m=>liveStatuses.has(m.turn.status)||m.turn.status==='draft')).map(m=>m.task_id))].slice(0,80)});
        if(!current.current.alive||!current.current.active)return;
        apply(page.items);latest.current=page.latest_cursor||latest.current;
        if(!after){oldest.current=page.next_cursor;setHasOlder(!!page.next_cursor);}
        more=!!after&&page.has_more;
      }
      setLoaded(true);setError('');
      // Only a bounded recent window is cached. Account cleanup owns this namespace.
      const recent=messagesRef.current.slice(0,40);
      const revision=JSON.stringify(recent);
      if(revision!==cachedRevision.current&&revision.length<1_000_000){cachedRevision.current=revision;void storage.put(cacheKey,recent).catch(()=>{cachedRevision.current='';});}
    } catch {if(current.current.alive&&current.current.active)setError('暂时没连上，已读内容和草稿都在。');}
    finally{readBusy.current=false;if(readAgain.current){readAgain.current=false;void read();}}
  },[api,apply,cacheKey]);
  useEffect(()=>{
    current.current.alive=true;
    const stop=registerAccountWork(connection,async()=>{current.current.alive=false;api.close();});
    void draft.load().then(value=>{if(!current.current.alive)return;journal.current=value;setSnapshot(v=>({...v,text:value.text,ready:true}));}).catch(()=>{if(current.current.alive)setError('本机草稿暂时无法读取，请重新打开。');});
    void storage.get<ChatMessage[]>(cacheKey).then(items=>{if(current.current.alive&&!messagesRef.current.length&&Array.isArray(items)){readChatPage({identity:connection.identity,items,next_cursor:null,latest_cursor:null,has_more:false,direction:'before'},connection.identity);apply(items);}}).catch(()=>{});
    return()=>{current.current.alive=false;api.close();stop();};
  },[api,connection,draft,cacheKey,apply]);
  useEffect(()=>{
    if(!active||!visible){api.cancel();return;}
    let live=true,first=true,timer:ReturnType<typeof setTimeout>;
    const tick=async()=>{await read(first);first=false;if(live)timer=setTimeout(tick,messagesRef.current.some(m=>liveStatuses.has(m.turn.status))?1000:4500);};
    void tick();return()=>{live=false;clearTimeout(timer);};
  },[active,visible,offline,read,api]);
  useEffect(()=>{
    const show=Keyboard.addListener(Platform.OS==='ios'?'keyboardWillShow':'keyboardDidShow',()=>setKeyboard(true));
    const hide=Keyboard.addListener(Platform.OS==='ios'?'keyboardWillHide':'keyboardDidHide',()=>setKeyboard(false));
    return()=>{show.remove();hide.remove();};
  },[]);
  const scrollLatest=useCallback(()=>{nearLatest.current=true;setAway(false);list.current?.scrollToOffset({offset:0,animated:!reduced});},[reduced]);
  async function older(){
    if(olderLock.current||!oldest.current||!active||offline)return;
    olderLock.current=true;setOlderBusy(true);
    try{const page=await api.page({before:oldest.current});if(current.current.alive){apply(page.items);oldest.current=page.next_cursor;setHasOlder(!!page.next_cursor);setError('');}}
    catch{if(current.current.alive)setError('更早的消息暂未加载，点一下重试。');}
    finally{olderLock.current=false;if(current.current.alive)setOlderBusy(false);}
  }
  function command(command:ComposerCommand):number|null {
    if(!current.current.active||!snapshot.ready||(sending.current&&command.kind==='send'))return null;
    const seq=++sequence.current;
    if(command.kind==='send')sending.current=true;
    serial.current=serial.current.then(async()=>{
      if(!current.current.alive)return;
      let value=journal.current;
      try{
        if(command.kind==='send'){
          const text=(command.text??value.text).trim();
          if(!text||current.current.offline)throw Error('当前离线，原话已保留。');
          if(record&&value.uncertainRecord)throw Error('关联记录的上次发送结果待核对，请先查看聊天记录，避免重复执行。');
          value=await draft.prepare(value,text);journal.current=value;
          if(record){value={...value,uncertainRecord:true};await draft.save(value);journal.current=value;}
          setSnapshot(v=>({...v,sending:true,ackSeq:seq,error:''}));
          const receipt=await api.send(text,value.pending!.id,record);
          value={...value,text:'',pending:undefined,uncertainRecord:false};
          await draft.save(value);journal.current=value;
          if(current.current.alive){setSnapshot(v=>({...v,text:'',sending:false,ackSeq:seq,error:receipt.delivery==='saved'?(receipt.reason||'已保存，尚未执行。'):''}));scrollLatest();void read(true);}
        }else{
          if(command.kind==='change')value={...value,text:command.text??''};
          if(command.kind==='append'&&(!command.voiceId||!value.voiceIds.includes(command.voiceId))){value={...value,text:[value.text,command.text].filter(Boolean).join('\n'),voiceIds:command.voiceId?[...value.voiceIds,command.voiceId].slice(-100):value.voiceIds};}
          if(value.text.length>12000)throw Error('一次最多 12000 字，请分段发送。');
          await draft.save(value);journal.current=value;
          if(current.current.alive)setSnapshot(v=>({...v,text:value.text,ackSeq:seq,error:'',...(command.voiceId?{ackVoiceId:command.voiceId}:{})}));
        }
      }catch(cause){if(current.current.alive)setSnapshot(v=>({...v,ackSeq:seq,text:journal.current.text,sending:false,error:cause instanceof Error&&/[\u4e00-\u9fff]/.test(cause.message)?cause.message:'发送或保存结果尚未确认，原话已保留；重试会核对同一次提交。'}));}
      finally{if(command.kind==='send')sending.current=false;}
    });
    return seq;
  }
  const commandRef=useRef(command);useLayoutEffect(()=>{commandRef.current=command;});
  const handled=useRef<number|undefined>(undefined);
  useEffect(()=>{
    if(!reviewRequest||!snapshot.ready||!active||!visible||handled.current===reviewRequest.id)return;
    handled.current=reviewRequest.id;
    if(reviewRequest.target==='draft')commandRef.current({kind:'append',text:reviewRequest.text});
    if(reviewRequest.target==='activity') {const index=messagesRef.current.findIndex(m=>m.task_id===reviewRequest.taskId);if(index>=0)list.current?.scrollToIndex({index,animated:true});else {void api.page({watch:[reviewRequest.taskId]}).then(page=>{if(current.current.active&&current.current.visible){const found=page.items.find(m=>m.task_id===reviewRequest.taskId);if(found)setFocusedMessage(found);else Alert.alert('这项任务没有独立聊天消息','可以在任务详情查看原始交代和结果。');}}).catch(()=>{if(current.current.alive)setError('原对话暂未读到，请从任务详情重试。');});}}
  },[reviewRequest,snapshot.ready,active,visible,api]);
  const decision=useCallback((task:string,request:string,choice:string)=>{
    const key=task+':'+request;if(decisions.current.has(key)||!current.current.active)return;
    decisions.current.add(key);
    void api.request('/api/tasks/'+task+'/approval',{request_id:request,choice}).then(()=>read()).catch(()=>{if(current.current.alive){Alert.alert('决定送达状态待核对','请查看最新进展，暂不重复提交这一步。');void read();}});
  },[api,read]);
  const openTask=useCallback((id:string)=>{Keyboard.dismiss();setFocusedMessage(null);onTask?.(id);},[onTask]);
  const openArtifact=useCallback((id:string)=>{Keyboard.dismiss();setFocusedMessage(null);onArtifact?.(id);},[onArtifact]);
  const renderItem=useCallback(({item}:{item:ChatMessage})=><NativeChatRow message={item} onTask={openTask} onArtifact={openArtifact} onDecision={decision} disabled={!active}/>,[openTask,openArtifact,decision,active]);
  const expanded=showComposer&&!compactComposer;
  return <View style={s.page}>
    <View style={s.page}>
      <View style={[s.layer,!visible&&s.retained]} pointerEvents={visible?'auto':'none'} accessibilityElementsHidden={!visible} importantForAccessibility={visible?'auto':'no-hide-descendants'}>
        <FlatList ref={list} testID="native-conversation-list" data={messages} inverted keyExtractor={chatKey} renderItem={renderItem}
          initialNumToRender={8} maxToRenderPerBatch={6} windowSize={7} removeClippedSubviews={false}
          maintainVisibleContentPosition={{minIndexForVisible:0}} keyboardDismissMode={Platform.OS==='ios'?'interactive':'on-drag'} keyboardShouldPersistTaps="handled"
          automaticallyAdjustKeyboardInsets={false} contentInsetAdjustmentBehavior="never" contentContainerStyle={s.list}
          onScroll={e=>{nearLatest.current=e.nativeEvent.contentOffset.y<90;setAway(!nearLatest.current);}} scrollEventThrottle={64}
          onContentSizeChange={()=>{if(nearLatest.current)list.current?.scrollToOffset({offset:0,animated:false});}}
          onLayout={()=>{if(nearLatest.current)list.current?.scrollToOffset({offset:0,animated:false});}}
          onScrollToIndexFailed={info=>list.current?.scrollToOffset({offset:info.averageItemLength*info.index,animated:true})}
          onEndReached={()=>{if(messages.length>=40)void older();}} onEndReachedThreshold={0.4}
          ListHeaderComponent={messages.some(m=>m.turn.status==='waiting_for_approval'&&m.turn.approval?.kind==='desktop_input')?<NativeDesktopDecision api={api} active={active&&visible} onRefresh={()=>{void read();}}/>:null}
          ListFooterComponent={hasOlder?<Pressable accessibilityRole="button" onPress={()=>{void older();}} style={s.load}>{olderBusy?<ActivityIndicator color={c.muted}/>:<Text style={s.note}>加载更早的消息</Text>}</Pressable>:loaded&&messages.length?<Text style={s.beginning}>从这里开始的对话</Text>:null}/>
        {!messages.length&&<View style={s.empty}>{!loaded&&!error?<ActivityIndicator color={c.muted}/>:null}<Text style={s.emptyTitle}>{loaded?'你说，我来做。':'正在找回对话…'}</Text>{loaded&&<Text style={s.note}>打字或按住说话，交代第一件事。</Text>}</View>}
        {away&&<Pressable accessibilityRole="button" accessibilityLabel="回到最新消息" onPress={scrollLatest} style={s.latest}><ArrowDown size={18} color={c.ink}/><Text style={s.note}>回到最新</Text></Pressable>}
        {!!error&&<Pressable accessibilityRole="button" onPress={()=>{void read();}} style={s.error}><Text style={s.note}>{error} 点此重试</Text></Pressable>}
      </View>
      {!visible?content:null}
    </View>
    <Modal visible={!!focusedMessage} animationType={reduced?'none':'slide'} allowSwipeDismissal presentationStyle="pageSheet" onRequestClose={()=>setFocusedMessage(null)}>
      <SafeAreaView style={{flex:1,backgroundColor:c.canvas}}><View style={s.readerHead}><Text style={s.compactText}>原对话</Text><Pressable accessibilityRole="button" onPress={()=>setFocusedMessage(null)} style={s.load}><Text style={s.note}>完成</Text></Pressable></View><ScrollView keyboardShouldPersistTaps="handled">{focusedMessage&&<NativeChatRow message={focusedMessage} onTask={openTask} onArtifact={openArtifact} onDecision={decision} disabled={!active}/>}</ScrollView><Pressable accessibilityRole="button" style={s.compact} onPress={()=>{if(focusedMessage)command({kind:'append',text:'我们接着聊这件事：'+focusedMessage.content});setFocusedMessage(null);}}><Text style={s.compactText}>带回输入框继续聊</Text></Pressable></SafeAreaView>
    </Modal>
    <AppDock>
      <View style={!expanded&&s.hidden} accessibilityElementsHidden={!expanded} importantForAccessibility={expanded?'auto':'no-hide-descendants'}>
        <VoiceComposer connection={connection} active={active&&expanded} offline={offline} snapshot={snapshot} command={command} onCapture={onCapture} onAdd={onAdd} onSend={onSend} inputScope={inputScope}/>
      </View>
      {showComposer&&compactComposer&&onOpenChat&&<Pressable accessibilityRole="button" onPress={onOpenChat} style={s.compact}><Mic size={18} color={c.muted}/><Text style={s.compactText}>{snapshot.text?'继续草稿':'交代一件事'}</Text><ArrowUpRight size={18} color={c.muted}/></Pressable>}
      {!keyboard&&navigation}
    </AppDock>
  </View>;
}
const styles=(c:AppColors)=>StyleSheet.create({readerHead:{flexDirection:'row',alignItems:'center',paddingHorizontal:20},page:{flex:1},layer:{...StyleSheet.absoluteFill},retained:{opacity:0,zIndex:-1},hidden:{display:'none'},list:{paddingVertical:10},load:{minHeight:52,alignItems:'center',justifyContent:'center'},beginning:{fontSize:12,color:c.faint,textAlign:'center',padding:24},empty:{...StyleSheet.absoluteFill,alignItems:'center',justifyContent:'center',gap:12,padding:32},emptyTitle:{fontSize:22,fontWeight:'500',color:c.ink},note:{fontSize:13,lineHeight:20,color:c.muted},latest:{position:'absolute',bottom:12,alignSelf:'center',flexDirection:'row',gap:7,alignItems:'center',minHeight:44,paddingHorizontal:16,backgroundColor:c.raised,borderWidth:StyleSheet.hairlineWidth,borderColor:c.outline,borderRadius:22},error:{position:'absolute',top:0,left:12,right:12,padding:12,borderRadius:12,backgroundColor:c.soft},compact:{minHeight:48,paddingHorizontal:14,flexDirection:'row',gap:10,alignItems:'center',backgroundColor:c.surface,borderRadius:16},compactText:{flex:1,fontSize:15,color:c.ink}});
