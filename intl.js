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
function marketBlock(m){
  const d=DATA[m.id], rec=REC[m.id];
  let h=`<div style="margin:14px 0 22px;padding:14px 16px;border:1px solid var(--border);border-radius:12px;background:var(--bg-card)">`;
  h+=`<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap"><div style="font-size:17px;font-weight:800">${m.flag} ${esc(d?.name||m.id)} ${stageBadge(d)}</div>
      <div style="font-size:12px;color:var(--t2)">${m.when} · scored automatically while open</div></div>`;
  if(ERR[m.id]) return h+`<div style="color:var(--red);margin-top:8px">${esc(ERR[m.id])}</div></div>`;
  if(!d) return h+`<div style="color:var(--t2);margin-top:8px">No run yet. The helper scores this market automatically while it is open (restart the helper if this persists).</div></div>`;
  if(!d.ok) return h+`<div style="color:var(--red);margin-top:8px">Last run failed: ${esc(d.error)}</div></div>`;
  const R=d.rules||{}, fl=Number(R.minScore);
  const gateOff=d.gateOn===false;
  h+=`<div style="font-size:12px;color:var(--t2);margin:6px 0 10px;line-height:1.6">Ensemble · scored ${tm(d.asOf)} on session ${esc(d.session)}${d.live&&d.minutesToClose!=null?` · closes in ${Math.round(d.minutesToClose)} min`:''} · ${d.universe} liquid stocks · trained through ${esc(d.trainedThrough)} · floor ${num(fl,1)} · market ${sgn(d.marketTrendPct)}% vs 50-day avg ${gateOff?'<b style="color:var(--red)">(gate OFF - no buys)</b>':'(gate on)'}${d.lastError?` · <span style="color:var(--amber)">latest run failed ${tm(d.lastError.at)}: ${esc(d.lastError.error)}</span>`:''}</div>`;
  const picks=d.picks||[];
  h+=`<div style="font-size:13px;font-weight:700;margin-bottom:6px;color:${picks.length?'var(--green)':'var(--t2)'}">${picks.length} GO${d.live?'':' at the last close'} · ${picks.map(p=>esc(p.symbol)).join(', ')||(gateOff?'market gate off':'nothing at/above the floor - a no-pick session is the rule working')}</div>`;
  // ranking table - same layout idea as the NSE Rankings tab
  h+=`<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr>${['#','Symbol','Name','Sector','Price','Today','Model Score','Status','Target (+'+R.targetPct+'%)','20d turnover'].map(x=>`<th style="${cell};text-align:left;color:var(--t2)">${x}</th>`).join('')}</tr></thead><tbody>`;
  (d.ranking||[]).forEach((r,i)=>{
    const go=!gateOff&&Number(r.score)>=fl;
    h+=`<tr style="${go?'background:rgba(52,211,153,.08)':''}"><td style="${cell}">${i+1}</td><td style="${cell};font-weight:700">${esc(r.symbol)}</td><td style="${cell}">${esc(r.name!==r.symbol?r.name:'')}</td><td style="${cell}">${esc(r.sector)}</td><td style="${cell}">${num(r.price)}</td><td style="${cell};color:${r.chgPct>=0?'var(--green)':'var(--red)'}">${sgn(r.chgPct)}%</td><td style="${cell};font-weight:700;color:${Number(r.score)>=fl?'var(--green)':'var(--amber)'}">${sgn(r.score,3)}</td><td style="${cell};font-weight:700;color:${go?'var(--green)':'var(--t2)'}">${go?'GO':'WAIT'}</td><td style="${cell}">${num(r.targetPrice)}</td><td style="${cell}">${(Number(r.turnover20)/1e6).toFixed(1)}M</td></tr>`;
  });
  h+=`</tbody></table></div>`;
  h+=`<div style="font-size:12px;color:var(--t2);margin-top:6px">Rule: ${esc(R.trade||'')}. Cost ${R.costPct}% round trip (${esc(R.costNote||'')}).${R.circuitBandPct?` Stocks locked at the ±${R.circuitBandPct}% daily limit are removed before scoring.`:''} No exchange surveillance list exists for this market in the app.</div>`;
  // live record
  const sess=Object.entries(rec?.sessions||{}).sort((a,b)=>b[0].localeCompare(a[0])).slice(0,15);
  const S=rec?.summary||{};
  h+=`<div style="font-size:13px;font-weight:700;color:var(--t2);text-transform:uppercase;letter-spacing:.08em;margin:14px 0 6px">Live record (first crossing per stock per session)</div>`;
  if(!sess.length) h+=`<div style="color:var(--t2);font-size:13px">Starts with the first live crossing.</div>`;
  else{
    h+=`<div style="font-size:13px;margin-bottom:4px">${S.resolvedTrades||0} resolved · mean ${sgn(S.meanNetPct)}% net · ${S.hitRate!=null?Math.round(S.hitRate*100)+'% hit +'+R.targetPct+'%':'—'}</div>`;
    h+=`<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr>${['Session','Pick','Signal','Entry','Exit day','Result (net)'].map(x=>`<th style="${cell};text-align:left;color:var(--t2)">${x}</th>`).join('')}</tr></thead><tbody>`;
    for(const [day,s] of sess) for(const p of (s.picks||[])) h+=`<tr><td style="${cell}">${day}</td><td style="${cell}">${esc(p.symbol)}</td><td style="${cell}">${tm(p.signalAt)}</td><td style="${cell}">${num(p.entry??p.price)}</td><td style="${cell}">${esc(p.exitDate||'open')}</td><td style="${cell};font-weight:700;color:${p.netPct==null?'var(--t2)':p.netPct>=0?'var(--green)':'var(--red)'}">${p.netPct==null?'pending':sgn(p.netPct)+'%'+(p.hitTarget?' 🎯':'')}</td></tr>`;
    h+=`</tbody></table></div>`;
  }
  return h+`</div>`;
}
function render(){
  const root=$('intlContent'); if(!root) return;
  let h=`<div style="padding:12px 16px"><div style="font-size:13px;color:var(--t2);line-height:1.6">Same system as NSE: Ensemble score (5 models, same scale), your Score Floor, the same market gate, buy when a stock crosses the floor at any time, +3% target else sell at the T+2 close, no stop. Trained separately on each market's history. Picks only - no orders are placed.</div>`;
  h+=MK.map(marketBlock).join('')+`</div>`;
  root.innerHTML=h;
  const live=MK.reduce((n,m)=>n+((DATA[m.id]&&DATA[m.id].live&&(DATA[m.id].picks||[]).length)||0),0);
  const c=$('tabCount4'); if(c) c.textContent=live?'('+live+' GO)':'';
}
window.RocketIntl={reload:load,render:()=>{render();load();}};
setTimeout(load,2500);
setInterval(load,60000);
})();
