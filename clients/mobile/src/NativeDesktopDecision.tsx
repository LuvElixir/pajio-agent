import {useEffect,useRef,useState} from 'react';
import {Pressable,StyleSheet,Text,View} from 'react-native';
import {useAppTheme} from './app-theme';
import type {NativeChatApi} from './native-chat';
type Proposal={approval_id:string;revision:string;reason:string;state:string;can_decide?:boolean;task_eligible?:boolean;preview?:{app:string;action:string;text?:string;keys?:string[]}};
/** Uses the same revision-bound decision contract as the existing remote controls. */
export function NativeDesktopDecision({api,active,onRefresh}:{api:NativeChatApi;active:boolean;onRefresh:()=>void}) {
  const {colors:c}=useAppTheme(),[rows,setRows]=useState<Proposal[]>([]),[submitted,setSubmitted]=useState<Set<string>>(new Set()),[error,setError]=useState('');
  const decisions=useRef(new Set<string>());
  useEffect(()=>{
    if(!active)return;
    let live=true,timer:ReturnType<typeof setTimeout>;
    const load=async()=>{try{const data=await api.request('/api/devices/input-approvals');if(live&&Array.isArray(data.approvals)){setRows(data.approvals.filter((p:Proposal)=>p.state==='awaiting_user'&&typeof p.approval_id==='string'&&typeof p.revision==='string'));}}catch{if(live)setError('这一步的确认暂未读完整，请稍候。');}finally{if(live)timer=setTimeout(load,3500);}};
    void load();return()=>{live=false;clearTimeout(timer);};
  },[api,active]);
  async function decide(row:Proposal,choice:string){
    const key=row.approval_id+':'+row.revision;
    if(decisions.current.has(key)||!active)return;
    decisions.current.add(key);setSubmitted(new Set(decisions.current));setError('');
    try{await api.request('/api/devices/input-approvals',{approval_id:row.approval_id,revision:row.revision,choice});onRefresh();}
    catch{setError('决定送达状态待核对，请查看最新进展。');}
    // Keep this revision disabled even after an ambiguous response. Never replay.
  }
  return <View>{rows.map(row=><View key={row.approval_id} style={{padding:16,margin:12,gap:10,backgroundColor:c.surface,borderColor:c.outline,borderWidth:StyleSheet.hairlineWidth,borderRadius:16}}>
    <Text style={{fontSize:17,color:c.ink,fontWeight:'600'}}>这一步需要你确认</Text><Text selectable style={{fontSize:16,lineHeight:24,color:c.ink}}>{row.reason}</Text><Text selectable style={{fontSize:14,lineHeight:22,color:c.muted}}>{[row.preview?.app,row.preview?.action,row.preview?.text,row.preview?.keys?.join(' + ')].filter(Boolean).join(' · ')}</Text>
    {row.can_decide&&<View style={{flexDirection:'row',gap:12}}>{[{choice:row.task_eligible?'task':'once',label:row.task_eligible?'交给 Pajio':'确认这一步'},{choice:'deny',label:'先停一下'}].map(item=><Pressable key={item.choice} disabled={submitted.has(row.approval_id+':'+row.revision)||!active} accessibilityRole="button" onPress={()=>{void decide(row,item.choice);}} style={{padding:12,minHeight:44,backgroundColor:c.soft,borderRadius:12}}><Text style={{fontSize:15,color:c.accentInk}}>{submitted.has(row.approval_id+':'+row.revision)?'正在核对…':item.label}</Text></Pressable>)}</View>}
  </View>)}{!!error&&<Text style={{padding:12,color:c.muted,fontSize:13}}>{error}</Text>}</View>;
}
