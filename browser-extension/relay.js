'use strict';
// Relays Rocket Scanner's basket requests to the extension. Replies carry `bridge` so the app can ignore a relay
// left behind by an older, reloaded copy of this extension (it can no longer reach the extension).
(()=>{
  const BRIDGE='1.2.0';
  const listener=async event=>{
    if(event.source!==window || event.origin!==location.origin) return;
    const m=event.data;
    if(m?.type!=='RS_KITE_PREPARE' || typeof m.id!=='string') return;
    if(!chrome.runtime?.id){ window.removeEventListener('message',listener); return; }  // orphaned by an extension reload
    let result;
    try { result=await chrome.runtime.sendMessage(m); }
    catch(e) { window.removeEventListener('message',listener); return; }
    window.postMessage({type:'RS_KITE_RESULT',id:m.id,bridge:BRIDGE,...result},location.origin);
  };
  // Re-injection after an extension reload replaces any listener this world already holds, so exactly one answers.
  if(window.__rocketKiteRelayListener) window.removeEventListener('message',window.__rocketKiteRelayListener);
  window.__rocketKiteRelayListener=listener;
  window.addEventListener('message',listener);
})();
