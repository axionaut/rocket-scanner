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

// Scoped on self.__rocketKite so re-injection into Kite's page context (world: 'MAIN')
// never causes SyntaxError or identifier collisions.
self.__rocketKite = self.__rocketKite || {};

self.__rocketKite.unpackBaskets = function(res){
  if (Array.isArray(res)) return res;
  if (Array.isArray(res?.data)) return res.data;
  if (Array.isArray(res?.data?.data)) return res.data.data;
  return null;
};

self.__rocketKite.extractBasketId = function(res){
  const candidates = [
    res?.data?.data?.id,
    res?.data?.id,
    res?.id,
    res?.data?.data,
    res?.data,
    res
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim().length > 0) return c.trim();
    if (typeof c === 'number' && Number.isFinite(c)) return c;
  }
  return null;
};

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
  // Kite's basket API module, found across webpack layouts, Vue instances, or direct OMS fallback.
  let api=window.__rocketBasketApi;
  if(!api){
    const hasApi=z=>{
      if(!z) return false;
      const getB=typeof z.getBaskets==='function';
      const createB=typeof z.createBasket==='function';
      const addB=typeof z.addBasketItem==='function'||typeof z.addItem==='function';
      const delB=typeof z.removeBasketItem==='function'||typeof z.deleteBasketItem==='function';
      return getB&&createB&&addB&&delB;
    };
    const normalizeApi=z=>{
      if(!z) return null;
      if(!z.removeBasketItem&&typeof z.deleteBasketItem==='function') z.removeBasketItem=z.deleteBasketItem.bind(z);
      if(!z.addBasketItem&&typeof z.addItem==='function') z.addBasketItem=z.addItem.bind(z);
      return z;
    };
    const inspectCandidate=target=>{
      if(!target) return null;
      const pool=[target,target?.default,target?.Z,...(typeof target==='object'?Object.values(target):[])];
      for(const obj of pool){
        if(!obj) continue;
        if(hasApi(obj)) return normalizeApi(obj);
        if(obj.prototype&&hasApi(obj.prototype)){
          try{ return normalizeApi(new obj()); }catch(e){ return normalizeApi(obj.prototype); }
        }
      }
      return null;
    };

    const chunks=Object.keys(self).filter(k=>/^webpackChunk/.test(k)&&typeof self[k]?.push==='function');
    let modules=0,candidates=0;
    for(const g of chunks){
      let req=null;
      try{ self[g].push([[`rocket-${Date.now()}-${Math.random()}`],{},r=>{req=r;}]); }catch(e){}
      if(!req) continue;
      // 1. Inspect already-instantiated module exports in cache
      for(const id of Object.keys(req.c||{})){
        const found=inspectCandidate(req.c[id]?.exports);
        if(found){ api=found; break; }
      }
      if(api) break;
      // 2. Scan module source definitions
      const ids=Object.keys(req.m||{}); modules+=ids.length;
      for(const id of ids){
        let src='';
        try{ src=Function.prototype.toString.call(req.m[id]); }catch(e){ continue; }
        if(!/(getBaskets|createBasket|addBasketItem|removeBasketItem|deleteBasketItem|baskets\.items|baskets)/i.test(src)) continue;
        candidates++;
        try{
          const ex=req(id);
          const found=inspectCandidate(ex);
          if(found){ api=found; break; }
        }catch(e){}
      }
      if(api) break;
      // 3. Fallback: inspect any module export
      for(const id of ids){
        try{
          const ex=req(id);
          const found=inspectCandidate(ex);
          if(found){ api=found; break; }
        }catch(e){}
      }
      if(api) break;
    }
    // 4. Inspect Vue components
    if(!api){
      for(const el of document.querySelectorAll('*')){
        const v=el.__vue__;
        if(!v) continue;
        const found=inspectCandidate(v.$api)||inspectCandidate(v.$services)||inspectCandidate(v.$http)||inspectCandidate(v.basketApi);
        if(found){ api=found; break; }
      }
    }
    // 5. Direct OMS API client fallback within Kite's authenticated session
    if(!api&&location.origin==='https://kite.zerodha.com'){
      const headers={'Accept':'application/json','Content-Type':'application/json','X-Kite-Version':'3'};
      api={
        async getBaskets(){
          const r=await fetch('/oms/orders/baskets',{credentials:'include',headers:{'Accept':'application/json','X-Kite-Version':'3'}});
          if(!r.ok) throw new Error(`OMS getBaskets failed with HTTP ${r.status}`);
          return await r.json();
        },
        async createBasket({name}){
          const r=await fetch('/oms/orders/baskets',{method:'POST',credentials:'include',headers,body:JSON.stringify({name})});
          if(!r.ok) throw new Error(`OMS createBasket failed with HTTP ${r.status}`);
          return await r.json();
        },
        async addBasketItem(basketId,item){
          const r=await fetch(`/oms/orders/baskets/${basketId}/items`,{method:'POST',credentials:'include',headers,body:JSON.stringify(item)});
          if(!r.ok) throw new Error(`OMS addBasketItem failed with HTTP ${r.status}`);
          return await r.json();
        },
        async removeBasketItem(basketId,itemId){
          const r=await fetch(`/oms/orders/baskets/${basketId}/items/${itemId}`,{method:'DELETE',credentials:'include',headers:{'Accept':'application/json','X-Kite-Version':'3'}});
          if(!r.ok) throw new Error(`OMS removeBasketItem failed with HTTP ${r.status}`);
          return await r.json();
        }
      };
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
    const basketsRes=await api.getBaskets();
    const unpackBaskets=self.__rocketKite.unpackBaskets;
    const extractBasketId=self.__rocketKite.extractBasketId;
    const all=unpackBaskets(basketsRes);
    if(!Array.isArray(all)){
      let shape='unknown';
      try{ shape=JSON.stringify(basketsRes).slice(0,200); }catch(e){ shape=String(basketsRes).slice(0,200); }
      return fail(`Kite did not return your baskets. Reload Kite and retry. (response shape: ${shape})`);
    }
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
      const fresh=(unpackBaskets(await api.getBaskets())||[]).find(b=>b?.id===basket.id);
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
      let createRes=null;
      try{
        createRes=await api.createBasket({name:NAME});
      }catch(err){
        // Network or HTTP error during create: backend might still have succeeded
      }
      let id=extractBasketId(createRes);
      if(id==null){
        // Immediate reconciliation check
        const postCheck=(unpackBaskets(await api.getBaskets())||[]).filter(b=>b?.name===NAME);
        if(postCheck.length>1) return fail(`Kite has more than one ${NAME} basket after creation. Delete the extra one.`);
        if(postCheck.length===1){
          const recId=extractBasketId(postCheck[0]);
          if(recId!=null){
            basket=postCheck[0];
            id=recId;
          }
        }
      }
      if(id==null) return fail(`Kite did not create the ${NAME} basket (unverified response ID).`);
      if(!basket) basket={id,name:NAME,items:[]};

      // If a recovered basket already matches desired orders, return success
      if(basket.items?.length&&signature(basket.items)===want) return {ok:true,count:orders.length,already:true,basket};
      if(basket.items?.length&&(openElsewhere||rocketKiteBasketOpen(NAME))) return fail(`${NAME} is open in Kite with different orders. Close it; the new basket is written on the next retry.`);
    }
    const replaced=basket.items?.length||0;
    for(const item of basket.items||[]) await api.removeBasketItem(basket.id,item.id);
    for(const [weight,o] of orders.entries()){
      const p=o.params;
      await api.addBasketItem(basket.id,{tradingsymbol:o.instrument.tradingsymbol,exchange:o.instrument.exchange,weight,params:JSON.stringify({transaction_type:p.transactionType,product:p.product,order_type:p.orderType,validity:p.validity,validity_ttl:p.validityTTL,variety:p.variety,quantity:p.quantity,price:p.price,trigger_price:p.triggerPrice,disclosed_quantity:p.disclosedQuantity,...(p.gtt?{gtt:p.gtt}:{}),tags:Array.isArray(p.tags)?p.tags:[]})});
    }
    const fresh=(unpackBaskets(await api.getBaskets())||[]).find(b=>b?.id===basket.id);
    if(!fresh||signature(fresh.items)!==want) return fail(`Kite did not confirm every item. Inspect ${NAME} before retrying. No orders were executed.`);
    rocketKiteRefresh(fresh);
    return {ok:true,count:orders.length,replaced,basket:fresh};
  }catch(e){
    return fail('Kite rejected the basket update ('+(e?.response?.data?.message||e?.message||'unknown error')+`). Inspect ${NAME} before retrying. No orders were executed.`);
  }finally{
    window.__rocketImportBusy=false;
  }
}

if(typeof module!=='undefined') module.exports={rocketKiteImport,rocketKiteBasketOpen,rocketKiteRefresh,ROCKET_BASKET,unpackBaskets:self.__rocketKite.unpackBaskets,extractBasketId:self.__rocketKite.extractBasketId};
