'use strict';
window.addEventListener('message', async event => {
  if(event.source!==window || event.origin!==location.origin) return;
  const m=event.data;
  if(m?.type!=='RS_KITE_PREPARE' || typeof m.id!=='string') return;
  let result;
  try { result=await chrome.runtime.sendMessage(m); }
  catch(e) { result={ok:false,why:'Reload Rocket Scanner after enabling the Kite Basket Bridge.'}; }
  window.postMessage({type:'RS_KITE_RESULT',id:m.id,...result},location.origin);
});
