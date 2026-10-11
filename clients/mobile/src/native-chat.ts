import {ApiError, connectionEndpoint, connectionHeaders, scopeOf, type Connection, type RecordItem, type Store} from './core';
import {accountWorkAllowed} from './account-work';

export type ChatMessage = {id: string | number; task_id: string; content: string; created_at: string; kind?: string; queued?: boolean; queue_state?: string; turn: {id: string; identity_id: string; output: string; status: string; updated_at: string; artifacts?: {id: string; title: string}[]; approval?: {kind?: string; request_id?: string; card_state?: string; card?: {title: string; action: string; impact?: string; command?: string; confirm_label: string}}}};
export type ChatPage = {identity: string; items: ChatMessage[]; next_cursor: string | null; latest_cursor: string | null; has_more: boolean; direction: 'before'|'after'};
export const liveStatuses = new Set(['starting','running','waiting_for_approval','stopping','connection_lost','ambiguous']);
export const chatKey = (message: ChatMessage) => String(message.id);
export function readChatPage(value: unknown, identity: string): ChatPage {
  const page = value as ChatPage;
  if (!page || page.identity !== identity || !Array.isArray(page.items) || page.items.length > 160 || typeof page.has_more !== 'boolean' || !['before','after'].includes(page.direction) || [page.next_cursor,page.latest_cursor].some(v => v !== null && (typeof v !== 'string' || v.length > 2048))) throw new ApiError('聊天记录尚未读完整，请重试。',422);
  const ids = new Set<string>();
  for (const m of page.items) {
    if (!m || !['string','number'].includes(typeof m.id) || ids.has(String(m.id)) || !/^[a-f0-9]{32}$/.test(m.task_id) || typeof m.content !== 'string' || !Number.isFinite(Date.parse(m.created_at)) || m.turn?.id !== m.task_id || m.turn.identity_id !== identity || typeof m.turn.output !== 'string' || typeof m.turn.status !== 'string') throw new ApiError('这页对话与当前身份不一致，请重新读取。',422);
    ids.add(String(m.id));
  }
  return page;
}
/** Preserve row references so typing and polling do not re-render old messages. Latest first. */
export function mergeChat(previous: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const byId = new Map(previous.map(m => [chatKey(m),m]));
  let changed = false, inserted = false;
  for (const message of incoming) {
    const old = byId.get(chatKey(message));
    if (!old || JSON.stringify(old) !== JSON.stringify(message)) {byId.set(chatKey(message),message); changed=true; if(!old)inserted=true;}
  }
  if (!changed) return previous;
  // Streamed output updates must not re-sort a history the reader has already
  // paged through. The server keeps message timestamps and IDs immutable.
  if (!inserted) return previous.map(message=>byId.get(chatKey(message))!);
  return [...byId.values()].sort((a,b) => b.created_at.localeCompare(a.created_at) || (String(b.id)>String(a.id)?1:-1));
}
export type ChatJournal = {text: string; voiceIds: string[]; pending?: {id: string; content: string}; uncertainRecord?: boolean};
/** This journal is account scoped, durable before send, and never replays automatically. */
export class ChatDraft {
  readonly key: string;
  constructor(connection: Connection, private store: Pick<Store,'get'|'put'>, private uuid:()=>string, readonly context: string) {this.key='native-chat:v1:'+scopeOf(connection)+'|'+context;}
  async load(): Promise<ChatJournal> {
    const value=await this.store.get<ChatJournal>(this.key);
    if(!value)return {text:'',voiceIds:[]};
    if(typeof value.text!=='string'||value.text.length>12000||!Array.isArray(value.voiceIds)||value.voiceIds.some(id=>typeof id!=='string')||value.pending&&(!/^[A-Za-z0-9_-]{16,80}$/.test(value.pending.id)||typeof value.pending.content!=='string'))throw new ApiError('本机草稿暂时无法读取，请保留数据。');
    return value;
  }
  async save(value: ChatJournal) {await this.store.put(this.key,value);}
  async prepare(value: ChatJournal, content: string): Promise<ChatJournal> {
    const pending = value.pending?.content === content ? value.pending : {id:this.uuid(),content};
    const next = {...value,text:content,pending}; await this.save(next); return next;
  }
}
export class NativeChatApi {
  private requests = new Set<AbortController>();
  private token = '';
  private closed = false;
  constructor(readonly connection: Connection, private fetcher: typeof fetch, private current:()=>boolean) {}
  close() {this.closed=true; this.cancel();}
  cancel() {for(const request of this.requests) request.abort();}
  private check() {if(this.closed || !this.current() || !accountWorkAllowed(this.connection)) throw new ApiError('当前账户或页面已切换。',409);}
  async request(path: string, body?: unknown): Promise<any> {
    this.check();
    if(body!==undefined&&!this.token) {const b=await this.request('/api/bootstrap'); if(typeof b.token!=='string') throw new ApiError('服务暂时未就绪。'); this.token=b.token;}
    this.check();
    const controller=new AbortController(), timer=setTimeout(()=>controller.abort(),15000); this.requests.add(controller);
    try {
      const response=await this.fetcher(new URL(path,connectionEndpoint(this.connection)),{method:body===undefined?'GET':'POST',redirect:'error',signal:controller.signal,headers:{...connectionHeaders(this.connection),'X-Wearing-Identity':this.connection.identity,...(body===undefined?{}:{'Content-Type':'application/json','X-Wearing-Token':this.token})},...(body===undefined?{}:{body:JSON.stringify(body)})});
      this.check(); if(controller.signal.aborted) throw new Error('cancelled');
      const data=await response.json(); this.check(); if(controller.signal.aborted)throw new Error('cancelled');
      if(!response.ok) {if(response.status===403)this.token='';throw new ApiError(typeof data.detail==='string'?data.detail:'暂时无法连接，请重试。',response.status);}
      return data;
    } finally {clearTimeout(timer);this.requests.delete(controller);}
  }
  async page(options: {before?:string;after?:string;watch?:string[]}={}): Promise<ChatPage> {
    const query=new URLSearchParams({limit:'40'}); if(options.before)query.set('before',options.before);if(options.after)query.set('after',options.after);if(options.watch?.length)query.set('watch',options.watch.join(','));
    return readChatPage(await this.request('/api/conversation?'+query),this.connection.identity);
  }
  async send(content:string,id:string,record?:RecordItem|null) {
    const result=await this.request('/api/conversation',{content,...(record?{life_record_id:record.id,life_revision:record.revision}:{request_id:id})});
    if(!result||!result.task||!/^[a-f0-9]{32}$/.test(result.task.id)||!['submitted','queued','saved'].includes(result.delivery))throw new ApiError('未收到保存回执，原话已保留。');
    return result as {task:{id:string};delivery:string;reason?:string};
  }
}
