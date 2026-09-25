'use strict';
importScripts('kite-import.js');
let busy=false;
chrome.runtime.onMessage.addListener((m,sender,reply)=>{
  if(m?.type!=='RS_KITE_PREPARE' || !sender.url?.startsWith('https://axionaut.github.io/rocket-scanner/')) return;
  if(busy){ reply({ok:false,why:'A Kite basket transfer is already running.'}); return; }
  busy=true;
  (async()=>{
    const tabs=await chrome.tabs.query({url:'https://kite.zerodha.com/*'});
    if(tabs.length!==1) throw new Error(tabs.length?'Keep one Kite tab open for this transfer.':'Open Kite and its empty Scanner_Import basket first.');
    const results=await chrome.scripting.executeScript({target:{tabId:tabs[0].id},world:'MAIN',func:rocketKiteImport,args:[m.orders,m.createdAt]});
    const result=results[0]?.result;
    if(!result) throw new Error('Kite did not confirm the transfer. Inspect Scanner_Import before retrying.');
    if(result.ok&&!m.automatic) await chrome.tabs.update(tabs[0].id,{active:true});
    return result;
  })().then(reply,e=>reply({ok:false,why:e.message})).finally(()=>{busy=false;});
  return true;
});
