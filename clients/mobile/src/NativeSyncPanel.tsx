import {useEffect,useRef,useState} from 'react';
import {Platform,Text,View} from 'react-native';
import {CalendarDays,ListChecks,CheckCircle2} from 'lucide-react-native';
import {useAppTheme} from './app-theme';
import {PrimaryButton} from './experience/primitives';
import {scopeOf,type Connection} from './core';
import {storage} from './storage';
import {type SyncLocal,type SyncSource} from './native-sync-model';
import {readNativeSyncLocal} from './native-sync-engine';
import {discoverNativeSyncSources,requestNativeSync,saveNativeSyncChoice} from './native-sync-runtime';

export function NativeSyncPanel({connection}:{connection:Connection}) {return <Content key={scopeOf(connection)} connection={connection}/>;}
function Content({connection}:{connection:Connection}) {
  const {colors:c}=useAppTheme(),scope=scopeOf(connection);
  const [state,setState]=useState<SyncLocal|null>(null),[ready,setReady]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [refreshFrom,setRefreshFrom]=useState<string|null|undefined>(undefined),[loadError,setLoadError]=useState('');
  const alive=useRef(false),locked=useRef(false);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  useEffect(()=>{let live=true;
    const load=async()=>{try{const next=await readNativeSyncLocal(storage,scope);if(live){setState(next);setReady(true);setLoadError('');}}catch(e){if(live)setLoadError(e instanceof Error?e.message:'同步设置暂时无法读取。');}};
    void load();const timer=setInterval(()=>void load(),1500);return()=>{live=false;clearInterval(timer);};
  },[scope]);
  const run=async(work:()=>Promise<void>)=>{if(locked.current||!alive.current)return;locked.current=true;setBusy(true);setError('');try{await work();}catch(e){if(alive.current)setError(e instanceof Error?e.message:'这次未完成。');}finally{locked.current=false;if(alive.current)setBusy(false);}};
  const connect=(kind:SyncSource['kind'])=>run(async()=>{
    const rows=await discoverNativeSyncSources(kind);if(!alive.current)return;
    if(!rows.length)throw new Error(kind==='event'?'已获得权限，系统日历暂时没有可用的日历。':'已获得权限，提醒事项暂时没有可用列表。');
    const before=await readNativeSyncLocal(storage,scope);if(!alive.current)return;
    const kinds=[...new Set([...(before?.allKinds||before?.desired.sources.map(s=>s.kind)||[]),kind])].sort() as SyncSource['kind'][];
    const sources:SyncSource[]=[];
    for(const k of kinds){sources.push(...(k===kind?rows:await discoverNativeSyncSources(k,false)));if(!alive.current)return;}
    setRefreshFrom(before?.receipt?.observed_at??null);
    const next=await saveNativeSyncChoice(connection,{enabled:true,sources,allKinds:kinds});if(alive.current)setState(next);
  });
  const runPending=!!state?.pendingConfig||!!state?.pending||state?.configured!==state?.choice;
  const updating=!!state?.desired.enabled&&(runPending||!state.receipt||refreshFrom!==undefined&&refreshFrom===(state.receipt?.observed_at??null));
  const issue=error||loadError||state?.error;
  const count=(kind:SyncSource['kind'])=>state?.desired.sources.filter(s=>s.kind===kind).length||0;
  return <View style={{backgroundColor:c.surface,borderRadius:24,padding:20,gap:18}}>
    <Text style={{fontSize:20,fontWeight:'600',color:c.ink}}>把安排放在一起</Text>
    <Text style={{fontSize:14,lineHeight:23,color:c.muted}}>授权一次，同步系统里的全部日历。在「今天」查看近期安排，不需要逐个选择。</Text>
    {(['event',...(Platform.OS==='ios'?['reminder']:[])] as SyncSource['kind'][]).map(kind=>{
      const connected=!!state?.desired.enabled&&count(kind)>0,Icon=kind==='event'?CalendarDays:ListChecks;
      return <View key={kind} style={{gap:10}}><View style={{flexDirection:'row',alignItems:'center',gap:12}}><Icon size={23} color={c.ink}/><View style={{flex:1,gap:3}}><Text style={{fontSize:16,color:c.ink}}>{kind==='event'?'系统日历':'提醒事项'}</Text><Text style={{fontSize:13,color:c.muted}}>{connected?`已连接 · ${count(kind)} 个${kind==='event'?'日历':'列表'}`:kind==='event'?'包括 iCloud、订阅和本机日历':'可选，把待办也带过来'}</Text></View>{connected?<CheckCircle2 size={20} color={c.success}/>:null}</View>
      {!connected||!state?.allKinds?.includes(kind)?<PrimaryButton label={kind==='event'?'连接全部日历':'连接提醒事项'} tone={kind==='event'?'accent':'quiet'} disabled={busy||!ready} loading={busy} onPress={()=>void connect(kind)}/>:null}</View>;
    })}
    {state?.desired.enabled?<><PrimaryButton label={updating&&!issue?'正在同步…':'立即同步'} tone="quiet" disabled={busy||updating&&!issue} onPress={()=>{setError('');setRefreshFrom(state.receipt?.observed_at??null);requestNativeSync(scope);}}/><PrimaryButton label="停止同步" tone="quiet" disabled={busy} onPress={()=>void run(async()=>{const next=await saveNativeSyncChoice(connection,{...state.desired,enabled:false});if(alive.current){setState(next);setRefreshFrom(undefined);}})}/></>:null}
    <Text accessibilityLiveRegion="polite" style={{fontSize:13,lineHeight:21,color:c.muted}}>{issue?'这次同步没有完成。':updating?'正在读取日程并保存到「今天」…':state?.receipt&&state.desired.enabled?`已同步 · ${new Date(state.receipt.observed_at).toLocaleString('zh-CN')}`:'连接后，日程会出现在「今天」。'}</Text>
    {!!issue&&<Text accessibilityRole="alert" style={{color:c.danger,lineHeight:22}}>{issue}</Text>}
    <Text style={{fontSize:12,lineHeight:20,color:c.muted}}>App 打开时更新过去 7 天和未来 30 天的日程。仅保存副本，不修改系统原件。可随时停止同步。</Text>
  </View>;
}
