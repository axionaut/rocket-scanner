'use strict';
// Runs in Kite's page and calls Kite's own basket API client, the same calls its basket screen makes.
// The basket does not need to be open. No credentials are read and no order API is called.

// True when a Scanner_Import basket is open on screen in this tab (the owner may be reviewing it).
function rocketKiteBasketOpen(){
  for(const el of document.querySelectorAll('*')){
    const v=el.__vue__;
    if(v?.name==='Scanner_Import'&&v.enabled===true&&Array.isArray(v.items)) return true;
  }
  return false;
}

// Refresh Kite's views after an API write: the Baskets list, and a closed basket tray still holding old items.
function rocketKiteRefresh(basket){
  const seen=new Set();
  for(const el of document.querySelectorAll('*')){
    const v=el.__vue__;
    if(!v||seen.has(v)) continue;
    seen.add(v);
    try{
      if(basket&&v.id===basket.id&&v.enabled!==true&&typeof v.setBasketFromAPIResponse==='function') v.setBasketFromAPIResponse(basket);
    }catch(e){}
  }
  try{
    const store=[...seen].find(v=>v.$store)?.$store;
    for(const action of Object.keys(store?._actions||{})) if(/(^|\/)fetchBaskets$/.test(action)) store.dispatch(action);
  }catch(e){}
}

async function rocketKiteImport(orders,createdAt,openElsewhere=false){
  const NAME='Scanner_Import';
  const fail=why=>({ok:false,why});
  if(location.origin!=='https://kite.zerodha.com') return fail('Open Kite first.');
  if(!Number.isFinite(createdAt)||Date.now()-createdAt>30000||createdAt>Date.now()+1000) return fail('Transfer expired. Send a fresh basket from Rocket Scanner.');
  if(!Array.isArray(orders)||!orders.length||orders.length>20) return fail('Expected 1–20 funded buy orders.');
  const symbols=new Set();
  for(const o of orders){
    const p=o?.params,s=o?.instrument?.tradingsymbol;
    if(!s||symbols.has(s)||o.instrument.exchange!=='NSE'||p?.transactionType!=='BUY'||p.product!=='CNC'||p.orderType!=='MARKET'||p.variety!=='regular'||p.validity!=='DAY'||!Number.isSafeInteger(p.quantity)||p.quantity<=0||!Number.isFinite(p.gtt?.target)||p.gtt.target<=0||Number(p.gtt?.stoploss||0)!==0) return fail('Invalid funded CNC buy order. Nothing was imported.');
    symbols.add(s);
  }
  // Kite's basket API module, found by its own route name rather than a build-specific module id.
  let api=window.__rocketBasketApi;
  if(!api){
    let req=null;
    try{ self.webpackChunkkite?.push([[`rocket-${Date.now()}-${Math.random()}`],{},r=>{req=r;}]); }catch(e){}
    for(const id of Object.keys(req?.m||{})){
      let src='';
      try{ src=Function.prototype.toString.call(req.m[id]); }catch(e){ continue; }
      if(!src.includes('"baskets.items.add"')) continue;
      try{ const z=req(id)?.Z; if(['getBaskets','createBasket','addBasketItem','removeBasketItem'].every(k=>typeof z?.[k]==='function')){ api=z; break; } }catch(e){}
    }
    if(!api) return fail('This Kite version has no compatible basket API. Reload Kite; otherwise use the JSON file.');
    window.__rocketBasketApi=api;
  }
  const key=(symbol,exchange,p={})=>JSON.stringify([symbol,exchange,p.transactionType??p.transaction_type,p.product,p.orderType??p.order_type,p.validity,p.variety,Number(p.quantity),Number(p.price||0),Number((p.triggerPrice??p.trigger_price)||0),Number((p.disclosedQuantity??p.disclosed_quantity)||0),Number(p.gtt?.target||0),Number(p.gtt?.stoploss||0)]);
  const signature=items=>(items||[]).map(i=>key(i.tradingsymbol??i.instrument?.tradingsymbol,i.exchange??i.instrument?.exchange,typeof i.params==='string'?JSON.parse(i.params):i.params)).sort().join('\n');
  const want=signature(orders);
  if(window.__rocketImportBusy) return fail('A Kite basket transfer is still running. Wait for it to finish.');
  window.__rocketImportBusy=true;
  try{
    const all=(await api.getBaskets())?.data?.data;
    if(!Array.isArray(all)) return fail('Kite did not return your baskets. Reload Kite and retry.');
    const named=all.filter(b=>b?.name===NAME);
    if(named.length>1) return fail('Kite has more than one Scanner_Import basket. Delete the extra one.');
    let basket=named[0];
    if(basket&&signature(basket.items)===want) return {ok:true,count:orders.length,already:true,basket};
    // Never change a basket the owner has open: Kite executes the items shown on screen.
    if(basket?.items?.length&&(openElsewhere||rocketKiteBasketOpen())) return fail('Scanner_Import is open in Kite with different orders. Close it; the new basket is written on the next retry.');
    if(!basket){
      const id=(await api.createBasket({name:NAME}))?.data?.data;
      if(!id) return fail('Kite did not create the Scanner_Import basket.');
      basket={id,name:NAME,items:[]};
    }
    const replaced=basket.items?.length||0;
    for(const item of basket.items||[]) await api.removeBasketItem(basket.id,item.id);
    for(const [weight,o] of orders.entries()){
      const p=o.params;
      await api.addBasketItem(basket.id,{tradingsymbol:o.instrument.tradingsymbol,exchange:o.instrument.exchange,weight,params:JSON.stringify({transaction_type:p.transactionType,product:p.product,order_type:p.orderType,validity:p.validity,validity_ttl:p.validityTTL,variety:p.variety,quantity:p.quantity,price:p.price,trigger_price:p.triggerPrice,disclosed_quantity:p.disclosedQuantity,gtt:p.gtt,tags:Array.isArray(p.tags)?p.tags:[]})});
    }
    const fresh=((await api.getBaskets())?.data?.data||[]).find(b=>b?.id===basket.id);
    if(!fresh||signature(fresh.items)!==want) return fail('Kite did not confirm every item. Inspect Scanner_Import before retrying. No orders were executed.');
    rocketKiteRefresh(fresh);
    return {ok:true,count:orders.length,replaced,basket:fresh};
  }catch(e){return fail('Kite rejected the basket update ('+(e?.response?.data?.message||e?.message||'unknown error')+'). Inspect Scanner_Import before retrying. No orders were executed.');}
  finally{window.__rocketImportBusy=false;}
}
if(typeof module!=='undefined') module.exports={rocketKiteImport,rocketKiteBasketOpen,rocketKiteRefresh};
