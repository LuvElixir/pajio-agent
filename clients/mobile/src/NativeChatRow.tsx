import {memo, useState} from 'react';
import {Alert, Linking, Modal, Pressable, ScrollView, StyleSheet, Text, View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {useAppTheme, useThemedStyles, type AppColors} from './app-theme';
import {useReducedMotion} from './experience/primitives';
import {type ChatMessage, liveStatuses} from './native-chat';

const labels: Record<string,string>={draft:'已保存',starting:'正在开始',running:'正在回应',waiting_for_approval:'有一步等你确认',stopping:'正在停止',connection_lost:'连接中断，等待核对',ambiguous:'运行状态待核对',failed:'本轮未完成',stopped:'已停止',completed_unverified:'',verified:'已核对',closed_by_user:'已结案'};
function inline(text:string,color:string) {
  return text.split(/(\*\*[^*]+\*\*|\[[^\]]+\]\(https?:\/\/[^\s)]+\))/g).map((part,i)=>{
    const link=part.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/);
    if(link) return <Text key={i} accessibilityRole="link" style={{color,textDecorationLine:'underline'}} onPress={()=>{void Linking.openURL(link[2]).catch(()=>Alert.alert('暂时无法打开链接'));}}>{link[1]}</Text>;
    return part.startsWith('**')&&part.endsWith('**')?<Text key={i} style={{fontWeight:'600'}}>{part.slice(2,-2)}</Text>:part;
  });
}
/** Native text selection, links, and system type. No HTML parser or browser surface. */
export function ChatText({text,color}:{text:string;color:string}) {
  return <Text selectable style={{fontSize:17,lineHeight:27,color}}>{inline(text.replace(/^#{1,6}\s+/gm,''),color)}</Text>;
}
export const NativeChatRow=memo(function NativeChatRow({message,onTask,onArtifact,onDecision,disabled}:{message:ChatMessage;onTask:(id:string)=>void;onArtifact:(id:string)=>void;onDecision:(id:string,request:string,choice:string)=>void;disabled:boolean}) {
  const s=useThemedStyles(styles),{colors:c}=useAppTheme(); const [expanded,setExpanded]=useState(false);const reduced=useReducedMotion();
  const turn=message.turn, approval=turn.approval, card=approval?.card;
  const output=turn.output || '', lengthy=output.length>6000;
  const background=message.kind==='goal_step'||message.kind==='schedule_run';
  const status=message.queued?'已排队，轮到后开始':labels[turn.status]??'状态待确认';
  return <View style={s.row} testID={'chat-row-'+message.id}>
    <View style={background?s.context:s.user}><ChatText text={message.content} color={background?c.muted:c.onAction}/></View>
    {!!output&&<View style={s.assistant}><ChatText text={lengthy?output.slice(0,6000)+'…':output} color={c.ink}/>{lengthy&&<Pressable accessibilityRole="button" onPress={()=>setExpanded(true)} style={s.action}><Text style={s.link}>展开完整回复</Text></Pressable>}</View>}
    {turn.artifacts?.map(file=><Pressable key={file.id} accessibilityRole="button" onPress={()=>onArtifact(file.id)} style={s.file}><Text style={s.link}>查看文件 · {file.title}</Text></Pressable>)}
    {turn.status==='waiting_for_approval'&&card&&approval?.request_id&&<View style={s.approval}>
      <Text accessibilityRole="header" style={s.title}>{card.title}</Text><ChatText text={card.action} color={c.ink}/>{card.impact&&<Text style={s.detail}>{card.impact}</Text>}{card.command&&<Text selectable style={s.code}>{card.command}</Text>}
      {approval.card_state==='pending'?<View style={s.actions}><Pressable disabled={disabled} accessibilityRole="button" onPress={()=>onDecision(turn.id,approval.request_id!, 'once')} style={s.confirm}><Text style={s.confirmText}>{card.confirm_label||'确认这一步'}</Text></Pressable><Pressable disabled={disabled} accessibilityRole="button" onPress={()=>onDecision(turn.id,approval.request_id!,'deny')} style={s.action}><Text style={s.link}>不执行</Text></Pressable></View>:<Text style={s.detail}>决定已提交或需要核对，请查看最新进展。</Text>}
    </View>}
    <Pressable accessibilityRole="button" accessibilityLabel={(status||'查看任务进展')+'，打开任务详情'} onPress={()=>onTask(turn.id)} style={s.receipt}>
      <Text style={[s.detail,turn.status==='failed'&&{color:c.danger}]}>{status||(new Date(message.created_at).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'}))}{liveStatuses.has(turn.status)?' · 查看进展':' · 详情'}</Text>
    </Pressable>
    <Modal visible={expanded} animationType={reduced?'none':'slide'} allowSwipeDismissal presentationStyle="pageSheet" onRequestClose={()=>setExpanded(false)}><SafeAreaView style={{flex:1,backgroundColor:c.canvas}}><View style={s.readerHeader}><Text style={s.title}>完整回复</Text><Pressable accessibilityRole="button" onPress={()=>setExpanded(false)} style={s.action}><Text style={s.link}>完成</Text></Pressable></View><ScrollView contentContainerStyle={{padding:22}}><ChatText text={output} color={c.ink}/></ScrollView></SafeAreaView></Modal>
  </View>;
});
const styles=(c:AppColors)=>StyleSheet.create({
 row:{paddingHorizontal:16,paddingTop:12,paddingBottom:6,gap:12},user:{alignSelf:'flex-end',maxWidth:'88%',paddingHorizontal:16,paddingVertical:12,borderRadius:21,borderBottomRightRadius:6,backgroundColor:c.action},assistant:{alignSelf:'flex-start',maxWidth:'96%',padding:16,borderRadius:21,borderBottomLeftRadius:6,backgroundColor:c.surface,borderWidth:StyleSheet.hairlineWidth,borderColor:c.line},context:{paddingVertical:4},receipt:{minHeight:44,alignSelf:'flex-start',justifyContent:'center',paddingHorizontal:4},detail:{color:c.muted,fontSize:12,lineHeight:19},file:{minHeight:44,backgroundColor:c.soft,padding:12,borderRadius:12},link:{color:c.accentInk,fontSize:15,lineHeight:22},approval:{padding:16,borderRadius:16,gap:10,backgroundColor:c.surface,borderWidth:1,borderColor:c.outline},title:{color:c.ink,fontSize:18,fontWeight:'600'},actions:{flexDirection:'row',gap:12,flexWrap:'wrap'},action:{minHeight:44,justifyContent:'center',paddingHorizontal:12},confirm:{minHeight:44,justifyContent:'center',paddingHorizontal:16,borderRadius:12,backgroundColor:c.action},confirmText:{color:c.onAction,fontSize:15,fontWeight:'600'},code:{fontSize:13,lineHeight:20,color:c.muted},readerHeader:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',paddingHorizontal:20}
});
