// Finance tab (5 Oct 2026): household budget, income target, obligations, loans and prepayment planning.
// The data never lives in this public file or repo: it is read from and saved to the local helper
// (Scanner Uploads/finance.json on the owner's PC). This file holds only the logic and the screen.
(function(){
'use strict';
const H='http://localhost:8787';
let FIN=null, FIN_ERR=null, FIN_SAVED_AT=null, FIN_SAVE_TIMER=null, FIN_SAVING=false, FIN_LOADING=false;
const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const n=v=>{const x=Number(v);return Number.isFinite(x)?x:0;};
const inr=v=>(v<0?'−':'')+'₹'+Math.round(Math.abs(n(v))).toLocaleString('en-IN');
const pct=(v,d=2)=>(Number.isFinite(v)?v.toFixed(d):'—')+'%';
const ymKey=d=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');
const monthName=(base,k)=>{const d=new Date(base.getFullYear(),base.getMonth()+k,1);return d.toLocaleString('en-IN',{month:'short',year:'numeric'});};
const ord=d=>{d=n(d);const t=d%100;return d+((t>=11&&t<=13)?'th':({1:'st',2:'nd',3:'rd'}[d%10]||'th'));};
const owner=()=>(FIN&&FIN.settings&&FIN.settings.owner)||'Owner';
const people=()=>{const p=(FIN&&FIN.settings&&FIN.settings.people)||[];return p.length?p:[owner()];};
const uid=p=>p+'-'+Math.random().toString(36).slice(2,8);

// ── Tax: new regime, FY 2026-27 (Budget 2026 left the FY 2025-26 slabs, 87A rebate and cess unchanged) ──
const SLABS=[[400000,0],[800000,.05],[1200000,.10],[1600000,.15],[2000000,.20],[2400000,.25],[Infinity,.30]];
function slabTax(inc){let t=0,lo=0;for(const [hi,r] of SLABS){if(inc>lo)t+=(Math.min(inc,hi)-lo)*r;lo=hi;}return t;}
function surcharge(inc,tax){const r=inc>20000000?.25:inc>10000000?.15:inc>5000000?.10:0;return tax*r;}
// Business income (intraday is speculative business; frequent delivery trading may be declared business,
// CBDT circular 6/2016): slab rates, 87A rebate up to Rs 60,000 when income <= Rs 12 lakh, marginal relief above.
function taxBusiness(inc){
  let t=slabTax(inc);
  if(inc<=1200000) t=Math.max(0,t-60000); else t=Math.min(t,inc-1200000);
  t+=surcharge(inc,t); return t*1.04;
}
// Short-term capital gains (s.111A): 20% flat; a resident's unused basic exemption (Rs 4 lakh) is set off
// first; no 87A rebate on 111A tax (Finance Act 2025).
function taxSTCG(inc){let t=Math.max(0,inc-400000)*.20;t+=t*(inc>10000000?.15:inc>5000000?.10:0);return t*1.04;}  // 111A surcharge is capped at 15%
function annualTax(mode,inc,flat){
  if(mode==='stcg') return taxSTCG(inc);
  if(mode==='flat') return inc*n(flat)/100;
  return taxBusiness(inc);
}
// Smallest monthly gross G such that G - tax(12G)/12 >= needed net.
function grossFor(mode,net,flat){
  if(net<=0) return 0;
  let lo=net,hi=net*3;
  for(let i=0;i<60;i++){const m=(lo+hi)/2;(m-annualTax(mode,m*12,flat)/12>=net)?hi=m:lo=m;}
  return Math.ceil(hi);
}

// ── Loans ──
function loanMonthsLeft(l){
  const B=n(l.principal),E=n(l.emi),r=n(l.rate)/1200;
  if(B<=0) return 0; if(E<=0) return Infinity;
  if(r===0) return Math.ceil(B/E);
  if(E<=B*r) return Infinity;
  return Math.ceil(-Math.log(1-B*r/E)/Math.log(1+r));
}
// Priority for an extra rupee: the annual rate, less a prepayment charge spread over the loan's remaining
// life (a 2% charge on a loan with 2 years left costs ~1%/year). Unknown charge is treated as 0 but flagged.
function priorityRate(l){
  const m=loanMonthsLeft(l),c=n(l.prepayChargePct);
  const yrs=Number.isFinite(m)&&m>0?Math.max(1,m)/12:30;
  return n(l.rate)-(c>0?c/yrs:0);
}
// Month-by-month simulation of every loan. extra = monthly prepayment; lump = one-off in month 0;
// rollover = a closed loan's EMI joins the prepayment pool.
function simulate(loans,{extra=0,lump=0,rollover=false}={}){
  const L=loans.filter(l=>n(l.principal)>0).map(l=>({id:l.id,b:n(l.principal),e:n(l.emi),r:n(l.rate)/1200,c:n(l.prepayChargePct)/100,p:priorityRate(l),done:null}));
  let interest=0,charges=0,freed=0,k=0;
  const order=()=>L.filter(x=>x.b>0.5).sort((a,b)=>b.p-a.p||a.b-b.b);
  const prepay=amt=>{for(const x of order()){if(amt<=0)break;const pay=Math.min(amt/(1+x.c),x.b);x.b-=pay;charges+=pay*x.c;amt-=pay*(1+x.c);}};
  if(lump>0) prepay(lump);
  for(k=0;k<720&&L.some(x=>x.b>0.5);k++){
    for(const x of L){
      if(x.b<=0.5) continue;
      const i=x.b*x.r; interest+=i;
      const pay=Math.min(x.e,x.b+i); x.b=x.b+i-pay;
      if(x.b<=0.5&&x.done==null){x.b=0;x.done=k;if(rollover)freed+=x.e;}
    }
    const pool=extra+(rollover?freed:0);
    if(pool>0) prepay(pool);
    for(const x of L) if(x.b<=0.5&&x.done==null){x.b=0;x.done=k;if(rollover)freed+=x.e;}
  }
  const payoff={};L.forEach(x=>payoff[x.id]=x.done==null?Infinity:x.done+1);
  return {months:L.some(x=>x.b>0.5)?Infinity:k,interest,charges,payoff};
}

// ── Income actually earned this month (Zerodha, net of charges incl. DP) ──
function monthRealised(){
  const now=new Date(),key=ymKey(now);let total=0,last=null;
  try{
    const trips=(typeof TRADEBOOK_STATS!=='undefined'&&TRADEBOOK_STATS&&TRADEBOOK_STATS.tripsData)||[];
    for(const t of trips){const d=String(t.sellDate||'').slice(0,10);if(d.slice(0,7)!==key)continue;total+=n(t.netPnl)-n(t.dpCharge);if(!last||d>last)last=d;}
    const b=typeof PERF_LATEST_SUMMARY!=='undefined'?PERF_LATEST_SUMMARY:null;
    if(b&&String(b.date||'').slice(0,7)===key&&(!last||b.date>last)){total+=n(b.total);last=b.date;}
  }catch(e){}
  return {total,asOf:last};
}
function sessionsLeftThisMonth(){
  const d=new Date(),y=d.getFullYear(),m=d.getMonth();let left=0,all=0;
  const ok=s=>typeof isNseTradingDate==='function'?isNseTradingDate(s):![0,6].includes(new Date(s+'T12:00:00Z').getUTCDay());
  for(let day=1;day<=31;day++){const dt=new Date(Date.UTC(y,m,day));if(dt.getUTCMonth()!==m)break;const s=dt.toISOString().slice(0,10);if(!ok(s))continue;all++;
    const today=d.toISOString().slice(0,10);if(s>=today)left++;}
  return {left,all};
}
function tradingCapital(){
  try{
    const cash=typeof getKiteAvailableCash==='function'?getKiteAvailableCash():null;
    const inv=typeof getComputedCapital==='function'?getComputedCapital().invested:0;
    return {total:n(cash)+n(inv),cash,invested:n(inv)};
  }catch(e){return {total:0,cash:null,invested:0};}
}

// ── Load / save ──
async function loadFinance(){
  if(FIN_LOADING) return; FIN_LOADING=true;
  try{
    const r=await fetch(H+'/api/finance',{cache:'no-store'});const j=await r.json();
    if(!j.ok) throw new Error(j.why||'helper error');
    FIN=j.data||null; FIN_ERR=FIN?null:'No finance file yet on this PC (Scanner Uploads/finance.json).';
    if(FIN){FIN.settings=FIN.settings||{};FIN.paid=FIN.paid||{};FIN.incomes=FIN.incomes||[];FIN.expenses=FIN.expenses||[];FIN.obligations=FIN.obligations||[];FIN.loans=FIN.loans||[];FIN.salary=FIN.salary||{label:'Partner salary',gross:0,deductions:0,allocations:[]};}
  }catch(e){FIN_ERR='Local helper not reachable - start Rocket Scanner.bat. Your finance data lives only on this PC. ('+e.message+')';}
  FIN_LOADING=false; setTabBadge(); renderFinance();
}
function scheduleSave(){
  clearTimeout(FIN_SAVE_TIMER);
  FIN_SAVE_TIMER=setTimeout(async()=>{
    FIN_SAVING=true;
    try{const r=await fetch(H+'/api/finance',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({data:FIN})});
      const j=await r.json();if(!j.ok)throw new Error(j.why);FIN_SAVED_AT=new Date();FIN_ERR=null;}
    catch(e){FIN_ERR='NOT SAVED - helper unreachable ('+e.message+'). Changes are kept on screen until it is back.';}
    FIN_SAVING=false;const s=$('finSaveState');if(s)s.innerHTML=saveStateHtml();
  },600);
}
function saveStateHtml(){
  if(FIN_ERR&&FIN) return `<span style="color:var(--red)">⚠ ${esc(FIN_ERR)}</span>`;
  if(FIN_SAVING) return 'saving…';
  return FIN_SAVED_AT?`saved ${FIN_SAVED_AT.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'})} · on this PC only`:'stored on this PC only';
}

// ── Edits (called from inputs) ──
function setPath(obj,path,val){const p=path.split('.');let o=obj;for(let i=0;i<p.length-1;i++)o=o[p[i]];o[p[p.length-1]]=val;}
window.finEdit=function(listName,id,field,el){
  if(!FIN) return;
  let v=el.type==='checkbox'?el.checked:el.value;
  if(el.dataset.num==='1') v=v===''?null:Number(v);
  if(listName==='root') setPath(FIN,field,v);
  else{const it=(listName==='salary'?FIN.salary.allocations:FIN[listName]).find(x=>x.id===id);if(it)it[field]=v;}
  scheduleSave(); renderFinance();
};
window.finAdd=function(listName){
  if(!FIN) return;
  const base={incomes:{name:'New income',amount:0,role:'reserve'},expenses:{name:'New expense',amount:0},
    obligations:{name:'New obligation',amount:0,dueDay:null,group:'household'},
    loans:{name:'New loan',borrower:owner(),paidByToday:owner(),rateType:'fixed',rate:0,emi:0,principal:0,tenureLeft:0,endDate:'',dueDay:null,prepayChargePct:null,notes:''},
    salary:{name:'New item',amount:0}}[listName];
  const it=Object.assign({id:uid(listName.slice(0,2))},base);
  (listName==='salary'?FIN.salary.allocations:FIN[listName]).push(it);
  scheduleSave(); renderFinance();
};
window.finDel=function(listName,id){
  if(!FIN) return;
  const arr=listName==='salary'?FIN.salary.allocations:FIN[listName];
  const it=arr.find(x=>x.id===id); if(!it) return;
  if(!confirm('Delete "'+(it.name||'item')+'"?')) return;
  arr.splice(arr.indexOf(it),1); scheduleSave(); renderFinance();
};
window.finTogglePaid=function(id,el){
  const k=ymKey(new Date()); FIN.paid[k]=FIN.paid[k]||{}; FIN.paid[k][id]=!!el.checked; scheduleSave(); renderFinance();
};
window.finLumpSum=function(el){FIN_LUMP=Number(el.value)||0;renderFinance();};
let FIN_LUMP=0;

// ── Rendering helpers ──
const cell='padding:6px 8px;border-bottom:1px solid var(--border)';
const inBox='background:var(--bg-card);border:1px solid var(--border);border-radius:6px;color:var(--t1);padding:4px 6px;font-size:13px;font-family:inherit';
function inp(list,id,field,val,{num=false,w=90,type}={}){
  return `<input ${num?'data-num="1"':''} type="${type||(num?'number':'text')}" value="${esc(val??'')}" style="${inBox};width:${w}px${num?";text-align:right;font-family:'DM Mono',monospace":''}" onchange="finEdit('${list}','${id}','${field}',this)">`;
}
function sel(list,id,field,val,opts){return `<select style="${inBox}" onchange="finEdit('${list}','${id}','${field}',this)">${opts.map(o=>`<option value="${o[0]}"${o[0]===val?' selected':''}>${o[1]}</option>`).join('')}</select>`;}
function card(label,value,sub,color){return `<div class="st"><div class="st-l">${label}</div><div class="st-v" style="font-size:20px;color:${color||'var(--t1)'}">${value}</div><div class="st-d">${sub||''}</div></div>`;}
function section(title,body,right=''){return `<div style="margin:18px 0 8px;display:flex;align-items:baseline;justify-content:space-between;gap:12px"><h3 style="margin:0;font-size:16px;color:var(--t1)">${title}</h3><div style="font-size:12px;color:var(--t2)">${right}</div></div>${body}`;}
// align: one letter per column (l/r/c) applied to the header AND every body cell of that column, so a
// header, its inputs and its totals line up; fit=true sizes the table to its content instead of full width.
let TBL_N=0;
function tbl(head,rows,foot='',align='',fit=false){
  const id='fint'+(++TBL_N),A={l:'left',r:'right',c:'center'};
  const css=[...align].map((a,i)=>`.${id} th:nth-child(${i+1}),.${id} tbody td:nth-child(${i+1}){text-align:${A[a]||'left'}}`).join('');
  return `<style>${css}.${id} input[data-num]{text-align:right}</style><div style="overflow-x:auto"><table class="${id}" style="width:${fit?'auto':'100%'};min-width:${fit?'480px':'0'};border-collapse:collapse;font-size:13px"><thead><tr>${head.map(h=>`<th style="${cell};color:var(--t2);font-weight:600;white-space:nowrap">${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody>${foot?`<tfoot>${foot}</tfoot>`:''}</table></div>`;
}
const delBtn=(l,id)=>`<button class="btn" style="padding:2px 8px;font-size:12px" title="Delete" onclick="finDel('${l}','${id}')">✕</button>`;
const addBtn=(l,t)=>`<button class="btn" style="padding:4px 10px;font-size:12px;margin-top:6px" onclick="finAdd('${l}')">+ ${t}</button>`;

function renderFinance(){
  const root=$('finContent'); if(!root) return;
  if(!FIN){root.innerHTML=`<div style="padding:40px;text-align:center;color:var(--t2)">${FIN_ERR?esc(FIN_ERR):'Loading finance data…'}<div style="margin-top:12px"><button class="btn" onclick="RocketFinance.reload()">Retry</button></div></div>`;return;}
  // keep focus position across a re-render
  const S=FIN.settings, now=new Date(), mKey=ymKey(now);
  const activeLoans=FIN.loans.filter(l=>n(l.principal)>0);
  const living=FIN.expenses.reduce((s,e)=>s+n(e.amount),0);
  const emis=activeLoans.reduce((s,l)=>s+n(l.emi),0);
  const totalExp=living+emis;
  // 5 Oct (owner): he shoulders every expense and EMI; other household income goes to a reserve.
  // An income counts against the need only when explicitly set to 'covers'.
  const covers=i=>i.role==='covers';
  const counted=FIN.incomes.filter(covers).reduce((s,i)=>s+n(i.amount),0);
  const reserveIn=FIN.incomes.filter(i=>!covers(i)).reduce((s,i)=>s+n(i.amount),0);
  const netNeed=Math.max(0,totalExp-counted);
  const mode=S.taxMode||'business', flat=S.flatTaxPct??30;
  const gross=grossFor(mode,netNeed,flat);
  const reserveBal=n(S.reserveBalance), reserveMonths=netNeed>0?reserveBal/netNeed:null;
  const days=n(S.tradingDaysPerMonth)||18, perDay=gross/days;
  const real=monthRealised(), sess=sessionsLeftThisMonth(), cap=tradingCapital();
  const remaining=Math.max(0,gross-real.total), perLeft=sess.left?remaining/sess.left:remaining;
  const capPct=cap.total>0?perDay/cap.total*100:null, capPctLeft=cap.total>0?perLeft/cap.total*100:null;

  let h=`<div style="padding:12px 16px">`;
  h+=`<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap"><div style="font-size:13px;color:var(--t2)">Household finance · ${now.toLocaleString('en-IN',{month:'long',year:'numeric'})}</div><div id="finSaveState" style="font-size:12px;color:var(--t2)">${saveStateHtml()}</div></div>`;

  // reminders
  const paidMap=FIN.paid[mKey]||{}, today=now.getDate(), soon=n(S.reminderDays)||3;
  const due=FIN.obligations.filter(o=>!paidMap[o.id]&&o.dueDay).map(o=>({o,d:n(o.dueDay)-today})).filter(x=>x.d<=soon).sort((a,b)=>a.d-b.d);
  setTabBadge(due);
  if(due.length) h+=`<div style="margin:10px 0;padding:10px 12px;border-radius:10px;border:1px solid rgba(248,113,113,.4);background:rgba(248,113,113,.08);font-size:14px">${due.map(x=>`<div>${x.d<0?'🔴 <b>Overdue</b>':x.d===0?'🟠 <b>Due today</b>':'🟡 Due in '+x.d+' day'+(x.d>1?'s':'')}: ${esc(x.o.name)} ${inr(x.o.amount)} (due on the ${ord(x.o.dueDay)})</div>`).join('')}</div>`;

  // headline
  h+=`<div class="stats" style="margin-top:10px">`;
  h+=card('Monthly need from trading',inr(netNeed),`living ${inr(living)} + EMIs ${inr(emis)}${counted?' − '+inr(counted)+' covered by other income':''} (after tax)`,'var(--amber)');
  h+=card('Gross trading target',inr(gross),`before tax · ${mode==='business'?'business income, new regime':mode==='stcg'?'STCG 20%':'flat '+flat+'%'}`,'var(--fire)');
  h+=card('Per trading day',inr(perDay),`${days} trading days/month${capPct!=null?' · '+pct(capPct)+' of capital/day':''}`);
  h+=card('Earned this month',inr(real.total),real.asOf?`Zerodha net realised, to ${real.asOf}`:'no closed trades this month yet',real.total>=0?'var(--green)':'var(--red)');
  h+=card('Still needed',inr(remaining),`${sess.left} NSE sessions left · ${inr(perLeft)}/session${capPctLeft!=null?' ('+pct(capPctLeft)+' of capital)':''}`,remaining>0?'var(--amber)':'var(--green)');
  h+=card('Reserve',inr(reserveBal),`+${inr(reserveIn)}/month from other income${reserveMonths!=null?' · covers '+reserveMonths.toFixed(1)+' months of the need':''}`,'var(--blue)');
  h+=card('Trading capital',cap.total?inr(cap.total):'—',cap.cash!=null?`Kite cash ${inr(cap.cash)} + holdings ${inr(cap.invested)}`:'Kite cash not loaded yet');
  h+=`</div>`;
  h+=`<div style="font-size:12px;color:var(--t2);margin-top:4px">The target is a yardstick for this screen only. It never changes the score floor, trade count or sizing on the Rankings tab.</div>`;

  // scenario + tax
  const modes=[['business','Business income (slab, new regime)'],['stcg','Short-term capital gains (20%)'],['flat','Flat %']];
  const taxRows=modes.map(([m,lab])=>{const g=grossFor(m,netNeed,flat);
    return `<tr style="${m===mode?'background:rgba(251,191,36,.08)':''}"><td style="${cell}"><label style="cursor:pointer"><input type="radio" name="finTax" ${m===mode?'checked':''} onchange="finEdit('root','','settings.taxMode',{type:'text',value:'${m}',dataset:{}})"> ${lab}${m==='flat'?' '+inp('root','','settings.flatTaxPct',flat,{num:true,w:60}):''}</label></td><td style="${cell};text-align:right">${inr(g)}</td><td style="${cell};text-align:right">${inr(g-netNeed)}</td><td style="${cell};text-align:right">${inr(g/days)}</td></tr>`;});
  h+=section('Income target and tax',tbl(['How trading income is taxed','Gross / month','Tax / month','Per trading day'],taxRows,'','lrrr')+
    `<div style="font-size:12px;color:var(--t2);margin-top:6px;line-height:1.6">New regime FY 2026-27: 0-4L nil, 4-8L 5%, 8-12L 10%, 12-16L 15%, 16-20L 20%, 20-24L 25%, above 30%; 87A rebate up to ₹60,000 when income ≤ ₹12L (with marginal relief); 4% cess; surcharge above ₹50L. Intraday profit is speculative business income; frequent delivery trading can be declared business income (CBDT circular 6/2016) or taxed as STCG at 20% after the ₹4L basic exemption (no 87A rebate on STCG). The need is every living expense and EMI; other household income goes to the reserve unless set to "covers expenses" below. Trading days/month: ${inp('root','','settings.tradingDaysPerMonth',days,{num:true,w:60})}</div>`,
    `${inr(netNeed)} net a month`);

  // incomes
  h+=section('Other household income',tbl(['Source','Amount / month','Goes to',''],
    FIN.incomes.map(i=>`<tr><td style="${cell}">${inp('incomes',i.id,'name',i.name,{w:240})}</td><td style="${cell}">${inp('incomes',i.id,'amount',i.amount,{num:true,w:110})}</td><td style="${cell}">${sel('incomes',i.id,'role',covers(i)?'covers':'reserve',[['reserve','reserve'],['covers','covers expenses']])}</td><td style="${cell}">${delBtn('incomes',i.id)}</td></tr>`),
    `<tr><td style="${cell};font-weight:700">To reserve</td><td style="${cell};font-weight:700;text-align:right">${inr(reserveIn)}</td><td style="${cell};color:var(--t2)">${counted?inr(counted)+' covers expenses':''}</td><td></td></tr>`,'lrlc',true)+addBtn('incomes','income')+
    `<div style="margin-top:8px;font-size:14px">Reserve balance now ${inp('root','','settings.reserveBalance',S.reserveBalance||0,{num:true,w:120})}</div>`,
    'the need is carried by trading; this income builds the reserve');

  // obligations this month
  const obPaid=FIN.obligations.filter(o=>paidMap[o.id]).reduce((s,o)=>s+n(o.amount),0);
  const obAll=FIN.obligations.reduce((s,o)=>s+n(o.amount),0), obLeft=obAll-obPaid;
  // Everything leaves this account now: what is left of the fixed obligations plus the rest of the month's
  // spending (living + EMIs not on the fixed list), less the cash already in savings.
  const restOfMonth=Math.max(0,totalExp-obAll), cash=n(FIN.cashInHand), withdraw=obLeft+restOfMonth-cash;
  const obRows=FIN.obligations.slice().sort((a,b)=>(a.dueDay??99)-(b.dueDay??99)).map(o=>{
    const p=!!paidMap[o.id],d=o.dueDay?n(o.dueDay)-today:null;
    const st=p?'<span style="color:var(--green)">paid</span>':d==null?'<span style="color:var(--t3)">set due day</span>':d<0?'<span style="color:var(--red);font-weight:700">overdue</span>':d===0?'<span style="color:var(--amber);font-weight:700">due today</span>':`<span style="color:var(--t2)">in ${d} d</span>`;
    return `<tr style="${p?'opacity:.6':''}"><td style="${cell}"><input type="checkbox" ${p?'checked':''} onchange="finTogglePaid('${o.id}',this)"></td><td style="${cell}">${inp('obligations',o.id,'name',o.name,{w:160})}</td><td style="${cell}">${inp('obligations',o.id,'amount',o.amount,{num:true,w:100})}</td><td style="${cell}">${inp('obligations',o.id,'dueDay',o.dueDay,{num:true,w:60})}</td><td style="${cell}">${st}</td><td style="${cell}">${sel('obligations',o.id,'group',o.group||'household',[['household','household'],['loan','loan / EMI'],['salary','salary'],['fees','fees'],['other','other']])}</td><td style="${cell}">${delBtn('obligations',o.id)}</td></tr>`;});
  h+=section(`Paid from your account by the 5th · ${now.toLocaleString('en-IN',{month:'long'})}`,tbl(['Paid','Item','Amount','Due day','Status','Type',''],obRows,
    `<tr><td></td><td style="${cell};font-weight:700">Total</td><td style="${cell};font-weight:700;text-align:right">${inr(obAll)}</td><td colspan="4" style="${cell};color:var(--t2)">paid ${inr(obPaid)} · <b style="color:${obLeft>0?'var(--red)':'var(--green)'}">left ${inr(obLeft)}</b></td></tr>`,'clrcllc',true)+
    `<div style="display:flex;gap:18px;flex-wrap:wrap;align-items:center;margin-top:8px;font-size:14px"><span>Cash in savings ${inp('root','','cashInHand',FIN.cashInHand,{num:true,w:110})}</span><span>${withdraw>0?`<b style="color:var(--amber)">Withdraw ${inr(withdraw)} from trading</b>`:`<b style="color:var(--green)">Covered</b> - ${inr(-withdraw)} spare`} <span style="color:var(--t2);font-size:12px">= ${inr(obLeft)} fixed still to pay + ${inr(restOfMonth)} rest of the month's living & EMIs − ${inr(cash)} in savings</span></span></div>`+addBtn('obligations','obligation'),
    `ticks reset each month · reminders ${inp('root','','settings.reminderDays',S.reminderDays??3,{num:true,w:50})} days ahead`);

  // loans
  const ranked=activeLoans.slice().sort((a,b)=>priorityRate(b)-priorityRate(a));
  const rankOf=new Map(ranked.map((l,i)=>[l.id,i+1]));
  const base=simulate(FIN.loans,{});
  const plan=simulate(FIN.loans,{extra:n(S.extraPrepayPerMonth),lump:FIN_LUMP,rollover:!!S.rolloverFreedEmi});
  const loanRows=FIN.loans.map(l=>{
    const m=loanMonthsLeft(l),bp=base.payoff[l.id],pp=plan.payoff[l.id];
    const intLeft=Number.isFinite(m)?Math.max(0,n(l.emi)*m-n(l.principal)):Infinity;
    const chargeFlag=l.prepayChargePct==null?' <span title="Prepayment charge unknown - set it (0 if none)" style="color:var(--amber)">?</span>':'';
    return `<tr><td style="${cell};text-align:center;font-weight:700;color:var(--fire)">${n(l.principal)>0?rankOf.get(l.id):'✓'}</td><td style="${cell}">${inp('loans',l.id,'name',l.name,{w:170})}</td>
      <td style="${cell}">${sel('loans',l.id,'paidByToday',l.paidByToday||owner(),people().map(x=>[x,x]))}</td>
      <td style="${cell}">${sel('loans',l.id,'rateType',l.rateType||'fixed',[['fixed','fixed'],['floating','floating']])}</td>
      <td style="${cell}">${inp('loans',l.id,'rate',l.rate,{num:true,w:70})}</td><td style="${cell}">${inp('loans',l.id,'emi',l.emi,{num:true,w:90})}</td>
      <td style="${cell}">${inp('loans',l.id,'principal',l.principal,{num:true,w:110})}</td><td style="${cell}">${inp('loans',l.id,'dueDay',l.dueDay,{num:true,w:55})}</td>
      <td style="${cell}">${inp('loans',l.id,'prepayChargePct',l.prepayChargePct,{num:true,w:60})}${chargeFlag}</td>
      <td style="${cell};text-align:right;white-space:nowrap">${Number.isFinite(m)?m+' mo':'<span style="color:var(--red)">never (EMI ≤ interest)</span>'}${n(l.tenureLeft)&&Number.isFinite(m)&&Math.abs(m-n(l.tenureLeft))>2?`<div style="font-size:11px;color:var(--t3)">sheet ${l.tenureLeft}</div>`:''}</td>
      <td style="${cell};text-align:right">${Number.isFinite(intLeft)?inr(intLeft):'—'}</td>
      <td style="${cell};text-align:right;white-space:nowrap">${Number.isFinite(bp)?monthName(now,bp):'—'}${Number.isFinite(pp)&&pp<bp?`<div style="color:var(--green);font-size:12px">→ ${monthName(now,pp)}</div>`:''}</td><td style="${cell}">${delBtn('loans',l.id)}</td></tr>`;});
  const P=n(activeLoans.reduce((s,l)=>s+n(l.principal),0));
  h+=section('Loans',tbl(['Order','Loan','Paid by today','Type','Rate %','EMI','Outstanding','Due day','Prepay charge %','Months left','Interest left','Paid off',''],loanRows,
    `<tr><td></td><td style="${cell};font-weight:700">Total</td><td colspan="3"></td><td style="${cell};font-weight:700;text-align:right">${inr(emis)}</td><td style="${cell};font-weight:700;text-align:right">${inr(P)}</td><td colspan="4" style="${cell};text-align:right;font-weight:700">${inr(base.interest)} interest still to pay</td><td></td><td></td></tr>`,'cllrrrrcrrrrc')+addBtn('loans','loan')+
    `<div style="font-size:12px;color:var(--t2);margin-top:6px;line-height:1.6">Order = where an extra rupee saves the most: highest annual rate first, less any prepayment charge spread over the loan's remaining life. Floating-rate home loans to individuals cannot charge for prepayment (RBI); fixed-rate personal loans often do - "?" marks a charge not set yet. All loans are treated as ${esc(owner())}'s to repay; "Paid by today" only records who pays now.</div>`,
    `${activeLoans.length} active · debt-free ${Number.isFinite(base.months)?monthName(now,base.months):'never at current EMIs'}`);

  // prepayment planner
  const saved=base.interest-plan.interest-plan.charges, mSaved=(Number.isFinite(base.months)&&Number.isFinite(plan.months))?base.months-plan.months:null;
  const next=ranked[0];
  h+=section('Prepayment plan',
    `<div style="display:flex;gap:18px;flex-wrap:wrap;align-items:center;font-size:14px;margin-bottom:8px">
      <span>Extra every month ${inp('root','','settings.extraPrepayPerMonth',S.extraPrepayPerMonth||0,{num:true,w:100})}</span>
      <span>One-off lump sum now <input type="number" value="${FIN_LUMP||''}" placeholder="0" style="${inBox};width:110px;text-align:right" onchange="finLumpSum(this)"></span>
      <label style="cursor:pointer"><input type="checkbox" ${S.rolloverFreedEmi?'checked':''} onchange="finEdit('root','','settings.rolloverFreedEmi',this)"> When a loan closes, its EMI goes to the next loan</label></div>`+
    `<div class="stats">${card('Next prepayment goes to',next?esc(next.name):'—',next?`${next.rate}% ${next.rateType}${next.prepayChargePct==null?' · charge unknown':n(next.prepayChargePct)?' · charge '+next.prepayChargePct+'%':''}`:'')}
      ${card('Debt-free',Number.isFinite(plan.months)?monthName(now,plan.months):'never',Number.isFinite(base.months)?`now ${monthName(now,base.months)}${mSaved>0?' · '+mSaved+' months sooner':''}`:'')}
      ${card('Interest saved',inr(Math.max(0,saved)),`vs EMIs only (${inr(base.interest)})${plan.charges>0?' · after '+inr(plan.charges)+' charges':''}`,'var(--green)')}</div>`+
    `<div style="font-size:12px;color:var(--t2);margin-top:4px">A month that beats the gross target: put the surplus in the lump-sum box to see what it buys, then pay it to the loan named above.</div>`);

  // expenses
  h+=section('Living expenses',tbl(['Item','Amount / month',''],FIN.expenses.map(e=>`<tr><td style="${cell}">${inp('expenses',e.id,'name',e.name,{w:320})}</td><td style="${cell}">${inp('expenses',e.id,'amount',e.amount,{num:true,w:110})}</td><td style="${cell}">${delBtn('expenses',e.id)}</td></tr>`),
    `<tr><td style="${cell};font-weight:700">Living total</td><td style="${cell};font-weight:700;text-align:right">${inr(living)}</td><td></td></tr><tr><td style="${cell}">+ loan EMIs</td><td style="${cell};text-align:right">${inr(emis)}</td><td></td></tr><tr><td style="${cell};font-weight:700">Total expenses</td><td style="${cell};font-weight:700;text-align:right">${inr(totalExp)}</td><td></td></tr>`,'lrc',true)+addBtn('expenses','expense'));

  // Partner's salary breakdown
  const mz=FIN.salary, mNet=n(mz.gross)-n(mz.deductions), mAlloc=(mz.allocations||[]).reduce((s,a)=>s+n(a.amount),0);
  (mz.allocations||[]).forEach(a=>{if(!a.id)a.id=uid('mz');});
  h+=section(esc(mz.label||'Partner salary'),`<div style="display:flex;gap:18px;flex-wrap:wrap;font-size:14px;margin-bottom:6px"><span>Gross ${inp('root','','salary.gross',mz.gross,{num:true,w:100})}</span><span>Deductions ${inp('root','','salary.deductions',mz.deductions,{num:true,w:100})}</span><span>Net <b>${inr(mNet)}</b></span></div>`+
    tbl(['Paid from her net','Amount',''],(mz.allocations||[]).map(a=>`<tr><td style="${cell}">${inp('salary',a.id,'name',a.name,{w:200})}</td><td style="${cell}">${inp('salary',a.id,'amount',a.amount,{num:true,w:100})}</td><td style="${cell}">${delBtn('salary',a.id)}</td></tr>`),
      `<tr><td style="${cell};font-weight:700">Allocated</td><td style="${cell};font-weight:700;text-align:right">${inr(mAlloc)}</td><td style="${cell};color:${mNet-mAlloc<0?'var(--red)':'var(--t2)'}">${mNet-mAlloc===0?'fully allocated':(mNet-mAlloc>0?inr(mNet-mAlloc)+' free':inr(mAlloc-mNet)+' over')}</td></tr>`,'lrl',true)+addBtn('salary','item'),
    'how her salary is spent today - informational; the plan does not depend on it');
  h+=`</div>`;
  const ae=document.activeElement, focusKey=ae&&ae.closest&&ae.closest('#finContent')?[...root.querySelectorAll('input,select')].indexOf(ae):-1;
  root.innerHTML=h;
  if(focusKey>=0){const el=root.querySelectorAll('input,select')[focusKey];if(el)el.focus();}
}

function dueList(){
  if(!FIN) return [];
  const now=new Date(),paidMap=(FIN.paid||{})[ymKey(now)]||{},soon=n((FIN.settings||{}).reminderDays)||3;
  return FIN.obligations.filter(o=>!paidMap[o.id]&&o.dueDay).map(o=>({o,d:n(o.dueDay)-now.getDate()})).filter(x=>x.d<=soon);
}
function setTabBadge(due){
  const el=$('tabCount3'); if(!el) return;
  due=due||dueList();
  const over=due.filter(x=>x.d<0).length;
  el.textContent=due.length?'('+due.length+(over?' overdue':' due')+')':'';
  el.style.color=over?'var(--red)':due.length?'var(--amber)':'';
  el.title=due.map(x=>x.o.name+' '+inr(x.o.amount)+' due on the '+ord(x.o.dueDay)).join(' · ');
}
window.RocketFinance={reload:loadFinance,render:()=>{if(!FIN&&!FIN_LOADING)loadFinance();else renderFinance();},
  _test:{taxBusiness,taxSTCG,grossFor,loanMonthsLeft,simulate,priorityRate}};
// Reminders matter even when the tab is closed: load once at start and refresh the tab every 10 minutes.
setTimeout(loadFinance,1500);
setInterval(()=>{setTabBadge();if($('tab3')&&$('tab3').classList.contains('act'))renderFinance();},10*60*1000);
})();
