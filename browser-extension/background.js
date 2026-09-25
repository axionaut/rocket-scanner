'use strict';
let busy=false;
// After an install or reload, reconnect already-open Rocket Scanner tabs without making the owner reload them.
chrome.runtime.onInstalled.addListener(async()=>{
  for(const tab of await chrome.tabs.query({url:'https://axionaut.github.io/rocket-scanner/*'}))
    chrome.scripting.executeScript({target:{tabId:tab.id},files:['relay.js']}).catch(()=>{});
});
// Load kite-import.js into Kite's page, then call one of its functions by name.
const run=async(tabId,name,args=[])=>{
  await chrome.scripting.executeScript({target:{tabId},world:'MAIN',files:['kite-import.js']});
  return (await chrome.scripting.executeScript({target:{tabId},world:'MAIN',func:(n,a)=>self[n](...a),args:[name,args]}))[0]?.result;
};
chrome.runtime.onMessage.addListener((m,sender,reply)=>{
  if(m?.type!=='RS_KITE_PREPARE' || !sender.url?.startsWith('https://axionaut.github.io/rocket-scanner/')) return;
  if(busy){ reply({ok:false,why:'A Kite basket transfer is already running.'}); return; }
  busy=true;
  (async()=>{
    const tabs=await chrome.tabs.query({url:'https://kite.zerodha.com/*'});
    if(!tabs.length) throw new Error('Open Kite (any page, logged in) in this browser first.');
    // Any open Scanner_Import on screen, in any Kite tab, blocks a change to it.
    let openElsewhere=false;
    for(const tab of tabs.slice(1)) openElsewhere=openElsewhere||!!(await run(tab.id,'rocketKiteBasketOpen').catch(()=>false));
    const result=await run(tabs[0].id,'rocketKiteImport',[m.orders,m.createdAt,openElsewhere]);
    if(!result) throw new Error('Kite did not confirm the transfer. Inspect Scanner_Import before retrying.');
    if(result.ok) for(const tab of tabs.slice(1)) await run(tab.id,'rocketKiteRefresh',[result.basket]).catch(()=>{});
    delete result.basket;
    return result;
  })().then(reply,e=>reply({ok:false,why:e.message})).finally(()=>{busy=false;});
  return true;
});
