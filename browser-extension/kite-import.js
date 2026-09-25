'use strict';
// Runs in Kite's page, using its native basket component. No credentials or order APIs.
async function rocketKiteImport(orders,createdAt){
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
  // Refuse an incompatible Kite build, a hidden basket, or any unrelated basket.
  const candidates=new Set();
  for(const el of document.querySelectorAll('*')){
    const v=el.__vue__;
    if(v?.name==='Scanner_Import'&&Array.isArray(v.items)&&typeof v.importBasketItems==='function'&&typeof v.apiAddItem==='function'&&v.$el?.getClientRects().length) candidates.add(v);
  }
  if(candidates.size!==1) return fail('Open the Scanner_Import basket in Kite, then send again.');
  const v=[...candidates][0];
  if(v.__rocketImportBusy) return fail('This basket is still importing. Wait for it to finish.');
  if(v.execState||v.isAddingItem) return fail('Kite is busy with this basket. Finish that action first.');
  const key=o=>JSON.stringify([o.instrument?.tradingsymbol,o.instrument?.exchange,o.params?.transactionType,o.params?.product,o.params?.orderType,o.params?.validity,o.params?.variety,Number(o.params?.quantity),Number(o.params?.price||0),Number(o.params?.triggerPrice||0),Number(o.params?.disclosedQuantity||0),Number(o.params?.gtt?.target||0),Number(o.params?.gtt?.stoploss||0)]);
  const signature=items=>items.map(key).sort().join('\n');
  if(v.items.length){
    if(signature(v.items)===signature(orders)) return {ok:true,count:orders.length,already:true};
    return fail('Scanner_Import contains different orders. Review and clear it in Kite before sending; nothing was changed.');
  }
  const input=v.$refs?.jsonImport;
  if(!input||typeof DataTransfer==='undefined') return fail('This Kite version has no compatible basket import control. Use the JSON file.');
  v.__rocketImportBusy=true;
  try{
    const data=new DataTransfer();
    data.items.add(new File([JSON.stringify(orders)],'Zerodha_Basket_Buy.json',{type:'application/json'}));
    input.files=data.files;
    // The exact import handler used by Kite's file picker. It only saves draft items.
    v.importBasketItems();
    const deadline=Date.now()+20000;
    while(Date.now()<deadline){
      if(signature(v.items)===signature(orders)) return {ok:true,count:orders.length};
      await new Promise(resolve=>setTimeout(resolve,200));
    }
    return fail('Kite did not confirm every item. Inspect Scanner_Import for a partial import before retrying. No orders were executed.');
  }catch(e){return fail('Import could not be confirmed. Inspect Scanner_Import before retrying.');}
  finally{v.__rocketImportBusy=false;}
}
if(typeof module!=='undefined') module.exports={rocketKiteImport};
