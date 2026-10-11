import test from 'node:test';
import assert from 'node:assert/strict';
import {ChatDraft,NativeChatApi,mergeChat,readChatPage,type ChatMessage} from './native-chat';
import type {Connection} from './core';
const connection:Connection={endpoint:'http://127.0.0.1:8891/',identity:'daily'};
const message=(id:number):ChatMessage=>({id,task_id:id.toString(16).padStart(32,'0'),content:'消息 '+id,created_at:new Date(1700000000000+id*1000).toISOString(),turn:{id:id.toString(16).padStart(32,'0'),identity_id:'daily',output:'回复 '+id,status:'running',updated_at:'2026-10-12T00:00:00Z'}});
const page=(items:ChatMessage[])=>({identity:'daily',items,next_cursor:null,latest_cursor:null,has_more:false,direction:'before'});
test('10,000 rows preserve old references during one streamed update and prepend',()=>{
 const rows=Array.from({length:10000},(_,i)=>message(i));const previous=mergeChat([],rows);
 assert.equal(mergeChat(previous,rows.slice(-40)),previous);
 const changed={...rows[9999],turn:{...rows[9999].turn,output:'reply grows'}};
 const result=mergeChat(previous,[changed,message(10000)]);
 assert.equal(result.length,10001);assert.equal(result[0].id,10000);assert.equal(result[1],changed);assert.equal(result[2],previous[1]);
 assert.equal(mergeChat(result,rows.slice(0,40)),result);
});
test('reject foreign identity, duplicate rows and malformed pagination',()=>{
 assert.equal(readChatPage(page([message(1)]),'daily').items.length,1);
 assert.throws(()=>readChatPage(page([message(1)]),'work'));
 assert.throws(()=>readChatPage(page([message(1),message(1)]),'daily'));
 assert.throws(()=>readChatPage(page([{...message(1),turn:{...message(1).turn,identity_id:'work'}}]),'daily'));
});
test('lost send keeps request id across reload; drafts and voice receipts remain scoped',async()=>{
 const values=new Map<string,unknown>();const store={get:async<T>(key:string)=>values.get(key) as T,put:async(key:string,value:unknown)=>{values.set(key,value);}};
 let ids=0;const draft=new ChatDraft(connection,store,()=>String(++ids).padStart(32,'0'),'daily');
 const value=await draft.prepare({text:'你好',voiceIds:['voice-1']},'你好');
 const reopened=new ChatDraft(connection,store,()=>String(++ids).padStart(32,'0'),'daily');
 assert.equal((await reopened.prepare(await reopened.load(),'你好')).pending!.id,value.pending!.id);
 assert.deepEqual((await reopened.load()).voiceIds,['voice-1']);
 assert.equal((await new ChatDraft({...connection,identity:'work'},store,()=>'', 'work').load()).text,'');
});
test('a late reply after account switch cannot publish and close cancels fetch',async()=>{
 let allowed=true,finish!:(r:Response)=>void,signal:AbortSignal|null|undefined;
 const api=new NativeChatApi(connection,async(_url,init)=>{signal=init?.signal;return new Promise(resolve=>{finish=resolve;});},()=>allowed);
 const pending=api.page();allowed=false;api.close();assert.equal(signal?.aborted,true);
 finish(new Response(JSON.stringify(page([message(1)]))));await assert.rejects(pending);
});
test('send includes stable id, never auto retries POST on 403',async()=>{
 let posts=0;
 const api=new NativeChatApi(connection,async(_url,init)=>{if(init?.method==='POST'){posts++;assert.equal(JSON.parse(String(init.body)).request_id,'same-submission-123');return new Response(JSON.stringify({detail:'denied'}),{status:403});}return new Response(JSON.stringify({token:'csrf'}));},()=>true);
 await assert.rejects(api.send('hello','same-submission-123'));assert.equal(posts,1);
});
test('native history, draft and submission are covered by account deletion fences',async()=>{
 const {fenceFor,fencedWrite,keyScope}=await import('./account-cleanup-model');
 const {scopeOf}=await import('./core');
 const signed:Connection={endpoint:'https://pajio.example/',identity:'daily',session:{userId:'user_'+'c'.repeat(32),tenantId:'home',credentialId:'d'.repeat(32),expiresAt:'2030-01-01T00:00:00Z'}};
 for(const key of ['native-chat:v1:'+scopeOf(signed)+'|{"identity":"daily"}','native-chat-cache:v1:'+scopeOf(signed)]){assert.equal(keyScope(key),scopeOf(signed));assert.equal(fencedWrite(key,{},[fenceFor(signed)]),true);}
});
