'use strict';
// Runs in Kite's page and calls Kite's own basket API client, the same calls its basket screen makes.
// The basket does not need to be open. No credentials are read and no order API is called.

// Buys go to Scanner_Buy, profit-lock sells to Scanner_Sell. `var`: this file is re-injected on every call.
var ROCKET_BASKET={BUY:'Scanner_Buy',SELL:'Scanner_Sell'};
// True when the named basket is open on screen in this tab (the owner may be reviewing it).
function rocketKiteBasketOpen(name='Scanner_Buy'){
  for(const el of document.querySelectorAll('*')){
    const v=el.__vue__;
    if(v?.name===name&&v.enabled===true&&Array.isArray(v.items)) return true;
  }
  return false;
}

// Refresh Kite's views after an API write: the Baskets list, and a closed basket tray still holding old items.
function rocketKiteRefresh(basket,refreshOpen=false){
  const seen=new Set();
  for(const el of document.querySelectorAll('*')){
    const v=el.__vue__;
    if(!v||seen.has(v)) continue;
    seen.add(v);
    try{
      if(basket&&v.id===basket.id&&(refreshOpen||v.enabled!==true)&&typeof v.setBasketFromAPIResponse==='function') v.setBasketFromAPIResponse(basket);
    }catch(e){}
  }
  try{
    const store=[...seen].find(v=>v.$store)?.$store;
    for(const action of Object.keys(store?._actions||{})) if(/(^|\/)fetchBaskets$/.test(action)) store.dispatch(action);
  }catch(e){}
}

async function rocketKiteImport(orders,createdAt,openElsewhere=false,side='BUY'){
  const sell=side==='SELL';
  const cleanup=side==='CLEANUP_BUY';
  const NAME=sell?ROCKET_BASKET.SELL:ROCKET_BASKET.BUY;
  const fail=why=>({ok:false,why});
  if(location.origin!=='https://kite.zerodha.com') return fail('Open Kite first.');
  if(!Number.isFinite(createdAt)||Date.now()-createdAt>30000||createdAt>Date.now()+1000) return fail('Transfer expired. Send a fresh basket from Rocket Scanner.');
  // A sell basket may be empty: that clears Scanner_Sell once the shares are gone.
  if(!Array.isArray(orders)||(!sell&&!orders.length)||orders.length>20) return fail(sell?'Expected 0–20 sell orders.':'Expected 1–20 funded buy orders.');
  const symbols=new Set();
  for(const o of orders){
    const p=o?.params,s=o?.instrument?.tradingsymbol;
    if(cleanup){
      if(typeof s!=='string'||!s||o.instrument.exchange!=='NSE') return fail('Invalid filled-stock cleanup.');
      symbols.add(s); continue;
    }
    const common=s&&!symbols.has(s)&&o.instrument.exchange==='NSE'&&p?.product==='CNC'&&p.variety==='regular'&&p.validity==='DAY'&&Number.isSafeInteger(p.quantity)&&p.quantity>0;
    const ok=sell
      // 1.4.0: a profit-lock sell is a LIMIT at the lock floor (never below it), so SELL takes LIMIT with a price.
      ? common&&p.transactionType==='SELL'&&!p.gtt&&(p.orderType==='MARKET'||(p.orderType==='LIMIT'&&Number.isFinite(p.price)&&p.price>0))
      : common&&p.orderType==='MARKET'&&p.transactionType==='BUY'&&Number.isFinite(p.gtt?.target)&&p.gtt.target>0&&Number(p.gtt?.stoploss||0)===0;
    if(!ok) return fail(sell?'Invalid CNC sell order. Nothing was written.':'Invalid funded CNC buy order. Nothing was imported.');
    symbols.add(s);
  }
  // Kite's basket API module, found by its own route name rather than a build-specific module id.
  let api=window.__rocketBasketApi;
  if(!api){
    // 1.6.0 (9 Oct): Kite's build changed and the 1.5 lookup (webpackChunkkite, "baskets.items.add", export .Z)
    // stopped matching. Search every webpack chunk global, any module mentioning baskets, and every export
    // object for the four basket methods; report which step failed so the next change is diagnosable.
    const NEED=['getBaskets','createBasket','addBasketItem','removeBasketItem'];
    const hasApi=z=>z&&NEED.every(k=>typeof z[k]==='function');
    const chunks=Object.keys(self).filter(k=>/^webpackChunk/.test(k)&&typeof self[k]?.push==='function');
    let modules=0,candidates=0;
    for(const g of chunks){
      let req=null;
      try{ self[g].push([[`rocket-${Date.now()}-${Math.random()}`],{},r=>{req=r;}]); }catch(e){}
      const ids=Object.keys(req?.m||{});modules+=ids.length;
      for(const id of ids){
        let src='';
        try{ src=Function.prototype.toString.call(req.m[id]); }catch(e){ continue; }
        if(!src.includes('"baskets.items.add"')) continue;
        candidates++;
        try{
          const ex=req(id);
          const found=[ex,ex?.default,ex?.Z,...Object.values(ex||{})].find(hasApi);
          if(found){ api=found; break; }
        }catch(e){}
      }
      if(api) break;
    }
    if(!api) return fail(`This Kite version has no compatible basket API (webpack globals ${chunks.length}, modules ${modules}, basket modules ${candidates}). Reload Kite; otherwise use the JSON file.`);
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
    if(named.length>1) return fail(`Kite has more than one ${NAME} basket. Delete the extra one.`);
    let basket=named[0];
    if(cleanup){
      if(!basket) return {ok:true,count:0,removed:0,basket:null};
      let removed=0;
      for(const item of basket.items||[]){
        const p=typeof item.params==='string'?JSON.parse(item.params):item.params;
        if(symbols.has(item.tradingsymbol)&&item.exchange==='NSE'&&p?.product==='CNC'&&(p.transaction_type??p.transactionType)==='BUY'){
          await api.removeBasketItem(basket.id,item.id); removed++;
        }
      }
      const fresh=((await api.getBaskets())?.data?.data||[]).find(b=>b?.id===basket.id);
      if(!fresh) return fail('Filled-stock cleanup could not be verified.');
      if((fresh.items||[]).some(i=>{const p=typeof i.params==='string'?JSON.parse(i.params):i.params;return symbols.has(i.tradingsymbol)&&i.exchange==='NSE'&&p?.product==='CNC'&&(p.transaction_type??p.transactionType)==='BUY';})) return fail('Filled stock is still in Scanner_Buy; cleanup will retry.');
      rocketKiteRefresh(fresh,true);
      return {ok:true,count:fresh.items.length,removed,basket:fresh};
    }
    if(basket&&signature(basket.items)===want) return {ok:true,count:orders.length,already:true,basket};
    if(!basket&&!orders.length) return {ok:true,count:0,already:true,basket:null};
    // Never change a basket the owner has open: Kite executes the items shown on screen.
    if(basket?.items?.length&&(openElsewhere||rocketKiteBasketOpen(NAME))) return fail(`${NAME} is open in Kite with different orders. Close it; the new basket is written on the next retry.`);
    if(!basket){
      const id=(await api.createBasket({name:NAME}))?.data?.data;
      if(!id) return fail(`Kite did not create the ${NAME} basket.`);
      basket={id,name:NAME,items:[]};
    }
    const replaced=basket.items?.length||0;
    for(const item of basket.items||[]) await api.removeBasketItem(basket.id,item.id);
    for(const [weight,o] of orders.entries()){
      const p=o.params;
      await api.addBasketItem(basket.id,{tradingsymbol:o.instrument.tradingsymbol,exchange:o.instrument.exchange,weight,params:JSON.stringify({transaction_type:p.transactionType,product:p.product,order_type:p.orderType,validity:p.validity,validity_ttl:p.validityTTL,variety:p.variety,quantity:p.quantity,price:p.price,trigger_price:p.triggerPrice,disclosed_quantity:p.disclosedQuantity,...(p.gtt?{gtt:p.gtt}:{}),tags:Array.isArray(p.tags)?p.tags:[]})});
    }
    const fresh=((await api.getBaskets())?.data?.data||[]).find(b=>b?.id===basket.id);
    if(!fresh||signature(fresh.items)!==want) return fail(`Kite did not confirm every item. Inspect ${NAME} before retrying. No orders were executed.`);
    rocketKiteRefresh(fresh);
    return {ok:true,count:orders.length,replaced,basket:fresh};
  }catch(e){return fail('Kite rejected the basket update ('+(e?.response?.data?.message||e?.message||'unknown error')+`). Inspect ${NAME} before retrying. No orders were executed.`);}
  finally{window.__rocketImportBusy=false;}
}
if(typeof module!=='undefined') module.exports={rocketKiteImport,rocketKiteBasketOpen,rocketKiteRefresh,ROCKET_BASKET};
