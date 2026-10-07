// Global tab (5 Oct 2026): US (S&P 1500) and Saudi (Tadawul) picks from the local helper's
// international picker (dev/intl/intl_engine.py). Scoring and picking only - this tab places no orders.
(function(){
'use strict';
const H='http://localhost:8787';
const MK=[{id:'SA',flag:'🇸🇦',when:'Sun-Thu 12:30-17:30 IST'},{id:'US',flag:'🇺🇸',when:'Mon-Fri 19:00-01:30 IST (20:00-02:30 in Indian winter)'}];
const DATA={}, REC={}, ERR={};
const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const num=(v,d=2)=>Number.isFinite(Number(v))?Number(v).toFixed(d):'—';
const sgn=(v,d=2)=>Number.isFinite(Number(v))?(Number(v)>=0?'+':'')+Number(v).toFixed(d):'—';
const tm=s=>{if(!s)return '—';const d=new Date(s);return isNaN(d)?s:d.toLocaleString('en-IN',{weekday:'short',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});};
const cell='padding:6px 8px;border-bottom:1px solid var(--border)';

async function getFile(name){
  const r=await fetch(H+'/api/inputs/file?name='+encodeURIComponent(name),{cache:'no-store'});
  if(r.status===404) return null;
  if(!r.ok) throw new Error('helper HTTP '+r.status);
  return r.json();
}
async function load(){
  for(const m of MK){
    try{DATA[m.id]=await getFile('intl_'+m.id+'.json');REC[m.id]=await getFile('intl_'+m.id+'_record.json');ERR[m.id]=null;}
    catch(e){ERR[m.id]='Local helper not reachable ('+e.message+')';}
  }
  render();
}
window.intlRun=function(){};   // v1468: no manual scoring - the helper scores each market on its own schedule

function stageBadge(d){
  if(!d) return '';
  const c=d.live?['live - scored every '+(d.market==='SA'?10:15)+' min','var(--green)']:['market closed - last close','var(--t2)'];
  return `<span style="padding:2px 8px;border-radius:999px;border:1px solid ${c[1]};color:${c[1]};font-size:12px;font-weight:700">${c[0]}</span>`;
}
// v1469: one status line per market, then ONE table of every stock ranked by score with a Market column and filter
let FILTER=(()=>{try{return localStorage.getItem('rocket-intl-market-v1')||'ALL';}catch(_){return 'ALL';}})();
window.intlFilter=function(v){FILTER=v;try{localStorage.setItem('rocket-intl-market-v1',v);}catch(_){}render(true);};
function statusLine(m){
  const d=DATA[m.id];
  let h=`<div style="padding:8px 12px;border:1px solid var(--border);border-radius:10px;background:var(--bg-card);margin-bottom:6px;font-size:12px;color:var(--t2);line-height:1.6"><b style="font-size:14px;color:var(--t1)">${m.flag} ${esc(d?.name||m.id)}</b> ${stageBadge(d)} · ${m.when}<br>`;
  if(ERR[m.id]) return h+`<span style="color:var(--red)">${esc(ERR[m.id])}</span></div>`;
  if(!d) return h+`No run yet. The helper scores this market automatically while it is open (restart the helper if this persists).</div>`;
  if(!d.ok) return h+`<span style="color:var(--red)">Last run failed: ${esc(d.error)}</span></div>`;
  const R=d.rules||{}, gateOff=d.gateOn===false;
  return h+`Ensemble · scored ${tm(d.asOf)} on session ${esc(d.session)}${d.live&&d.minutesToClose!=null?` · closes in ${Math.round(d.minutesToClose)} min`:''} · ${d.universe} liquid stocks · trained through ${esc(d.trainedThrough)} · floor ${num(R.minScore,1)} · market ${sgn(d.marketTrendPct)}% vs 50-day avg ${gateOff?'<b style="color:var(--red)">(gate OFF - no buys)</b>':'(gate on)'} · cost ${R.costPct}% round trip${R.circuitBandPct?` · stocks locked at ±${R.circuitBandPct}% removed before scoring`:''}${d.lastError?` · <span style="color:var(--amber)">latest run failed ${tm(d.lastError.at)}: ${esc(d.lastError.error)}</span>`:''}</div>`;
}
const shown=()=>MK.map(m=>m.id).filter(id=>FILTER==='ALL'||FILTER===id);
function rankingTable(){
  const rows=[];
  for(const id of shown()){
    const d=DATA[id]; if(!d||!d.ok||ERR[id]) continue;
    const R=d.rules||{}, fl=Number(R.minScore), gateOff=d.gateOn===false, flag=MK.find(m=>m.id===id).flag;
    for(const r of (d.ranking||[])) rows.push({...r,mkt:id,flag,fl,tgt:R.targetPct,go:!gateOff&&Number(r.score)>=fl});
  }
  const sc=r=>Number.isFinite(Number(r.score))?Number(r.score):-1e9;
  rows.sort((a,b)=>sc(b)-sc(a));
  const go=rows.filter(r=>r.go);
  const opt=(v,t)=>`<option value="${v}"${FILTER===v?' selected':''}>${t}</option>`;
  let h=`<div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin:12px 0 6px"><label style="font-size:13px;color:var(--t2)">Market <select onchange="intlFilter(this.value)" style="margin-left:4px;padding:3px 6px;background:var(--bg-card);color:var(--t1);border:1px solid var(--border);border-radius:6px">${opt('ALL','All')}${MK.map(m=>opt(m.id,m.flag+' '+m.id)).join('')}</select></label>
    <span style="font-size:13px;font-weight:700;color:${go.length?'var(--green)':'var(--t2)'}">${go.length} GO · ${go.map(r=>esc(r.symbol)+' ('+r.mkt+')').join(', ')||'nothing at/above the floor - a no-pick session is the rule working'}</span></div>`;
  h+=`<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr>${['#','Market','Symbol','Name','Sector','Price','Today','Model Score','Status','Target','20d turnover'].map(x=>`<th style="${cell};text-align:left;color:var(--t2)">${x}</th>`).join('')}</tr></thead><tbody>`;
  rows.forEach((r,i)=>{
    h+=`<tr style="${r.go?'background:rgba(52,211,153,.08)':''}"><td style="${cell}">${i+1}</td><td style="${cell}">${r.flag} ${r.mkt}</td><td style="${cell};font-weight:700">${esc(r.symbol)}</td><td style="${cell}">${esc(r.name!==r.symbol?r.name:'')}</td><td style="${cell}">${esc(r.sector)}</td><td style="${cell}">${num(r.price)}</td><td style="${cell};color:${r.chgPct>=0?'var(--green)':'var(--red)'}">${sgn(r.chgPct)}%</td><td style="${cell};font-weight:700;color:${Number(r.score)>=r.fl?'var(--green)':'var(--amber)'}">${sgn(r.score,3)}</td><td style="${cell};font-weight:700;color:${r.go?'var(--green)':'var(--t2)'}">${r.go?'GO':'WAIT'}</td><td style="${cell}">${num(r.targetPrice)} <span style="color:var(--t2);font-size:11px">+${r.tgt}%</span></td><td style="${cell}">${(Number(r.turnover20)/1e6).toFixed(1)}M</td></tr>`;
  });
  if(!rows.length) h+=`<tr><td colspan="11" style="${cell};color:var(--t2)">No scored stocks for this filter yet.</td></tr>`;
  return h+`</tbody></table></div><div style="font-size:12px;color:var(--t2);margin-top:6px">Prices and turnover are in each market's own currency (SAR / USD). Research benchmark: score-crossing entry, +3% target or a two-session closing-price outcome, no stop. This is a benchmark horizon, not an NSE exit instruction. No exchange surveillance list exists for these markets in the app.</div>`;
}
function recordTable(){
  const rows=[];
  for(const id of shown()) for(const [day,s] of Object.entries(REC[id]?.sessions||{})) for(const p of (s.picks||[])) rows.push({...p,day,mkt:id});
  rows.sort((a,b)=>String(b.signalAt||b.day).localeCompare(String(a.signalAt||a.day)));
  let h=`<div style="font-size:13px;font-weight:700;color:var(--t2);text-transform:uppercase;letter-spacing:.08em;margin:18px 0 6px">Live record (first crossing per stock per session)</div>`;
  if(!rows.length) return h+`<div style="color:var(--t2);font-size:13px">Starts with the first live crossing.</div>`;
  const done=rows.filter(p=>p.netPct!=null), mean=done.length?done.reduce((a,p)=>a+p.netPct,0)/done.length:null;
  h+=`<div style="font-size:13px;margin-bottom:4px">${done.length} resolved · mean ${sgn(mean)}% net · ${done.length?Math.round(done.filter(p=>p.hitTarget).length/done.length*100)+'% hit target':'—'}</div>`;
  h+=`<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr>${['Session','Market','Pick','Signal','Entry','Exit day','Result (net)'].map(x=>`<th style="${cell};text-align:left;color:var(--t2)">${x}</th>`).join('')}</tr></thead><tbody>`;
  for(const p of rows.slice(0,60)) h+=`<tr><td style="${cell}">${p.day}</td><td style="${cell}">${p.mkt}</td><td style="${cell}">${esc(p.symbol)}</td><td style="${cell}">${tm(p.signalAt)}</td><td style="${cell}">${num(p.entry??p.price)}</td><td style="${cell}">${esc(p.exitDate||'open')}</td><td style="${cell};font-weight:700;color:${p.netPct==null?'var(--t2)':p.netPct>=0?'var(--green)':'var(--red)'}">${p.netPct==null?'pending':sgn(p.netPct)+'%'+(p.hitTarget?' 🎯':'')}</td></tr>`;
  return h+`</tbody></table></div>`;
}
function render(force){
  const root=$('intlContent'); if(!root) return;
  const ae=document.activeElement;
  if(!force&&ae&&ae.tagName==='SELECT'&&root.contains(ae)) return;   // don't rebuild under an open dropdown
  let h=`<div style="padding:12px 16px"><div style="font-size:13px;color:var(--t2);line-height:1.6;margin-bottom:10px">Separate international research feed: Ensemble score (5 models), your Score Floor and market gate, with crossing signals throughout each session. Trained and evaluated separately on each market's history. The fixed-target research benchmark does not provide NSE's adaptive broker protection. Picks only - no orders are placed.</div>`;
  h+=MK.map(statusLine).join('')+rankingTable()+recordTable()+`</div>`;
  root.innerHTML=h;
  const live=MK.reduce((n,m)=>n+((DATA[m.id]&&DATA[m.id].live&&(DATA[m.id].picks||[]).length)||0),0);
  const c=$('tabCount4'); if(c) c.textContent=live?'('+live+' GO)':'';
}
window.RocketIntl={reload:load,render:()=>{render();load();}};
setTimeout(load,2500);
setInterval(load,60000);
})();
