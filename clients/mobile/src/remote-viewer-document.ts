import type {RemoteTransport} from './remote-device-model';
import {palettes} from './appearance';

/** App-owned viewer only. No service token, remote script, clipboard or persistent storage. */
export function remoteViewerDocument(transport: RemoteTransport, kind: 'computer' | 'android', expiresAt: number): string {
  const config = JSON.stringify({...transport, device_kind: kind, expires_at: expiresAt}).replace(/</g, '\\u003c');
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; media-src blob:; connect-src 'none'; img-src 'none'; form-action 'none'; base-uri 'none'"><style>html,body{margin:0;width:100%;height:100%;background:${palettes.night.canvas};overflow:hidden;overscroll-behavior:none}#viewport{position:absolute;inset:0;overflow:hidden;touch-action:none;user-select:none;-webkit-user-select:none}video{width:100%;height:100%;object-fit:contain;pointer-events:none;transform-origin:center}#cursor{position:absolute;width:16px;height:16px;border:2px solid #fff;border-radius:50%;box-shadow:0 1px 4px #000;pointer-events:none;display:none;transform:translate(-50%,-50%)}#shade{position:absolute;inset:0;background:${palettes.night.canvas};pointer-events:none}</style></head><body><div id="viewport"><video id="screen" autoplay playsinline muted></video><div id="cursor"></div></div><div id="shade"></div><script>
(() => {
  'use strict';
  const config = ${config};
  // Keep this inline: Hermes function.toString() does not preserve executable source.
  const video = document.getElementById('screen'), shade = document.getElementById('shade'), viewport = document.getElementById('viewport'), cursor = document.getElementById('cursor');
  let pc, channel, stopped=false, frozen=false, controlling=false, confirmed=false, shown=false, geometry=null, geometryAt=0, lastVideoAt=0;
  let seq=0, gesture=null, capabilities={}, heartbeat, watch, stats, pending=new Map(), latestMove=0, recoveringAt=0;
  let zoom=1, panX=0, panY=0, inputMode=config.device_kind==='computer'?'trackpad':'direct', cursorPoint=null, moveSeq=0, dragTimer=null, multi=null, suppressTouch=false;
  const fingers=new Map(), clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
  const post = value => {if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(value));};
  const scope = () => ({session_id:config.session_id,epoch:config.epoch,gateway_epoch:config.gateway_epoch});
  // Deliberately inline for Hermes; tests cover parity with the native boundary.
  function textIssue(text) {
    if(capabilities.text!=='unicode')return 'text_unavailable';
    const limit=(value,fallback)=>Number.isSafeInteger(value)&&value>0?Math.min(value,4096):fallback;
    const points=Array.from(text);
    if(points.some(point=>{const value=point.codePointAt(0);return value>=0xd800&&value<=0xdfff;}))return 'text_invalid';
    if(capabilities.text_disallow_controls===true&&/[\\u0000-\\u001f\\u007f]/.test(text))return 'text_invalid';
    if(points.length>limit(capabilities.text_max_chars,config.device_kind==='android'?4096:32))return 'text_too_long';
    if(new TextEncoder().encode(text).length>limit(capabilities.text_max_bytes,4096))return 'text_too_large';
    return null;
  }
  function stop(reason) {
    if(stopped)return; stopped=true; frozen=true; clearTimeout(dragTimer); gesture=null; fingers.clear(); cursor.style.display='none'; shade.style.display='block';
    clearInterval(heartbeat);clearInterval(watch);clearInterval(stats);pending.clear();
    if(channel)channel.close();if(pc)pc.close();video.pause();video.srcObject=null;
    post({type:'stopped',reason});
  }
  function canInput() {return controlling&&!stopped&&!frozen&&confirmed&&shown&&channel&&channel.readyState==='open'&&geometry&&Date.now()-geometryAt<1800&&Date.now()-lastVideoAt<2500&&video.videoWidth===geometry.width&&video.videoHeight===geometry.height;}
  function sendRaw(value) {
    if(stopped||!channel||channel.readyState!=='open')return false;
    if(channel.bufferedAmount>8192){stop('slow_connection');return false;}
    const text=JSON.stringify(value);if(new TextEncoder().encode(text).length>20480)return false;
    try{channel.send(text);return true;}catch{stop('connection_lost');return false;}
  }
  function input(action, values) {
    if(!canInput()){post({type:'notice',code:'frame_not_ready'});return;}
    const capability=action==='tap'||action==='swipe'?'touch':action==='key'||action==='text'?'keyboard':action;
    if(capabilities[capability]!==true){post({type:'notice',code:'input_unavailable'});return;}
    const n=++seq;
    if(sendRaw({type:'input',...scope(),seq:n,frame_id:geometry.frame_id,action,...values})){pending.set(n,Date.now());return n;}
    return 0;
  }
  function frameShown() {
    if(stopped)return;lastVideoAt=Date.now();
    if(confirmed&&geometry&&(!recoveringAt||Date.now()-geometryAt<1800)&&video.videoWidth===geometry.width&&video.videoHeight===geometry.height){
      recoveringAt=0;
      if(!shown){shown=true;post({type:'live',capabilities});renderViewport();}
      shade.style.display=frozen?'block':'none';
    } else {shown=false;shade.style.display='block';}
    if(video.requestVideoFrameCallback)video.requestVideoFrameCallback(frameShown);
  }
  function viewBox(){return viewport.getBoundingClientRect();}
  function fit(){const b=viewBox();return geometry?Math.min(b.width/geometry.width,b.height/geometry.height):1;}
  function renderViewport(){
    if(!geometry)return;const b=viewBox(),scale=fit()*zoom;
    panX=clamp(panX,-Math.max(0,(geometry.width*scale-b.width)/2),Math.max(0,(geometry.width*scale-b.width)/2));
    panY=clamp(panY,-Math.max(0,(geometry.height*scale-b.height)/2),Math.max(0,(geometry.height*scale-b.height)/2));
    video.style.transform='translate('+panX+'px,'+panY+'px) scale('+zoom+')';
    if(!cursorPoint)cursorPoint={x:geometry.width/2,y:geometry.height/2};
    cursor.style.left=(b.width/2+panX+(cursorPoint.x-geometry.width/2)*scale)+'px';
    cursor.style.top=(b.height/2+panY+(cursorPoint.y-geometry.height/2)*scale)+'px';
    cursor.style.display=shown&&controlling&&inputMode==='trackpad'?'block':'none';
  }
  function viewState(){post({type:'viewport',zoom:Math.round(zoom*100),input_mode:inputMode});}
  function zoomAt(next, x, y){
    const b=viewBox(),before=zoom;zoom=clamp(next,1,4);
    panX=x-b.width/2-(x-b.width/2-panX)*zoom/before;
    panY=y-b.height/2-(y-b.height/2-panY)*zoom/before;renderViewport();viewState();
  }
  function local(e){const b=viewBox();return {x:e.clientX-b.left,y:e.clientY-b.top};}
  function locate(p,bounded=false){
    if(!geometry)return null;const b=viewBox(),scale=fit()*zoom;
    const x=(p.x-b.width/2-panX)/scale+geometry.width/2,y=(p.y-b.height/2-panY)/scale+geometry.height/2;
    if(!bounded&&(x<0||x>=geometry.width||y<0||y>=geometry.height))return null;
    return {x:clamp(Math.floor(x),0,geometry.width-1),y:clamp(Math.floor(y),0,geometry.height-1)};
  }
  function endHeld(){
    clearTimeout(dragTimer);dragTimer=null;
    if(gesture&&gesture.held){
      if(!canInput()){stop('stale_video');return false;}
      input('pointer',{phase:'up',...gesture.last,button:gesture.button});gesture.held=false;
    }return !stopped;
  }
  function resetGesture(){clearTimeout(dragTimer);dragTimer=null;gesture=null;multi=null;fingers.clear();suppressTouch=false;}
  function clickAt(p,button=0){
    if(capabilities.pointer===true){input('pointer',{phase:'down',...p,button});input('pointer',{phase:'up',...p,button});}
    else if(capabilities.touch===true)input('tap',p);
  }
  function movePointer(p,button){
    // One outstanding move at a time. Drop intermediate positions, never queue
    // a trajectory for replay. Down/up retain their ordering on the channel.
    if(moveSeq||Date.now()-latestMove<50)return;
    latestMove=Date.now();moveSeq=input('pointer',{phase:'move',...p,button})||0;
  }
  viewport.addEventListener('pointerdown',e=>{
    e.preventDefault();if(stopped||frozen||!shown)return;
    const p=local(e);fingers.set(e.pointerId,p);viewport.setPointerCapture(e.pointerId);
    if(fingers.size>1){
      if(!endHeld())return;gesture=null;suppressTouch=true;
      const [a,b]=Array.from(fingers.values());
      multi={distance:Math.max(1,Math.hypot(a.x-b.x,a.y-b.y)),zoom,panX,panY,x:(a.x+b.x)/2,y:(a.y+b.y)/2};return;
    }
    if(suppressTouch)return;
    const point=locate(p); // Letterbox starts never issue a remote action.
    const remote=canInput()&&!!point&&(capabilities.pointer===true||capabilities.touch===true);
    gesture={id:e.pointerId,origin:p,local:p,start:point,last:inputMode==='trackpad'?{...cursorPoint}:point,at:Date.now(),width:geometry.width,height:geometry.height,button:e.button===2?2:0,remote,moved:false,held:false};
    if(remote&&capabilities.pointer===true&&inputMode==='trackpad'){
      const g=gesture;
      dragTimer=setTimeout(()=>{if(gesture!==g||g.moved||fingers.size!==1||!canInput())return;
        g.held=true;input('pointer',{phase:'down',...g.last,button:0});},420);
    }
  });
  viewport.addEventListener('pointermove',e=>{
    if(!fingers.has(e.pointerId))return;e.preventDefault();const p=local(e);fingers.set(e.pointerId,p);
    if(multi&&fingers.size>=2){
      const [a,b]=Array.from(fingers.values()),bBox=viewBox();
      zoom=clamp(multi.zoom*Math.hypot(a.x-b.x,a.y-b.y)/multi.distance,1,4);
      panX=(a.x+b.x)/2-bBox.width/2-(multi.x-bBox.width/2-multi.panX)*zoom/multi.zoom;
      panY=(a.y+b.y)/2-bBox.height/2-(multi.y-bBox.height/2-multi.panY)*zoom/multi.zoom;
      renderViewport();viewState();return;
    }
    if(suppressTouch||!gesture||gesture.id!==e.pointerId)return;const g=gesture;
    if(geometry.width!==g.width||geometry.height!==g.height){stop('geometry_changed');return;}
    const dx=p.x-g.local.x,dy=p.y-g.local.y;g.local=p;
    if(Math.hypot(p.x-g.origin.x,p.y-g.origin.y)>6){g.moved=true;clearTimeout(dragTimer);}
    if(!g.remote){panX+=dx;panY+=dy;renderViewport();return;}
    if(!canInput()){if(g.held)stop('stale_video');else{g.remote=false;controlling=false;post({type:'control',enabled:false});}return;}
    if(inputMode==='trackpad'&&capabilities.pointer===true){
      const scale=fit()*zoom;cursorPoint={x:clamp(Math.round(cursorPoint.x+dx/scale),0,geometry.width-1),y:clamp(Math.round(cursorPoint.y+dy/scale),0,geometry.height-1)};
      g.last=cursorPoint;
      // Keep the cursor visible when a magnified desktop reaches the viewport edge.
      const b=viewBox(),x=b.width/2+panX+(cursorPoint.x-geometry.width/2)*scale,y=b.height/2+panY+(cursorPoint.y-geometry.height/2)*scale;
      panX+=clamp(x,24,b.width-24)-x;panY+=clamp(y,24,b.height-24)-y;renderViewport();
      if(g.moved)movePointer(g.last,g.button);
    }else{
      g.last=locate(p,true);
      if(capabilities.pointer===true&&g.moved){if(!g.held){g.held=true;input('pointer',{phase:'down',...g.start,button:g.button});}movePointer(g.last,g.button);}
    }
  });
  viewport.addEventListener('pointerup',e=>{
    e.preventDefault();fingers.delete(e.pointerId);clearTimeout(dragTimer);
    if(suppressTouch){if(!fingers.size)resetGesture();return;}
    if(!gesture||gesture.id!==e.pointerId)return;const g=gesture;
    if(!g.remote){resetGesture();return;}
    if(!canInput()){if(g.held)stop('stale_video');else resetGesture();return;}
    const p=inputMode==='trackpad'&&capabilities.pointer===true?g.last:locate(local(e),true)||g.last;
    if(capabilities.pointer===true){
      if(g.held)input('pointer',{phase:'up',...p,button:g.button});
      else if(!g.moved)clickAt(p,Date.now()-g.at>500?2:g.button);
    }else if(capabilities.touch===true){
      const distance=Math.hypot(p.x-g.start.x,p.y-g.start.y),duration=Math.max(80,Math.min(1000,Date.now()-g.at));
      if(distance<12&&duration<500)input('tap',p);
      else input('swipe',{...g.start,to_x:p.x,to_y:p.y,duration_ms:duration});
    }
    resetGesture();
  });
  viewport.addEventListener('pointercancel',e=>{fingers.delete(e.pointerId);if(endHeld())resetGesture();});
  viewport.addEventListener('contextmenu',e=>e.preventDefault());
  viewport.addEventListener('wheel',e=>{e.preventDefault();if(e.ctrlKey){const b=viewBox();zoomAt(zoom*(e.deltaY<0?1.1:1/1.1),b.width/2,b.height/2);return;}
    if(capabilities.scroll===true)input('scroll',{delta_x:clamp(Math.round(e.deltaX),-1000,1000),delta_y:clamp(Math.round(e.deltaY),-1000,1000)});},{passive:false});
  window.addEventListener('resize',()=>{if(endHeld())resetGesture();renderViewport();});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)stop('background');});
  window.addEventListener('pagehide',()=>stop('background'));
  window.addEventListener('offline',()=>stop('connection_lost'));
  window.pajioReceive = async message => {
    if(stopped||!message||typeof message!=='object')return;
    if(message.type==='stop'){stop('closed');return;}
    if(message.type==='freeze'){if(!endHeld())return;frozen=true;resetGesture();cursor.style.display='none';shade.style.display='block';return;}
    if(message.type==='control'){
      if(!endHeld())return;resetGesture();
      if(message.enabled===true&&(!shown||recoveringAt)){post({type:'notice',code:'frame_not_ready'});return;}
      controlling=message.enabled===true;renderViewport();post({type:'control',enabled:controlling});return;
    }
    if(message.type==='viewport'){
      if(!shown||!endHeld())return;resetGesture();
      if(message.mode==='direct'||(message.mode==='trackpad'&&config.device_kind==='computer'))inputMode=message.mode;
      if(typeof message.zoom==='number'&&Number.isFinite(message.zoom)){const b=viewBox();zoomAt(message.zoom,b.width/2,b.height/2);}
      if(message.reset===true){zoom=1;panX=0;panY=0;}
      renderViewport();viewState();return;
    }
    if(message.type==='click'&&config.device_kind==='computer'&&canInput()&&cursorPoint&&!gesture){clickAt(cursorPoint,message.button===2?2:0);return;}
    if(message.type==='answer'){
      if(message.gateway_epoch!==config.gateway_epoch||typeof message.sdp!=='string'){stop('session_changed');return;}
      try{await pc.setRemoteDescription({type:'answer',sdp:message.sdp});}catch{stop('negotiation_failed');}return;
    }
    if(message.type==='key'&&typeof message.key==='string'&&message.key.length<=32){input('key',{key:message.key,phase:'down'});input('key',{key:message.key,phase:'up'});return;}
    if(message.type==='scroll'&&capabilities.scroll===true&&typeof message.delta_y==='number'&&Number.isFinite(message.delta_y)){
      input('scroll',{delta_x:0,delta_y:Math.max(-1000,Math.min(1000,Math.round(message.delta_y)))});return;
    }
    if(message.type==='text'&&typeof message.text==='string'){
      const issue=textIssue(message.text);if(issue){post({type:'notice',code:issue});return;}
      input('text',{text:message.text});
    }
  };
  async function start(){
    if(typeof RTCPeerConnection==='undefined'){stop('webrtc_unavailable');return;}
    pc=new RTCPeerConnection({iceServers:config.ice_servers,bundlePolicy:'max-bundle'});
    pc.addTransceiver('video',{direction:'recvonly'});
    pc.ontrack=e=>{video.srcObject=e.streams[0]||new MediaStream([e.track]);video.play().catch(()=>stop('playback_failed'));};
    video.addEventListener('loadeddata',()=>{if(video.requestVideoFrameCallback)video.requestVideoFrameCallback(frameShown);else frameShown();});
    video.addEventListener('timeupdate',()=>{if(!video.requestVideoFrameCallback)frameShown();});
    pc.onconnectionstatechange=()=>{if(['failed','disconnected','closed'].includes(pc.connectionState))stop('connection_lost');};
    channel=pc.createDataChannel('pajio-control',{ordered:true});
    channel.onclose=()=>stop('connection_lost');channel.onerror=()=>stop('connection_lost');
    channel.onopen=()=>{sendRaw({type:'heartbeat',...scope()});heartbeat=setInterval(()=>sendRaw({type:'heartbeat',...scope()}),5000);};
    channel.onmessage=e=>{
      if(stopped||typeof e.data!=='string'||e.data.length>20480)return;let m;try{m=JSON.parse(e.data);}catch{stop('invalid_channel');return;}
      if(m.type==='ready'){
        if(m.session_id!==config.session_id||m.epoch!==config.epoch||m.gateway_epoch!==config.gateway_epoch){stop('session_changed');return;}
        confirmed=true;capabilities=m.capabilities||{};post({type:'channel_ready',capabilities});
      }else if(m.type==='frame'){
        if(m.gateway_epoch!==config.gateway_epoch||typeof m.frame_id!=='string'||m.frame_id.length>128||!Number.isInteger(m.width)||!Number.isInteger(m.height)||m.width<1||m.height<1||m.width>8192||m.height>8192){stop('invalid_frame');return;}
        if(m.geometry_revision!==undefined&&(!Number.isSafeInteger(m.geometry_revision)||m.geometry_revision<0)){stop('invalid_frame');return;}
        if(geometry&&(geometry.width!==m.width||geometry.height!==m.height||geometry.geometry_revision!==m.geometry_revision)){stop('geometry_changed');return;}
        geometry=m;geometryAt=Date.now();
      }else if(m.type==='input_ack'){pending.delete(m.seq);if(moveSeq===m.seq)moveSeq=0;}
      else if(m.type==='error'){if(m.seq)pending.delete(m.seq);if(moveSeq===m.seq)moveSeq=0;post({type:'notice',code:typeof m.code==='string'?m.code:'input_rejected'});if(!m.seq)stop('session_changed');}
    };
    watch=setInterval(()=>{
      if(stopped)return;
      if(Date.now()>config.expires_at*1000){stop('expired');return;}
      for(const at of pending.values())if(Date.now()-at>2500){stop('input_unconfirmed');return;}
      if(recoveringAt&&Date.now()-recoveringAt>10000){stop('stale_video');return;}
      if(shown&&(Date.now()-geometryAt>2500||Date.now()-lastVideoAt>3000)){
        // A held gesture cannot safely survive a gap. Idle viewing can recover,
        // but fresh frames never restore control or replay the previous input.
        if(gesture?.held||pending.size){stop('stale_video');return;}
        resetGesture();shown=false;controlling=false;recoveringAt=Date.now();cursor.style.display='none';shade.style.display='block';
        post({type:'buffering'});return;
      }
    },300);
    stats=setInterval(async()=>{try{if(stopped)return;const values=await pc.getStats();let rtt=null;values.forEach(v=>{if(v.type==='candidate-pair'&&v.state==='succeeded'&&v.nominated&&typeof v.currentRoundTripTime==='number')rtt=Math.round(v.currentRoundTripTime*1000);});if(rtt!==null)post({type:'quality',rtt_ms:rtt});}catch{}},3000);
    try{
      const offer=await pc.createOffer();await pc.setLocalDescription(offer);
      await new Promise((resolve,reject)=>{if(pc.iceGatheringState==='complete'){resolve();return;}const timer=setTimeout(()=>reject(new Error('ice timeout')),12000);pc.addEventListener('icegatheringstatechange',()=>{if(pc.iceGatheringState==='complete'){clearTimeout(timer);resolve();}});});
      if(!stopped)post({type:'offer',sdp:pc.localDescription.sdp});
    }catch{stop('negotiation_failed');}
  }
  start();
})();
</script></body></html>`;
}
