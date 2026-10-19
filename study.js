// Study tab (19 Oct 2026): historical 1-minute explorer of each session's 30 biggest NSE gainers,
// with the two sessions before each win. A separate experiment - it reads only from its own local
// server (study_collect.py, localhost:8790), never touches the scanner's stores, scoring or orders,
// and nothing in it feeds trading. It shows data; it does not score, detect or recommend.
(function(){
'use strict';
const PREF_KEY='rs_study_ui_v1';      // per-viewer view preferences only; market data is never stored here
const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const isNum=v=>typeof v==='number'&&Number.isFinite(v);
const f2=v=>isNum(v)?v.toFixed(2):'—';
const fN=(v,d=2)=>isNum(v)?v.toFixed(d):'—';
const fInt=v=>isNum(v)?Math.round(v).toLocaleString('en-IN'):'—';
const fPct=(v,d=2)=>isNum(v)?(v>0?'+':'')+v.toFixed(d)+'%':'—';
const DOW=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const dow=iso=>DOW[new Date(iso+'T12:00:00Z').getUTCDay()];
const dayNum=iso=>Date.parse(iso+'T00:00:00Z')/864e5;
const SLOT_LABEL=['S-2','S-1','S0'];

let prefs={};
try{prefs=JSON.parse(localStorage.getItem(PREF_KEY)||'{}')||{};}catch(e){prefs={};}
const savePrefs=()=>{try{localStorage.setItem(PREF_KEY,JSON.stringify(prefs));}catch(e){}};
prefs.server=prefs.server||'http://localhost:8790';
prefs.view=prefs.view||'overview';
prefs.compare=Array.isArray(prefs.compare)?prefs.compare:[];
prefs.explore=prefs.explore||{x:'date',y:'gain',c:'rank',hist:'gain',bins:40};
prefs.heat=prefs.heat||'gain';

// ── server ───────────────────────────────────────────────────────────────────────────────────────
async function api(path,opt={}){
  const ctl=new AbortController(),t=setTimeout(()=>ctl.abort(),opt.timeout||30000);
  try{
    const r=await fetch(prefs.server+path,{cache:'no-store',signal:ctl.signal,
      ...(opt.body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(opt.body)}:{})});
    const j=await r.json();
    if(!r.ok||j.ok===false) throw new Error(j.why||('HTTP '+r.status));
    return j;
  }finally{clearTimeout(t);}
}

// ── data model ───────────────────────────────────────────────────────────────────────────────────
let STATUS=null,STATUS_ERR=null,DATA=null,DATA_ERR=null,LOADING=false,VERIFY=null;
let BY_KEY=new Map(),BY_DAY=new Map(),DAYS=[],SYMBOLS=[];
const instKey=(d,sym,ser)=>d+'|'+sym+'|'+ser;

function sessOf(arr,cols){
  if(!arr) return null;
  const o={};cols.forEach((c,i)=>o[c]=arr[i]);return o;
}
function buildModel(j){
  const ci={};j.cols.forEach((c,i)=>ci[c]=i);
  const sc=j.session_cols;
  const rows=j.rows.map(r=>{
    const s=[sessOf(r[ci.s2],sc),sessOf(r[ci.s1],sc),sessOf(r[ci.s0],sc)];
    const o={date:r[ci.date],rank:r[ci.rank],symbol:r[ci.symbol],series:r[ci.series],gain:r[ci.gain_pct],
      universe:r[ci.universe],tie:!!r[ci.tie],prior1:r[ci.prior1],prior2:r[ci.prior2],
      prevClose:r[ci.prev_close],open:r[ci.open],high:r[ci.high],low:r[ci.low],last:r[ci.last],close:r[ci.close],
      avg:r[ci.avg],qty:r[ci.qty],turnover:r[ci.turnover_lacs],trades:r[ci.trades],delivPer:r[ci.deliv_per],s};
    o.key=instKey(o.date,o.symbol,o.series);
    o.dates=[o.prior2,o.prior1,o.date];
    o.n2=s[0]?s[0].n:null;o.n1=s[1]?s[1].n:null;o.n0=s[2]?s[2].n:null;
    o.okSessions=s.filter(x=>x&&x.status==='ok').length;
    const s0=s[2],s1=s[1];
    o.s0first=s0&&s0.first_ts?s0.first_ts.slice(11,16):null;
    o.s0last=s0&&s0.last_ts?s0.last_ts.slice(11,16):null;
    o.hiDiff=s0&&s0.status==='ok'&&isNum(o.high)?s0.high-o.high:null;
    o.loDiff=s0&&s0.status==='ok'&&isNum(o.low)?s0.low-o.low:null;
    o.prevRatio=s1&&s1.status==='ok'&&o.prevClose>0?s1.close/o.prevClose:null;
    o.cVol=s0&&s0.status==='ok'?s0.volume:null;
    o.volRatio=isNum(o.cVol)&&o.qty>0?o.cVol/o.qty:null;
    o.gainCheck=o.prevClose>0&&isNum(o.close)?(o.close-o.prevClose)/o.prevClose*100:null;
    o.flags=flagsOf(o);
    return o;
  });
  const bySym=new Map();
  for(const o of rows){(bySym.get(o.symbol)||bySym.set(o.symbol,[]).get(o.symbol)).push(o);}
  for(const list of bySym.values()) list.forEach((o,i)=>{o.repeat=list.length;o.occ=i+1;});
  BY_KEY=new Map(rows.map(o=>[o.key,o]));
  BY_DAY=new Map();
  for(const o of rows){(BY_DAY.get(o.date)||BY_DAY.set(o.date,[]).get(o.date)).push(o);}
  for(const l of BY_DAY.values()) l.sort((a,b)=>a.rank-b.rank);
  DAYS=[...BY_DAY.keys()].sort().map(d=>{
    const l=BY_DAY.get(d),g=l.map(x=>x.gain).sort((a,b)=>a-b);
    return {date:d,dow:dow(d),n:l.length,universe:l[0].universe,max:g[g.length-1],min:g[0],
      median:g.length%2?g[(g.length-1)/2]:(g[g.length/2-1]+g[g.length/2])/2,
      complete:l.filter(x=>x.okSessions===3).length,flagged:l.filter(x=>x.flags.length).length,tie:l.some(x=>x.tie)};
  });
  SYMBOLS=[...bySym.entries()].map(([sym,l])=>({symbol:sym,series:[...new Set(l.map(x=>x.series))].join(','),
    wins:l.length,first:l[0].date,last:l[l.length-1].date,maxGain:Math.max(...l.map(x=>x.gain)),
    dates:l.map(x=>x.date).join(' ')}));
  return {rows,window:j.window||{},sessions:j.sessions||[]};
}
function flagsOf(o){
  const f=[];
  o.s.forEach((x,i)=>{
    if(!o.dates[i]) f.push(SLOT_LABEL[i]+' before calendar');
    else if(!x) f.push(SLOT_LABEL[i]+' not fetched');
    else if(x.status!=='ok') f.push(SLOT_LABEL[i]+' '+x.status.replace('_',' '));
    else{
      if(x.chrono_ok===0) f.push(SLOT_LABEL[i]+' chronology');
      if(x.ohlc_ok===0) f.push(SLOT_LABEL[i]+' OHLC');
      if(x.dup_ts>0) f.push(SLOT_LABEL[i]+' dup stamps');
    }
  });
  if(isNum(o.hiDiff)&&Math.abs(o.hiDiff)>0.001) f.push('high≠NSE');
  if(isNum(o.loDiff)&&Math.abs(o.loDiff)>0.001) f.push('low≠NSE');
  if(isNum(o.prevRatio)&&Math.abs(o.prevRatio-1)>0.02) f.push('S-1 close vs NSE prev >2%');
  if(o.tie) f.push('tie at #30');
  return f;
}

// Instance candles: one request per instance, kept in an LRU so navigating back costs nothing.
const CANDLE_CACHE=new Map(),CANDLE_INFLIGHT=new Map(),CACHE_MAX=600;
function candlesFor(inst){
  const k=inst.key;
  if(CANDLE_CACHE.has(k)){const v=CANDLE_CACHE.get(k);CANDLE_CACHE.delete(k);CANDLE_CACHE.set(k,v);return Promise.resolve(v);}
  if(CANDLE_INFLIGHT.has(k)) return CANDLE_INFLIGHT.get(k);
  const dates=inst.dates.filter(Boolean);
  const p=api('/study/candles?symbol='+encodeURIComponent(inst.symbol)+'&series='+encodeURIComponent(inst.series)
      +'&dates='+encodeURIComponent(dates.join(',')))
    .then(j=>{
      const byDate=new Map(j.sessions.map(s=>[s.date,s]));
      const sessions=inst.dates.map((d,i)=>d?(byDate.get(d)||{date:d,status:'not_fetched',candles:[]})
        :{date:null,status:'before calendar',candles:[]}).map((s,i)=>({...s,slot:SLOT_LABEL[i]}));
      const v={sessions,checks:checkSessions(sessions)};
      CANDLE_CACHE.set(k,v);
      while(CANDLE_CACHE.size>CACHE_MAX) CANDLE_CACHE.delete(CANDLE_CACHE.keys().next().value);
      return v;
    }).finally(()=>CANDLE_INFLIGHT.delete(k));
  CANDLE_INFLIGHT.set(k,p);
  return p;
}
// The same integrity facts the collector stores, re-read on the client from the candles shown.
function checkSessions(sessions){
  let chrono=true,ohlc=true,dateOk=true,n=0,gaps=0;
  for(const s of sessions){
    const c=s.candles||[];n+=c.length;
    for(let i=0;i<c.length;i++){
      const r=c[i];
      if(String(r[0]).slice(0,10)!==s.date) dateOk=false;
      if(i&&!(String(c[i-1][0])<String(r[0]))) chrono=false;
      if(!(r[3]<=Math.min(r[1],r[4])&&r[2]>=Math.max(r[1],r[4]))) ohlc=false;
      if(i&&minuteOf(r[0])-minuteOf(c[i-1][0])>1) gaps+=minuteOf(r[0])-minuteOf(c[i-1][0])-1;
    }
  }
  return {chrono,ohlc,dateOk,n,gaps};
}
const minuteOf=ts=>(+String(ts).slice(11,13))*60+(+String(ts).slice(14,16));
const hhmm=m=>String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0');

// ── chart geometry: three sessions laid end to end on a minute axis ──────────────────────────────
// Each session occupies its own trading window (09:15-15:30 = 375 minutes, widened if a candle falls
// outside it; a session wholly outside it, such as Muhurat, spans its own candles). A minute with no
// candle stays an empty slot - nothing is drawn there and nothing is interpolated.
const OPEN_M=555,CLOSE_M=930;
function layoutSessions(sessions){
  const lay=[],X=[],O=[],H=[],L=[],C=[],V=[],T=[],S=[];let off=0;
  sessions.forEach((s,i)=>{
    const c=s.candles||[];
    const mins=c.map(r=>minuteOf(r[0]));
    let start=OPEN_M,end=CLOSE_M;
    if(mins.length){
      const lo=Math.min(...mins),hi=Math.max(...mins);
      if(lo>=CLOSE_M||hi<OPEN_M){start=lo;end=hi+1;} else {start=Math.min(OPEN_M,lo);end=Math.max(CLOSE_M,hi+1);}
    }
    lay.push({i,date:s.date,status:s.status,slot:s.slot||SLOT_LABEL[i],start,end,off,w:end-start,n:c.length});
    c.forEach((r,j)=>{X.push(off+mins[j]-start+0.5);O.push(+r[1]);H.push(+r[2]);L.push(+r[3]);C.push(+r[4]);V.push(+r[5]||0);T.push(String(r[0]));S.push(i);});
    off+=end-start;
  });
  return {lay,X,O,H,L,C,V,T,S,total:off};
}
function niceTicks(lo,hi,n){
  if(!(hi>lo)){const d=Math.abs(lo)*0.01||1;lo-=d;hi+=d;}
  const raw=(hi-lo)/Math.max(1,n),mag=Math.pow(10,Math.floor(Math.log10(raw))),r=raw/mag;
  const step=(r<1.5?1:r<3?2:r<7?5:10)*mag,out=[];
  for(let v=Math.ceil(lo/step)*step;v<=hi+step*1e-9;v+=step) out.push(+v.toFixed(10));
  return {ticks:out,step};
}
const fmtTick=(v,step)=>{const d=step>=1?0:Math.min(6,Math.ceil(-Math.log10(step)));return v.toFixed(d);};
const css=n=>getComputedStyle(document.documentElement).getPropertyValue(n).trim()||null;
const COLORS=()=>({up:css('--green')||'#22c55e',down:css('--red')||'#ef4444',t2:css('--t2')||'#8994a8',t3:css('--t3')||'#7a8699',
  grid:'rgba(137,148,168,.12)',sep:'rgba(137,148,168,.45)',bg:css('--bg-card')||'#0c1018',cross:'rgba(232,237,245,.55)',
  sel:css('--amber')||'#fbbf24',lvl:css('--cyan')||'#06b6d4',empty:'rgba(137,148,168,.07)'});
const SERIES_COLORS=['#3b82f6','#f97316','#22c55e','#a78bfa','#06b6d4','#fbbf24','#ef4444','#14b8a6','#ec4899','#84cc16','#e8edf5','#8b5cf6'];

// One chart class. type 'candle': first series as candlesticks with a volume pane. type 'overlay':
// every series as a line on a shared axis (raw price or a chosen display normalisation).
class Chart{
  constructor(host,opt){
    this.host=host;this.opt=Object.assign({height:440,type:'candle',volume:true,mini:false},opt||{});
    host.innerHTML='';host.classList.add('sty-chart');
    this.cv=document.createElement('canvas');this.cv.tabIndex=this.opt.mini?-1:0;host.appendChild(this.cv);
    this.tip=document.createElement('div');this.tip.className='sty-tip';host.appendChild(this.tip);
    this.series=[];this.sel=-1;this.mouse=null;this.x0=0;this.x1=1;this.pointers=new Map();
    if(!this.opt.mini) this.bind();
    this.ro=new ResizeObserver(()=>this.draw());this.ro.observe(host);
  }
  destroy(){try{this.ro.disconnect();}catch(e){}}
  setSeries(list){
    this.series=list.map((s,i)=>({...s,d:layoutSessions(s.sessions),color:s.color||SERIES_COLORS[i%SERIES_COLORS.length]}));
    this.total=Math.max(1,...this.series.map(s=>s.d.total));
    this.sel=-1;this.reset(true);
  }
  reset(silent){this.x0=-1;this.x1=this.total+1;this.draw();if(!silent)this.emit();}
  setView(x0,x1,silent){
    const span=Math.max(8,Math.min(this.total*1.5+10,x1-x0));
    let a=x0,b=x0+span;const lo=-span*0.25,hi=this.total+span*0.25;
    if(a<lo){a=lo;b=a+span;} if(b>hi){b=hi;a=b-span;}
    this.x0=a;this.x1=b;this.draw();if(!silent)this.emit();
  }
  emit(){if(this.opt.onView)this.opt.onView(this.x0,this.x1,this);}
  zoomSession(i){const l=this.series[0]&&this.series[0].d.lay[i];if(l)this.setView(l.off-2,l.off+l.w+2);}
  geom(){
    const W=this.host.clientWidth||600,Hh=this.opt.height,mini=this.opt.mini;
    const left=mini?2:8,right=W-(mini?2:66),top=mini?14:22,bottom=Hh-(mini?2:22);
    const vol=this.opt.type==='candle'&&this.opt.volume&&!mini;
    const pBot=vol?top+(bottom-top)*0.76:bottom;
    return {W,Hh,left,right,top,bottom,pBot,vTop:pBot+8,vBot:bottom,vol};
  }
  px(x,g){return g.left+(x-this.x0)/(this.x1-this.x0)*(g.right-g.left);}
  xAt(px,g){return this.x0+(px-g.left)/(g.right-g.left)*(this.x1-this.x0);}
  // value shown for series s at candle j (overlay normalisation is a display choice the user makes)
  val(s,j,field){
    const arr=s.d[field||'C'];const v=arr[j];
    const base=s.base;
    return isNum(base)&&base>0?(v/base-1)*100:v;
  }
  visibleRange(g){
    let lo=Infinity,hi=-Infinity,vmax=0;
    for(const s of this.series){
      const d=s.d;
      for(let j=0;j<d.X.length;j++){
        const x=d.X[j];if(x<this.x0-1||x>this.x1+1) continue;
        if(this.opt.type==='candle'){if(d.L[j]<lo)lo=d.L[j];if(d.H[j]>hi)hi=d.H[j];if(d.V[j]>vmax)vmax=d.V[j];}
        else{const v=this.val(s,j);if(v<lo)lo=v;if(v>hi)hi=v;}
      }
      if(this.opt.type==='candle') break;
    }
    for(const l of (this.opt.type==='candle'&&this.series[0]&&this.series[0].levels)||[]){if(isNum(l.v)&&this.opt.showLevels){lo=Math.min(lo,l.v);hi=Math.max(hi,l.v);}}
    if(!isFinite(lo)){lo=0;hi=1;}
    const pad=(hi-lo)*0.05||Math.abs(hi)*0.01||1;
    return {lo:lo-pad,hi:hi+pad,vmax};
  }
  draw(){
    const g=this.geom(),dpr=window.devicePixelRatio||1,cv=this.cv,K=COLORS();
    if(cv.width!==Math.round(g.W*dpr)||cv.height!==Math.round(g.Hh*dpr)){cv.width=Math.round(g.W*dpr);cv.height=Math.round(g.Hh*dpr);cv.style.width=g.W+'px';cv.style.height=g.Hh+'px';}
    const ctx=cv.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,g.W,g.Hh);
    if(!this.series.length) return;
    const r=this.visibleRange(g);this.yr=r;
    const py=v=>g.pBot-(v-r.lo)/(r.hi-r.lo)*(g.pBot-g.top);this.py=py;
    const ppm=(g.right-g.left)/(this.x1-this.x0);
    ctx.font=(this.opt.mini?'10px':'11px')+" 'DM Mono',monospace";
    // y grid
    if(!this.opt.mini){
      const yt=niceTicks(r.lo,r.hi,Math.max(3,Math.floor((g.pBot-g.top)/48)));
      ctx.strokeStyle=K.grid;ctx.fillStyle=K.t3;ctx.lineWidth=1;ctx.textAlign='left';ctx.textBaseline='middle';
      for(const v of yt.ticks){const y=Math.round(py(v))+.5;if(y<g.top||y>g.pBot)continue;ctx.beginPath();ctx.moveTo(g.left,y);ctx.lineTo(g.right,y);ctx.stroke();
        ctx.fillText(fmtTick(v,yt.step)+(this.opt.type==='overlay'&&this.series.some(s=>isNum(s.base))?'%':''),g.right+6,y);}
    }
    ctx.save();ctx.beginPath();ctx.rect(g.left,0,g.right-g.left,g.Hh);ctx.clip();
    // sessions: separators, labels, empty sessions shown as such
    const lay=this.series[0].d.lay;
    for(const l of lay){
      const a=this.px(l.off,g),b=this.px(l.off+l.w,g);
      if(!l.n){ctx.fillStyle=K.empty;ctx.fillRect(a,g.top,b-a,g.bottom-g.top);
        if(!this.opt.mini&&b-a>80){ctx.fillStyle=K.t3;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(l.slot+' '+(l.date||'')+': no candles ('+l.status+')',(a+b)/2,(g.top+g.pBot)/2);}}
      if(l.off>0){ctx.strokeStyle=K.sep;ctx.setLineDash([4,4]);ctx.beginPath();ctx.moveTo(Math.round(a)+.5,g.top-(this.opt.mini?12:18));ctx.lineTo(Math.round(a)+.5,g.bottom);ctx.stroke();ctx.setLineDash([]);}
      if(b-a>(this.opt.mini?30:60)){ctx.fillStyle=l.i===2?K.sel:K.t2;ctx.textAlign='left';ctx.textBaseline='top';
        ctx.fillText(this.opt.mini?l.slot:(l.slot+' · '+(l.date?l.date+' '+dow(l.date):'—')+' · '+l.n+' candles'),Math.max(a,g.left)+4,this.opt.mini?1:4);}
    }
    // time axis
    if(!this.opt.mini){
      const steps=[1,2,5,10,15,30,60,120];let step=steps.find(s=>s*ppm>=60)||375;
      ctx.fillStyle=K.t3;ctx.textAlign='center';ctx.textBaseline='top';ctx.strokeStyle=K.grid;
      for(const l of lay){
        for(let m=Math.ceil(l.start/step)*step;m<l.end;m+=step){
          const x=this.px(l.off+m-l.start,g);if(x<g.left-20||x>g.right+20)continue;
          ctx.beginPath();ctx.moveTo(Math.round(x)+.5,g.top);ctx.lineTo(Math.round(x)+.5,g.bottom);ctx.stroke();
          ctx.fillText(hhmm(m),x,g.bottom+5);
        }
      }
    }
    if(this.opt.type==='candle') this.drawCandles(ctx,g,py,ppm,r,K); else this.drawLines(ctx,g,py,K);
    // selection + crosshair
    const s0=this.series[0];
    if(this.sel>=0&&this.opt.type==='candle'&&s0.d.X[this.sel]!=null){const x=this.px(s0.d.X[this.sel],g);ctx.strokeStyle=K.sel;ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(x,g.top);ctx.lineTo(x,g.bottom);ctx.stroke();}
    ctx.restore();
    if(this.mouse&&!this.opt.mini) this.drawCross(ctx,g,py,r,K);
  }
  drawCandles(ctx,g,py,ppm,r,K){
    const s=this.series[0],d=s.d,cw=Math.max(1,Math.min(14,ppm*0.72));
    if(this.opt.showLevels) for(const l of s.levels||[]){
      if(!isNum(l.v)) continue;const lay=d.lay[l.slot];if(!lay) continue;
      const a=this.px(lay.off,g),b=this.px(lay.off+lay.w,g),y=Math.round(py(l.v))+.5;
      ctx.strokeStyle=K.lvl;ctx.setLineDash([6,4]);ctx.beginPath();ctx.moveTo(a,y);ctx.lineTo(b,y);ctx.stroke();ctx.setLineDash([]);
      ctx.fillStyle=K.lvl;ctx.textAlign='left';ctx.textBaseline='bottom';ctx.fillText(l.label+' '+l.v.toFixed(2),Math.max(a,g.left)+4,y-2);
    }
    const vy=v=>g.vBot-v/(r.vmax||1)*(g.vBot-g.vTop);
    for(let j=0;j<d.X.length;j++){
      const x=d.X[j];if(x<this.x0-1||x>this.x1+1) continue;
      const cx=this.px(x,g),up=d.C[j]>=d.O[j];ctx.fillStyle=ctx.strokeStyle=up?K.up:K.down;
      if(cw<2.5){ctx.fillRect(Math.round(cx),py(d.H[j]),1,Math.max(1,py(d.L[j])-py(d.H[j])));}
      else{
        ctx.fillRect(Math.round(cx)-0.5,py(d.H[j]),1,Math.max(1,py(d.L[j])-py(d.H[j])));
        const yo=py(d.O[j]),yc=py(d.C[j]);ctx.fillRect(cx-cw/2,Math.min(yo,yc),cw,Math.max(1,Math.abs(yc-yo)));
      }
      if(g.vol){ctx.globalAlpha=.55;const y=vy(d.V[j]);ctx.fillRect(cx-Math.max(.5,cw/2),y,Math.max(1,cw),g.vBot-y);ctx.globalAlpha=1;}
    }
    if(g.vol){ctx.fillStyle=K.t3;ctx.textAlign='left';ctx.textBaseline='top';ctx.fillText('vol (max in view '+fInt(r.vmax)+')',g.left+4,g.vTop);}
  }
  drawLines(ctx,g,py,K){
    for(const s of this.series){
      const d=s.d;ctx.strokeStyle=s.color;ctx.lineWidth=this.opt.mini?1.2:1.4;ctx.beginPath();let pen=false,prevX=null,prevS=null;
      for(let j=0;j<d.X.length;j++){
        const x=d.X[j];if(x<this.x0-2||x>this.x1+2){pen=false;continue;}
        const X=this.px(x,g),Y=py(this.val(s,j));
        // a line never bridges a session boundary or a run of missing minutes longer than 15
        if(pen&&(d.S[j]!==prevS||x-prevX>15)) pen=false;
        if(pen) ctx.lineTo(X,Y); else ctx.moveTo(X,Y);
        pen=true;prevX=x;prevS=d.S[j];
      }
      ctx.stroke();
    }
    if(!this.opt.mini&&this.series.length>1){
      ctx.textAlign='left';ctx.textBaseline='top';let x=g.left+6;const y=g.top+16;
      for(const s of this.series){const t=s.label;ctx.fillStyle=s.color;ctx.fillRect(x,y+4,10,3);ctx.fillText(t,x+14,y);x+=ctx.measureText(t).width+30;if(x>g.right-120)break;}
    }
  }
  nearest(s,x){
    const d=s.d;let best=-1,bd=Infinity;
    for(let j=0;j<d.X.length;j++){const dd=Math.abs(d.X[j]-x);if(dd<bd){bd=dd;best=j;}}
    return bd<=Math.max(2,(this.x1-this.x0)/150)?best:-1;
  }
  drawCross(ctx,g,py,r,K){
    const {x:mx,y:my}=this.mouse;if(mx<g.left||mx>g.right){this.tip.style.display='none';return;}
    const xv=this.xAt(mx,g);
    ctx.strokeStyle=K.cross;ctx.setLineDash([3,3]);ctx.lineWidth=1;
    ctx.beginPath();ctx.moveTo(Math.round(mx)+.5,g.top);ctx.lineTo(Math.round(mx)+.5,g.bottom);ctx.stroke();
    if(my>=g.top&&my<=g.pBot){ctx.beginPath();ctx.moveTo(g.left,Math.round(my)+.5);ctx.lineTo(g.right,Math.round(my)+.5);ctx.stroke();
      const v=r.lo+(g.pBot-my)/(g.pBot-g.top)*(r.hi-r.lo);ctx.setLineDash([]);ctx.fillStyle=K.bg;ctx.fillRect(g.right+1,my-8,64,16);ctx.fillStyle=css('--t1');ctx.textAlign='left';ctx.textBaseline='middle';ctx.fillText(v.toFixed(2),g.right+5,my);}
    ctx.setLineDash([]);
    let html='';
    if(this.opt.type==='candle'){
      const s=this.series[0],j=this.nearest(s,xv);this.hoverIdx=j;
      const lay=s.d.lay.find(l=>xv>=l.off&&xv<l.off+l.w);
      if(j>=0){const d=s.d,t=d.T[j];
        html=`<b>${esc(t.slice(0,10))} ${esc(t.slice(11,16))}</b> <span class="sty-dim">${esc(SLOT_LABEL[d.S[j]])}</span><br>`
          +`O ${d.O[j]} &nbsp;H ${d.H[j]}<br>L ${d.L[j]} &nbsp;C ${d.C[j]}<br>Vol ${fInt(d.V[j])}`
          +`<br><span class="sty-dim">${esc(t)}</span>`;}
      else if(lay){const m=lay.start+Math.floor(xv-lay.off);html=`<b>${esc(lay.date||'—')} ${hhmm(m)}</b><br><span class="sty-dim">no candle at this minute</span>`;}
    }else{
      const rows=[];
      for(const s of this.series){const j=this.nearest(s,xv);if(j<0)continue;const d=s.d;
        rows.push(`<span style="color:${s.color}">■</span> ${esc(s.label)} <span class="sty-dim">${esc(d.T[j].slice(0,10))} ${esc(d.T[j].slice(11,16))}</span> C ${d.C[j]}${isNum(s.base)?' · '+fPct(this.val(s,j)):''}`);}
      html=rows.join('<br>');
    }
    if(!html){this.tip.style.display='none';return;}
    this.tip.innerHTML=html;this.tip.style.display='block';
    const tw=this.tip.offsetWidth,th=this.tip.offsetHeight;
    let tx=mx+14,ty=my+14;if(tx+tw>g.W-4)tx=mx-tw-14;if(ty+th>g.Hh)ty=Math.max(0,my-th-14);
    this.tip.style.left=tx+'px';this.tip.style.top=ty+'px';
  }
  bind(){
    const cv=this.cv,pos=e=>{const b=cv.getBoundingClientRect();return {x:e.clientX-b.left,y:e.clientY-b.top};};
    cv.addEventListener('wheel',e=>{e.preventDefault();const g=this.geom(),p=pos(e),xv=this.xAt(p.x,g),k=Math.exp((e.deltaY||e.deltaX)*0.0015);
      this.setView(xv-(xv-this.x0)*k,xv+(this.x1-xv)*k);},{passive:false});
    cv.addEventListener('pointerdown',e=>{cv.setPointerCapture(e.pointerId);this.pointers.set(e.pointerId,pos(e));this.drag={start:pos(e),x0:this.x0,x1:this.x1,moved:false};});
    cv.addEventListener('pointermove',e=>{
      const p=pos(e);this.mouse=p;
      if(this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId,p);
      const g=this.geom();
      if(this.pointers.size===2){const [a,b]=[...this.pointers.values()];const dist=Math.abs(a.x-b.x)||1;
        if(!this.pinch)this.pinch={dist,x0:this.x0,x1:this.x1,mid:this.xAt((a.x+b.x)/2,g)};
        const k=this.pinch.dist/dist,m=this.pinch.mid;this.setView(m-(m-this.pinch.x0)*k,m+(this.pinch.x1-m)*k);return;}
      if(this.drag&&this.pointers.size===1){const dx=p.x-this.drag.start.x;if(Math.abs(dx)>3)this.drag.moved=true;
        if(this.drag.moved){const dv=dx/(g.right-g.left)*(this.drag.x1-this.drag.x0);this.setView(this.drag.x0-dv,this.drag.x1-dv);return;}}
      this.draw();
    });
    const up=e=>{this.pointers.delete(e.pointerId);if(this.pointers.size<2)this.pinch=null;
      if(this.drag&&!this.drag.moved&&e.type==='pointerup'&&this.opt.type==='candle'){const g=this.geom(),j=this.nearest(this.series[0],this.xAt(pos(e).x,g));if(j>=0)this.select(j);}
      if(!this.pointers.size)this.drag=null;};
    cv.addEventListener('pointerup',up);cv.addEventListener('pointercancel',up);
    cv.addEventListener('pointerleave',()=>{this.mouse=null;this.tip.style.display='none';this.draw();});
    cv.addEventListener('dblclick',()=>this.reset());
    cv.addEventListener('keydown',e=>{
      if(this.opt.type!=='candle'||!this.series.length) return;
      const n=this.series[0].d.X.length;if(!n) return;
      if(e.key==='ArrowRight'||e.key==='ArrowLeft'){e.preventDefault();e.stopPropagation();
        this.select(Math.max(0,Math.min(n-1,(this.sel<0?0:this.sel)+(e.key==='ArrowRight'?1:-1)*(e.shiftKey?15:1))),true);}
      else if(e.key==='+'||e.key==='='){const m=(this.x0+this.x1)/2,h=(this.x1-this.x0)/2/1.3;this.setView(m-h,m+h);}
      else if(e.key==='-'){const m=(this.x0+this.x1)/2,h=(this.x1-this.x0)/2*1.3;this.setView(m-h,m+h);}
      else if(e.key==='0') this.reset();
    });
  }
  select(j,keep){
    this.sel=j;const d=this.series[0].d;
    if(keep){const x=d.X[j];if(x<this.x0||x>this.x1){const h=(this.x1-this.x0)/2;this.setView(x-h,x+h);}}
    this.draw();if(this.opt.onSelect)this.opt.onSelect(j,d);
  }
}

// ── generic sortable / filterable table ──────────────────────────────────────────────────────────
// Filters: numbers accept  >5  <=2  3..7  =4  !=0  (space = AND); text is a case-insensitive
// substring, '=' for exact, '!' to exclude. The filtered rows are what the charts beside it show.
function parseFilter(q,num){
  q=String(q||'').trim();if(!q) return null;
  if(!num){
    const neg=q.startsWith('!'),exact=q.replace(/^!/,'').startsWith('='),t=q.replace(/^!?=?/,'').toLowerCase();
    return v=>{const s=String(v??'').toLowerCase();const m=exact?s===t:s.includes(t);return neg?!m:m;};
  }
  const tests=q.split(/\s+/).map(p=>{
    let m=p.match(/^(-?[\d.]+)\.\.(-?[\d.]+)$/);if(m){const a=+m[1],b=+m[2];return v=>v>=a&&v<=b;}
    m=p.match(/^(>=|<=|!=|>|<|=)?(-?[\d.]+)$/);if(!m) return ()=>true;
    const n=+m[2];switch(m[1]){case'>':return v=>v>n;case'<':return v=>v<n;case'>=':return v=>v>=n;case'<=':return v=>v<=n;case'!=':return v=>v!==n;default:return v=>v===n;}
  });
  return v=>isNum(v)&&tests.every(t=>t(v));
}
class Table{
  constructor(host,opt){this.host=host;this.o=Object.assign({page:100,state:{}},opt);this.st=Object.assign({sort:null,dir:1,filters:{},page:0},this.o.state);this.mount();}
  colVal(c,r){return c.get?c.get(r):r[c.k];}
  filtered(){
    const fs=this.o.cols.map(c=>[c,parseFilter(this.st.filters[c.k],c.num)]).filter(x=>x[1]);
    let rows=fs.length?this.o.rows.filter(r=>fs.every(([c,f])=>f(this.colVal(c,r)))):this.o.rows.slice();
    if(this.st.sort){const c=this.o.cols.find(c=>c.k===this.st.sort);if(c){const d=this.st.dir;
      rows.sort((a,b)=>{const x=this.colVal(c,a),y=this.colVal(c,b);if(x==null&&y==null)return 0;if(x==null)return 1;if(y==null)return -1;return (x<y?-1:x>y?1:0)*d;});}}
    return rows;
  }
  mount(){
    const c=this.o.cols;
    this.host.innerHTML=`<div class="sty-tbar"><span class="sty-count"></span><span class="sty-pager"></span>${this.o.csv?'<button class="btn sty-sm" data-t="csv">⬇ CSV</button>':''}</div>`
      +`<div class="sty-tw"><table class="main sty-t"><thead><tr>${c.map(x=>`<th data-k="${x.k}" title="${esc(x.title||'')}">${esc(x.label)}<span class="sa"></span></th>`).join('')}</tr>`
      +`<tr class="sty-f">${c.map(x=>`<th><input data-f="${x.k}" value="${esc(this.st.filters[x.k]||'')}" placeholder="${x.num?'>0':'filter'}"></th>`).join('')}</tr></thead><tbody></tbody></table></div>`;
    this.host.querySelector('thead tr').addEventListener('click',e=>{const th=e.target.closest('th[data-k]');if(!th)return;const k=th.dataset.k;
      if(this.st.sort===k)this.st.dir=-this.st.dir;else{this.st.sort=k;this.st.dir=(c.find(x=>x.k===k).num?-1:1);}this.st.page=0;this.renderBody();});
    this.host.querySelector('.sty-f').addEventListener('input',e=>{const k=e.target.dataset.f;if(!k)return;this.st.filters[k]=e.target.value;this.st.page=0;
      clearTimeout(this._ft);this._ft=setTimeout(()=>this.renderBody(),160);});
    this.host.addEventListener('click',e=>{
      const pg=e.target.closest('[data-pg]');if(pg){this.st.page=+pg.dataset.pg;this.renderBody();return;}
      if(e.target.closest('[data-t="csv"]')){this.exportCsv();return;}
      const tr=e.target.closest('tbody tr[data-i]');if(tr&&this.o.onRow&&!e.target.closest('a,button,input'))this.o.onRow(this.view[+tr.dataset.i],e);
    });
    this.renderBody();
  }
  setRows(rows){this.o.rows=rows;this.renderBody();}
  renderBody(){
    const rows=this.filtered();this.view=rows;
    const ps=this.o.page,pages=Math.max(1,Math.ceil(rows.length/ps));this.st.page=Math.min(this.st.page,pages-1);
    const a=this.st.page*ps,slice=rows.slice(a,a+ps);
    this.host.querySelector('tbody').innerHTML=slice.map((r,i)=>`<tr data-i="${a+i}"${this.o.rowAttr?this.o.rowAttr(r):''}>${this.o.cols.map(c=>{
      const v=this.colVal(c,r);return `<td${c.num?' style="text-align:right"':''}${c.cls?` class="${c.cls}"`:''}>${c.fmt?c.fmt(v,r):esc(v??'—')}</td>`;}).join('')}</tr>`).join('')
      ||`<tr><td colspan="${this.o.cols.length}" style="color:var(--t3);padding:18px">No rows match.</td></tr>`;
    this.host.querySelectorAll('thead th[data-k]').forEach(th=>{const on=th.dataset.k===this.st.sort;th.classList.toggle('sorted',on);th.querySelector('.sa').textContent=on?(this.st.dir>0?'▲':'▼'):'';});
    this.host.querySelector('.sty-count').textContent=rows.length.toLocaleString('en-IN')+' of '+this.o.rows.length.toLocaleString('en-IN')+' rows';
    const pg=[];if(pages>1){const p=this.st.page;
      pg.push(`<button class="btn sty-sm" data-pg="${Math.max(0,p-1)}" ${p?'':'disabled'}>‹</button>`,`<span class="sty-dim">page ${p+1}/${pages}</span>`,`<button class="btn sty-sm" data-pg="${Math.min(pages-1,p+1)}" ${p<pages-1?'':'disabled'}>›</button>`);}
    this.host.querySelector('.sty-pager').innerHTML=pg.join(' ');
    if(this.o.onFilter) this.o.onFilter(rows);
  }
  exportCsv(){
    const q=v=>{const s=String(v??'');return /[",\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;};
    const lines=[this.o.cols.map(c=>q(c.label)).join(',')].concat(this.view.map(r=>this.o.cols.map(c=>q(this.colVal(c,r))).join(',')));
    const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([lines.join('\n')],{type:'text/csv'}));a.download=(this.o.csv||'study')+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),5000);
  }
}

// ── columns ──────────────────────────────────────────────────────────────────────────────────────
const tSym=(v,r)=>`<b>${esc(v)}</b>${r.series!=='EQ'?` <span class="sty-dim">${esc(r.series)}</span>`:''}`;
const tGain=v=>`<span style="color:var(--green)">${fPct(v)}</span>`;
const tFlags=v=>v&&v.length?`<span class="sty-flag" title="${esc(v.join('\n'))}">${esc(v.length===1?v[0]:v.length+' flags')}</span>`:'<span class="sty-dim">—</span>';
const tSess=(v,r,i)=>{const s=r.s[i];if(!r.dates[i])return '<span class="sty-dim">n/a</span>';if(!s)return '<span class="sty-dim">·</span>';
  return s.status==='ok'?String(s.n):`<span class="sty-flag">${esc(s.status.replace('_',' '))}</span>`;};
const INST_COLS=[
  {k:'date',label:'Date',fmt:(v)=>`${esc(v)} <span class="sty-dim">${dow(v)}</span>`},
  {k:'rank',label:'#',num:true,title:'EOD position by gain among the universe that day'},
  {k:'symbol',label:'Symbol',fmt:tSym},
  {k:'gain',label:'Gain %',num:true,fmt:tGain,title:'(NSE CLOSE_PRICE − PREV_CLOSE) / PREV_CLOSE'},
  {k:'prevClose',label:'NSE prev',num:true,fmt:f2},{k:'open',label:'Open',num:true,fmt:f2},{k:'high',label:'High',num:true,fmt:f2},
  {k:'low',label:'Low',num:true,fmt:f2},{k:'close',label:'NSE close',num:true,fmt:f2,title:'Official close (closing-session price)'},
  {k:'last',label:'Last',num:true,fmt:f2,title:'Last traded price'},
  {k:'qty',label:'NSE volume',num:true,fmt:fInt},{k:'turnover',label:'Turnover ₹L',num:true,fmt:v=>fN(v,1)},
  {k:'trades',label:'Trades',num:true,fmt:fInt},{k:'delivPer',label:'Deliv %',num:true,fmt:v=>fN(v,1)},
  {k:'repeat',label:'Wins in year',num:true,title:'How many sessions this symbol is in the top 30'},
  {k:'n2',label:'S-2 cdl',num:true,fmt:(v,r)=>tSess(v,r,0),title:'1-minute candles stored for the second session before'},
  {k:'n1',label:'S-1 cdl',num:true,fmt:(v,r)=>tSess(v,r,1)},
  {k:'n0',label:'S0 cdl',num:true,fmt:(v,r)=>tSess(v,r,2),title:'1-minute candles on the winning day'},
  {k:'s0first',label:'S0 first'},{k:'s0last',label:'S0 last'},
  {k:'hiDiff',label:'Cdl hi − NSE hi',num:true,fmt:v=>fN(v,2),title:'Highest candle high minus NSE HIGH_PRICE (verification)'},
  {k:'loDiff',label:'Cdl lo − NSE lo',num:true,fmt:v=>fN(v,2)},
  {k:'prevRatio',label:'S-1 last ÷ NSE prev',num:true,fmt:v=>fN(v,4),title:'Last candle close of S-1 ÷ NSE PREV_CLOSE; far from 1 can mean an adjustment or corporate action'},
  {k:'volRatio',label:'Cdl vol ÷ NSE vol',num:true,fmt:v=>fN(v,3)},
  {k:'universe',label:'Universe',num:true,title:'Stocks ranked that day'},
  {k:'flags',label:'Data flags',get:r=>r.flags,fmt:tFlags},
];
const FLAG_TEXT=r=>r.flags.join('; ');
const NUM_FIELDS=[['date','Date',r=>dayNum(r.date)],['rank','EOD rank'],['gain','Gain %'],['prevClose','NSE prev close'],['open','Open'],['high','High'],
  ['low','Low'],['close','NSE close'],['qty','NSE volume'],['turnover','Turnover ₹L'],['trades','Trades'],['delivPer','Deliv %'],
  ['repeat','Wins in year'],['occ','Nth win of symbol'],['n2','S-2 candles'],['n1','S-1 candles'],['n0','S0 candles'],['okSessions','Sessions with candles'],
  ['hiDiff','Cdl hi − NSE hi'],['loDiff','Cdl lo − NSE lo'],['prevRatio','S-1 last ÷ NSE prev'],['volRatio','Cdl vol ÷ NSE vol'],['universe','Universe'],
  ['dow','Weekday',r=>new Date(r.date+'T12:00:00Z').getUTCDay()]].map(([k,l,g])=>({k,l,g:g||(r=>r[k])}));
const field=k=>NUM_FIELDS.find(f=>f.k===k)||NUM_FIELDS[0];

// ── views ────────────────────────────────────────────────────────────────────────────────────────
let CHARTS=[];
const killCharts=()=>{CHARTS.forEach(c=>c.destroy&&c.destroy());CHARTS=[];};
let TABLES={};
const VIEWS=[['overview','Overview'],['days','Days'],['day','Day'],['inst','Stock'],['compare','Compare'],['explore','Explore'],['symbols','Symbols']];

function go(view,patch){Object.assign(prefs,patch||{});prefs.view=view;savePrefs();render();window.scrollTo({top:Math.max(0,($('tab4')||document.body).offsetTop-90)});}
function crumbs(){
  const b=[`<a data-go="overview">Year</a>`];
  if(['day','inst'].includes(prefs.view)&&prefs.day) b.push(`<a data-go="day">${esc(prefs.day)}</a>`);
  if(prefs.view==='inst'){const i=BY_KEY.get(prefs.inst);if(i)b.push(`<a data-go="inst">#${i.rank} ${esc(i.symbol)}</a>`);if(prefs.candle)b.push(`<span>${esc(prefs.candle)}</span>`);}
  return b.join(' <span class="sty-dim">›</span> ');
}
function shell(body){
  const n=prefs.compare.length;
  return `<div class="sty">`
    +`<div class="sty-head"><div><h3 style="margin:0">🧪 Study · 1-minute history of the daily top-30 gainers</h3>`
    +`<div class="sty-dim" style="font-size:13px">Observation only. Separate from trading: its own data, its own server, nothing here feeds the scanner.</div></div>`
    +`<div class="sty-dim" style="font-size:12px;text-align:right">${STATUS?esc(STATUS.calendar_first||'')+' → '+esc(STATUS.calendar_last||'')+' · '+fInt(STATUS.instances)+' instances':''}</div></div>`
    +`<div class="tabs sty-sub">${VIEWS.map(([k,l])=>`<div class="tab${prefs.view===k?' act':''}" data-go="${k}">${l}${k==='compare'&&n?' ('+n+')':''}</div>`).join('')}</div>`
    +`<div class="sty-crumbs">${crumbs()}</div><div id="styBody">${body}</div></div>`;
}
function render(){
  const root=$('studyContent');if(!root) return;
  killCharts();TABLES={};
  if(!DATA){root.innerHTML=shell(statusPanel(true));wireStatus();return;}
  const v=prefs.view;
  const fn={overview:viewOverview,days:viewDays,day:viewDay,inst:viewInst,compare:viewCompare,explore:viewExplore,symbols:viewSymbols}[v]||viewOverview;
  fn(root);
}

function statusPanel(full){
  const s=STATUS,j=s&&s.job;
  const run=j&&j.running;
  let h=`<div class="sty-card" id="styStatus"><div class="sty-row"><b>Study server</b>
    <input id="stySrv" value="${esc(prefs.server)}" style="width:220px"> <button class="btn sty-sm" data-act="reconnect">Connect</button>
    ${STATUS_ERR?`<span class="sty-flag">not reachable: ${esc(STATUS_ERR)}</span>`:s?'<span class="pill-green info-pill">connected</span>':''}</div>`;
  if(STATUS_ERR||!s){
    h+=`<div class="sty-help">Start the local study server on the PC (Python 3, nothing to install):<pre>python3 study_collect.py serve</pre>
      It keeps its data in <code>~/RocketScannerStudy/study.db</code>, outside the public repo. The trading helper is not involved.</div></div>`;
    return h;
  }
  const cs=s.candle_sessions||{};
  h+=`<div class="stats" style="--card-min:150px;margin:12px 0">
    ${stat('Sessions on calendar',fInt(s.calendar_sessions),(s.calendar_first||'—')+' → '+(s.calendar_last||'—'))}
    ${stat('Winning days',fInt(s.winner_days),'top 30 each')}
    ${stat('Instances',fInt(s.instances),'stock × winning day')}
    ${stat('Sessions with candles',fInt(cs.ok||0),'empty '+fInt(cs.empty||0)+' · no token '+fInt(cs.no_token||0))}
    ${stat('Requests pending',fInt(s.pending_requests),'to Kite, 3/s')}</div>`;
  h+=`<div class="sty-row"><b>Kite</b> ${s.has_credentials?'<span class="pill-green info-pill">credentials set</span>':'<span class="pill-orange info-pill">needed for candles</span>'}
    <input id="styKey" placeholder="api key" style="width:150px" autocomplete="off"> <input id="styTok" type="password" placeholder="access token (today's)" style="width:220px" autocomplete="off">
    <button class="btn sty-sm" data-act="creds">Set</button><span class="sty-dim" style="font-size:12px">held in the server's memory only</span></div>`;
  h+=`<div class="sty-row"><button class="btn sty-sm" data-act="collect" data-stage="bhav" ${run?'disabled':''}>① Bhavcopies + top 30</button>
    <button class="btn sty-sm" data-act="collect" data-stage="candles" ${run?'disabled':''}>② 1-minute candles</button>
    <button class="btn sty-sm btn-fire" data-act="collect" data-stage="all" ${run?'disabled':''}>Run / resume all</button>
    <button class="btn sty-sm" data-act="stop" ${run?'':'disabled'}>Stop</button>
    <button class="btn sty-sm" data-act="reload">Reload data</button><button class="btn sty-sm" data-act="verify">Verify</button></div>`;
  if(j&&(j.running||j.error||j.stage)){
    const pct=j.total?Math.round(j.done/j.total*100):0;
    h+=`<div class="sty-row"><span>${run?'Running':'Last run'}: <b>${esc(j.stage||'—')}</b> ${fInt(j.done)}/${fInt(j.total)} ${esc(j.current||'')}</span>
      <div class="sty-bar"><div style="width:${pct}%"></div></div>${j.error?`<span class="sty-flag">${esc(j.error)}</span>`:''}</div>`;
    if(j.notes&&j.notes.length) h+=`<details><summary class="sty-dim">log (${j.notes.length})</summary><pre class="sty-log">${esc(j.notes.join('\n'))}</pre></details>`;
  }
  if(VERIFY) h+=verifyHtml();
  if(DATA_ERR) h+=`<div class="sty-flag">${esc(DATA_ERR)}</div>`;
  return h+`</div>`;
}
const stat=(l,v,d)=>`<div class="st"><div class="st-l">${esc(l)}</div><div class="st-v" style="font-size:22px">${esc(v)}</div><div class="st-d">${esc(d)}</div></div>`;
function verifyHtml(){
  const r=VERIFY.report||{},c=VERIFY.client||{};
  const row=(k,v,ok)=>`<tr><td>${esc(k)}</td><td style="text-align:right">${esc(v)}</td><td>${ok?'✓':'<span class="sty-flag">check</span>'}</td></tr>`;
  return `<div class="sty-card" style="margin-top:10px"><b>Verification</b> <span class="sty-dim">(server re-derivation + client re-check of loaded data)</span>
  <table class="main" style="width:auto;margin-top:6px"><tbody>
  ${row('Winner rows re-derived from bhavcopy',fInt(r.winners),true)}
  ${row('Gain % mismatches (independent arithmetic)',fInt(r.gain_mismatch),!r.gain_mismatch)}
  ${row('Rank-order violations',fInt(r.rank_mismatch),!r.rank_mismatch)}
  ${row('Days with fewer than 30 winners',fInt(r.days_short),!r.days_short)}
  ${row('Sessions with candles',fInt(r.sessions_ok),true)}
  ${row('Chronology violations',fInt(r.chronology_violations),!r.chronology_violations)}
  ${row('OHLC violations (low ≤ open,close ≤ high)',fInt(r.ohlc_violations),!r.ohlc_violations)}
  ${row('Sessions with duplicate stamps',fInt(r.duplicate_stamps),!r.duplicate_stamps)}
  ${row('Winning-day candle high = NSE high',fInt(r.high_matches_bhav)+' / '+fInt(r.winning_day_sessions),true)}
  ${row('Winning-day candle low = NSE low',fInt(r.low_matches_bhav)+' / '+fInt(r.winning_day_sessions),true)}
  ${row('Instances with all three sessions',fInt(r.instances_complete)+' / '+fInt(c.instances),true)}
  ${row('Client gain re-check mismatches',fInt(c.gainMismatch),!c.gainMismatch)}
  </tbody></table><div class="sty-dim" style="font-size:12px;margin-top:6px">High/low differences are reported, not corrected: Kite's minute candles and NSE's day record can legitimately differ (e.g. trades in the closing session, or adjusted history).</div></div>`;
}
function wireStatus(){
  const root=$('studyContent');if(!root||root._wired) return;root._wired=true;
  root.addEventListener('click',async e=>{
    const g=e.target.closest('[data-go]');if(g){e.preventDefault();go(g.dataset.go);return;}
    const a=e.target.closest('[data-act]');if(!a) return;
    const act=a.dataset.act;
    try{
      if(act==='reconnect'){prefs.server=($('stySrv').value||'').trim().replace(/\/$/,'')||prefs.server;savePrefs();DATA=null;await refresh(true);}
      else if(act==='creds'){await api('/study/credentials',{body:{api_key:$('styKey').value,access_token:$('styTok').value}});await refresh();}
      else if(act==='collect'){await api('/study/collect',{body:{stage:a.dataset.stage}});await refresh();poll();}
      else if(act==='stop'){await api('/study/stop',{body:{}});await refresh();}
      else if(act==='reload'){DATA=null;CANDLE_CACHE.clear();await refresh(true);}
      else if(act==='verify'){a.disabled=true;const j=await api('/study/verify',{timeout:300000});VERIFY={report:j.report,client:clientVerify()};render();}
      else if(act==='pin'){togglePin(a.dataset.key);}
      else if(act==='nav'){navInst(a.dataset.dir);}
      else if(act==='zoom'){const c=CHARTS[0];if(c){a.dataset.s==='all'?c.reset():c.zoomSession(+a.dataset.s);}}
    }catch(err){alert('Study: '+err.message);}
  });
}
function clientVerify(){
  const rows=DATA?DATA.rows:[];let gm=0;
  for(const r of rows) if(isNum(r.gainCheck)&&Math.abs(r.gainCheck-r.gain)>1e-7) gm++;
  return {instances:rows.length,gainMismatch:gm,shortDays:DAYS.filter(d=>d.n<30).length};
}
let _poll=null;
function poll(){clearTimeout(_poll);_poll=setTimeout(async()=>{await refresh();if(STATUS&&STATUS.job&&STATUS.job.running)poll();else{DATA=null;await refresh(true);}},2500);}
async function refresh(withData){
  try{STATUS=await api('/study/status',{timeout:15000});STATUS_ERR=null;}
  catch(e){STATUS=null;STATUS_ERR=e.name==='AbortError'?'timed out':e.message;}
  let reloaded=false;
  if(STATUS&&(withData||!DATA)&&STATUS.instances&&!LOADING){
    LOADING=true;
    try{DATA=buildModel(await api('/study/winners',{timeout:120000}));DATA_ERR=null;reloaded=true;CANDLE_CACHE.clear();}
    catch(e){DATA_ERR='Could not load winners: '+e.message;}
    finally{LOADING=false;}
  }
  if(!isActive()) return;
  // While a long collection runs, only the status box is refreshed - the view being explored stays put.
  const box=$('styStatus');
  if(!reloaded&&DATA&&box&&!box.contains(document.activeElement)){const t=document.createElement('div');t.innerHTML=statusPanel();box.replaceWith(t.firstElementChild);}
  else if(reloaded||!DATA||!box) render();
}
const isActive=()=>{const t=$('tab4');return !!(t&&t.classList.contains('act'));};

// Overview: the year as a days × rank grid, coloured by any field, plus collection status.
function viewOverview(root){
  const opts=NUM_FIELDS.filter(f=>!['date','rank','dow'].includes(f.k)).map(f=>`<option value="${f.k}"${prefs.heat===f.k?' selected':''}>${esc(f.l)}</option>`).join('');
  root.innerHTML=shell(statusPanel()+`<div class="sty-card"><div class="sty-row"><b>Year at a glance</b> <span class="sty-dim">columns = sessions, rows = EOD rank 1→30. Hover for values, click a cell to open the stock, click the date strip to open the day.</span>
    <span style="margin-left:auto">colour by <select id="styHeat">${opts}</select> <label class="sty-dim"><input type="checkbox" id="styHeatQ" ${prefs.heatQ!==false?'checked':''}> quantile colours</label></span></div>
    <div id="styHeatHost" class="sty-heat"></div><div id="styHeatLegend" class="sty-dim" style="font-size:12px"></div></div>
    <div class="sty-card"><b>Daily ranges</b> <span class="sty-dim">every instance's gain % by date (click a point)</span><div id="styStrip"></div></div>`);
  wireStatus();
  heatmap($('styHeatHost'),field(prefs.heat),prefs.heatQ!==false);
  $('styHeat').onchange=e=>{prefs.heat=e.target.value;savePrefs();render();};
  $('styHeatQ').onchange=e=>{prefs.heatQ=e.target.checked;savePrefs();render();};
  scatter($('styStrip'),DATA.rows,field('date'),field('gain'),field('rank'),{height:280});
}
// sequential colour ramp (viridis stops) - perceptually even on the dark background
const RAMP=['#5b3f9e','#4a5bb0','#31688e','#26828e','#1f9e89','#35b779','#6ece58','#b5de2b','#fde725'];
function rampAt(t){t=Math.max(0,Math.min(1,t));const i=t*(RAMP.length-1),a=Math.floor(i),b=Math.min(RAMP.length-1,a+1),f=i-a;
  const h=s=>[parseInt(s.slice(1,3),16),parseInt(s.slice(3,5),16),parseInt(s.slice(5,7),16)],A=h(RAMP[a]),B=h(RAMP[b]);
  return `rgb(${A.map((x,k)=>Math.round(x+(B[k]-x)*f)).join(',')})`;}
function scaler(vals,quantile){
  const v=vals.filter(isNum).sort((a,b)=>a-b);if(!v.length) return {t:()=>null,lo:0,hi:0,q:[]};
  if(quantile){return {t:x=>{if(!isNum(x))return null;let lo=0,hi=v.length;while(lo<hi){const m=(lo+hi)>>1;if(v[m]<x)lo=m+1;else hi=m;}return v.length>1?lo/(v.length-1):.5;},
    lo:v[0],hi:v[v.length-1],q:[0,.25,.5,.75,1].map(p=>v[Math.round(p*(v.length-1))])};}
  const lo=v[0],hi=v[v.length-1];return {t:x=>isNum(x)?(hi>lo?(x-lo)/(hi-lo):.5):null,lo,hi,q:[lo,hi]};
}
function heatmap(host,f,quantile){
  const days=DAYS,ranks=30,cell=Math.max(3,Math.min(14,Math.floor(((host.clientWidth||900)-50)/Math.max(1,days.length))));
  const W=50+days.length*cell,Hh=ranks*9+34,dpr=window.devicePixelRatio||1;
  const cv=document.createElement('canvas');cv.width=W*dpr;cv.height=Hh*dpr;cv.style.width=W+'px';cv.style.height=Hh+'px';host.innerHTML='';host.appendChild(cv);
  const tip=document.createElement('div');tip.className='sty-tip';host.appendChild(tip);host.style.position='relative';
  const sc=scaler(DATA.rows.map(f.g),quantile),ctx=cv.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);
  ctx.font="10px 'DM Mono',monospace";ctx.fillStyle=css('--t3');ctx.textAlign='right';ctx.textBaseline='middle';
  for(const r of [1,10,20,30]) ctx.fillText('#'+r,44,20+(r-1)*9+4.5);
  days.forEach((d,i)=>{
    const x=50+i*cell;
    BY_DAY.get(d.date).forEach(o=>{const t=sc.t(f.g(o));ctx.fillStyle=t==null?'rgba(137,148,168,.18)':rampAt(t);ctx.fillRect(x,20+(o.rank-1)*9,Math.max(1,cell-(cell>4?1:0)),8);});
    if(i===0||d.date.slice(5,7)!==days[i-1].date.slice(5,7)){ctx.fillStyle=css('--t3');ctx.textAlign='left';ctx.textBaseline='top';ctx.fillText(d.date.slice(0,7),x,2);ctx.fillRect(x,14,1,4);}
  });
  ctx.fillStyle='rgba(137,148,168,.25)';ctx.fillRect(50,Hh-10,days.length*cell,8);
  const hit=e=>{const b=cv.getBoundingClientRect(),x=e.clientX-b.left,y=e.clientY-b.top,i=Math.floor((x-50)/cell);if(i<0||i>=days.length)return null;
    const d=days[i];if(y>=Hh-12)return {d};const r=Math.floor((y-20)/9)+1;const o=r>=1&&r<=30?BY_DAY.get(d.date).find(z=>z.rank===r):null;return {d,o,x,y};};
  cv.onmousemove=e=>{const h=hit(e);if(!h){tip.style.display='none';return;}
    tip.innerHTML=h.o?`<b>${esc(h.d.date)} ${h.d.dow}</b> #${h.o.rank} <b>${esc(h.o.symbol)}</b><br>Gain ${fPct(h.o.gain)} · ${esc(f.l)} ${fN(f.g(h.o),3)}${h.o.flags.length?'<br><span class="sty-flag">'+esc(h.o.flags.join(', '))+'</span>':''}`
      :`<b>${esc(h.d.date)}</b> · open day view`;
    tip.style.display='block';const b=cv.getBoundingClientRect();tip.style.left=Math.min(e.clientX-b.left+12,W-200)+'px';tip.style.top=(e.clientY-b.top+12)+'px';};
  cv.onmouseleave=()=>tip.style.display='none';
  cv.onclick=e=>{const h=hit(e);if(!h)return;if(h.o)go('inst',{day:h.o.date,inst:h.o.key,candle:null});else go('day',{day:h.d.date});};
  const L=$('styHeatLegend');if(L)L.innerHTML=`<span style="display:inline-block;width:160px;height:8px;vertical-align:middle;background:linear-gradient(90deg,${RAMP.join(',')})"></span> `
    +esc(f.l)+': '+sc.q.map(v=>fN(v,2)).join(' · ')+(quantile?' (min · 25% · median · 75% · max)':' (min · max)')+' · grey = no value';
}
// generic scatter of instances; click a point to open it
function scatter(host,rows,fx,fy,fc,opt={}){
  const W=host.clientWidth||900,Hh=opt.height||360,dpr=window.devicePixelRatio||1,L=56,R=12,T=10,B=26;
  host.innerHTML='';host.style.position='relative';
  const cv=document.createElement('canvas');cv.width=W*dpr;cv.height=Hh*dpr;cv.style.width=W+'px';cv.style.height=Hh+'px';host.appendChild(cv);
  const tip=document.createElement('div');tip.className='sty-tip';host.appendChild(tip);
  const lx=!!opt.logX,ly=!!opt.logY,tx=v=>lx?(v>0?Math.log10(v):NaN):v,ty=v=>ly?(v>0?Math.log10(v):NaN):v;
  const pts=rows.map(r=>({r,x:tx(fx.g(r)),y:ty(fy.g(r)),c:fc?fc.g(r):null})).filter(p=>isNum(p.x)&&isNum(p.y));
  const ctx=cv.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);
  if(!pts.length){ctx.fillStyle=css('--t3');ctx.font="13px 'DM Mono',monospace";ctx.fillText('No points with both values.',L,Hh/2);return;}
  let x0=Math.min(...pts.map(p=>p.x)),x1=Math.max(...pts.map(p=>p.x)),y0=Math.min(...pts.map(p=>p.y)),y1=Math.max(...pts.map(p=>p.y));
  if(x1===x0){x0-=1;x1+=1;} if(y1===y0){y0-=1;y1+=1;}
  const px=x=>L+(x-x0)/(x1-x0)*(W-L-R),py=y=>Hh-B-(y-y0)/(y1-y0)*(Hh-B-T);
  const sc=fc?scaler(pts.map(p=>p.c),true):null;
  ctx.font="10px 'DM Mono',monospace";ctx.strokeStyle='rgba(137,148,168,.12)';ctx.fillStyle=css('--t3');
  const lab=(f,v,log)=>{const raw=log?Math.pow(10,v):v;return f.k==='date'?new Date(raw*864e5).toISOString().slice(0,10):f.k==='dow'?DOW[Math.round(raw)]||'':fN(raw,Math.abs(raw)>=100?0:2);};
  const xt=niceTicks(x0,x1,Math.floor(W/110)),yt=niceTicks(y0,y1,Math.floor(Hh/50));
  ctx.textAlign='center';ctx.textBaseline='top';for(const v of xt.ticks){const x=px(v);ctx.beginPath();ctx.moveTo(x,T);ctx.lineTo(x,Hh-B);ctx.stroke();ctx.fillText(lab(fx,v,lx),x,Hh-B+5);}
  ctx.textAlign='right';ctx.textBaseline='middle';for(const v of yt.ticks){const y=py(v);ctx.beginPath();ctx.moveTo(L,y);ctx.lineTo(W-R,y);ctx.stroke();ctx.fillText(lab(fy,v,ly),L-5,y);}
  ctx.globalAlpha=pts.length>3000?.5:.75;
  for(const p of pts){ctx.fillStyle=sc?(rampAt(sc.t(p.c))||'#888'):'#3b82f6';ctx.beginPath();ctx.arc(px(p.x),py(p.y),2.2,0,7);ctx.fill();}
  ctx.globalAlpha=1;
  const near=e=>{const b=cv.getBoundingClientRect(),mx=e.clientX-b.left,my=e.clientY-b.top;let best=null,bd=64;
    for(const p of pts){const d=(px(p.x)-mx)**2+(py(p.y)-my)**2;if(d<bd){bd=d;best=p;}}return best?{p:best,mx,my}:null;};
  cv.onmousemove=e=>{const h=near(e);if(!h){tip.style.display='none';cv.style.cursor='';return;}cv.style.cursor='pointer';const r=h.p.r;
    tip.innerHTML=`<b>${esc(r.date)}</b> #${r.rank} <b>${esc(r.symbol)}</b> ${fPct(r.gain)}<br>${esc(fx.l)}: ${lab(fx,h.p.x,lx)}<br>${esc(fy.l)}: ${lab(fy,h.p.y,ly)}${fc?'<br>'+esc(fc.l)+': '+fN(h.p.c,3):''}`;
    tip.style.display='block';tip.style.left=Math.min(h.mx+12,W-220)+'px';tip.style.top=(h.my+12)+'px';};
  cv.onmouseleave=()=>tip.style.display='none';
  cv.onclick=e=>{const h=near(e);if(h)go('inst',{day:h.p.r.date,inst:h.p.r.key,candle:null});};
}
function histogram(host,rows,f,bins,opt={}){
  const W=host.clientWidth||900,Hh=opt.height||240,dpr=window.devicePixelRatio||1,L=56,R=12,T=10,B=26;
  host.innerHTML='';host.style.position='relative';
  const cv=document.createElement('canvas');cv.width=W*dpr;cv.height=Hh*dpr;cv.style.width=W+'px';cv.style.height=Hh+'px';host.appendChild(cv);
  const tip=document.createElement('div');tip.className='sty-tip';host.appendChild(tip);
  const v=rows.map(f.g).filter(isNum);const ctx=cv.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);
  if(!v.length) return;
  let lo=Math.min(...v),hi=Math.max(...v);if(hi===lo){lo-=.5;hi+=.5;}
  const w=(hi-lo)/bins,c=new Array(bins).fill(0);for(const x of v)c[Math.min(bins-1,Math.floor((x-lo)/w))]++;
  const mx=Math.max(...c),ly=!!opt.logY,yv=n=>ly?Math.log10(n+1):n,ym=yv(mx);
  const bw=(W-L-R)/bins;ctx.font="10px 'DM Mono',monospace";ctx.fillStyle=css('--t3');
  ctx.textAlign='right';ctx.textBaseline='middle';ctx.fillText(String(mx),L-5,T+4);ctx.fillText('0',L-5,Hh-B);
  ctx.textAlign='center';ctx.textBaseline='top';const xt=niceTicks(lo,hi,Math.floor(W/110));
  for(const t of xt.ticks)ctx.fillText(f.k==='date'?new Date(t*864e5).toISOString().slice(0,10):fN(t,Math.abs(t)>=100?0:2),L+(t-lo)/(hi-lo)*(W-L-R),Hh-B+5);
  c.forEach((n,i)=>{const h=yv(n)/ym*(Hh-B-T);ctx.fillStyle='#3b82f6';ctx.fillRect(L+i*bw+.5,Hh-B-h,Math.max(1,bw-1),h);});
  const at=e=>{const b=cv.getBoundingClientRect(),x=e.clientX-b.left;const i=Math.floor((x-L)/bw);return i>=0&&i<bins?{i,x,y:e.clientY-b.top}:null;};
  const lab=x=>f.k==='date'?new Date(x*864e5).toISOString().slice(0,10):fN(x,4);
  cv.onmousemove=e=>{const h=at(e);if(!h){tip.style.display='none';return;}tip.innerHTML=`${esc(f.l)} ${lab(lo+h.i*w)} … ${lab(lo+(h.i+1)*w)}<br><b>${c[h.i]}</b> instances · click to filter`;
    tip.style.display='block';tip.style.left=Math.min(h.x+12,W-220)+'px';tip.style.top=(h.y+12)+'px';};
  cv.onmouseleave=()=>tip.style.display='none';
  cv.onclick=e=>{const h=at(e);if(h&&opt.onBin)opt.onBin(lo+h.i*w,lo+(h.i+1)*w);};
}

function viewDays(root){
  root.innerHTML=shell(`<div class="sty-card"><div id="styDaysT"></div></div>`);wireStatus();
  TABLES.days=new Table($('styDaysT'),{rows:DAYS,page:60,csv:'study-days',state:prefs.daysT||{sort:'date',dir:-1},
    cols:[{k:'date',label:'Date'},{k:'dow',label:'Day'},{k:'n',label:'Winners',num:true},{k:'universe',label:'Universe',num:true},
      {k:'max',label:'#1 gain %',num:true,fmt:tGain},{k:'median',label:'Median gain %',num:true,fmt:tGain},{k:'min',label:'#30 gain %',num:true,fmt:tGain},
      {k:'complete',label:'All 3 sessions',num:true},{k:'flagged',label:'With data flags',num:true},{k:'tie',label:'Tie at #30',fmt:v=>v?'<span class="sty-flag">yes</span>':''}],
    onRow:r=>go('day',{day:r.date})});
  prefs.daysT=TABLES.days.st;
}
function dayNav(d){
  const i=DAYS.findIndex(x=>x.date===d);
  return `<button class="btn sty-sm" data-go-day="${i>0?DAYS[i-1].date:''}" ${i>0?'':'disabled'}>‹ ${i>0?DAYS[i-1].date:''}</button>`
    +`<input type="date" id="styDayPick" value="${esc(d)}" min="${DAYS[0]?.date||''}" max="${DAYS[DAYS.length-1]?.date||''}">`
    +`<button class="btn sty-sm" data-go-day="${i<DAYS.length-1?DAYS[i+1].date:''}" ${i<DAYS.length-1?'':'disabled'}>${i<DAYS.length-1?DAYS[i+1].date:''} ›</button>`;
}
function wireDayNav(){
  document.querySelectorAll('[data-go-day]').forEach(b=>b.onclick=()=>{if(b.dataset.goDay)go(prefs.view,dayPatch(b.dataset.goDay));});
  const p=$('styDayPick');if(p)p.onchange=()=>{const d=DAYS.find(x=>x.date>=p.value)||DAYS[DAYS.length-1];if(d)go('day',{day:d.date});};
}
const dayPatch=d=>prefs.view==='inst'?(()=>{const cur=BY_KEY.get(prefs.inst),l=BY_DAY.get(d)||[];const same=cur&&l.find(x=>x.rank===cur.rank);return {day:d,inst:(same||l[0]||{}).key,candle:null};})():{day:d};
function viewDay(root){
  const d=prefs.day&&BY_DAY.has(prefs.day)?prefs.day:(DAYS[DAYS.length-1]||{}).date;prefs.day=d;
  if(!d){root.innerHTML=shell('<div class="sty-card">No winners yet.</div>');wireStatus();return;}
  const info=DAYS.find(x=>x.date===d),list=BY_DAY.get(d);
  root.innerHTML=shell(`<div class="sty-card"><div class="sty-row">${dayNav(d)}<b style="margin-left:8px">${esc(d)} ${info.dow}</b>
    <span class="sty-dim">universe ${fInt(info.universe)} · #1 ${fPct(info.max)} · #30 ${fPct(info.min)} · all 3 sessions for ${info.complete}/${info.n}</span>
    <span style="margin-left:auto"><label class="sty-dim">grid scale <select id="styGridMode"><option value="price">own price axis</option><option value="pct"${prefs.gridMode==='pct'?' selected':''}>% vs NSE prev close</option></select></label></span></div>
    <div class="sty-grid" id="styGrid">${list.map(o=>`<div class="sty-mini" data-key="${esc(o.key)}"><div class="sty-mini-h"><span>#${o.rank} <b>${esc(o.symbol)}</b></span>${tGain(o.gain)}</div><div class="sty-mini-c" data-mini="${esc(o.key)}"></div>${o.flags.length?`<div class="sty-mini-f" title="${esc(o.flags.join('\n'))}">⚑ ${esc(o.flags[0])}${o.flags.length>1?' +'+(o.flags.length-1):''}</div>`:''}</div>`).join('')}</div></div>
    <div class="sty-card"><div id="styDayT"></div></div>`);
  wireStatus();wireDayNav();
  $('styGridMode').onchange=e=>{prefs.gridMode=e.target.value;savePrefs();render();};
  $('styGrid').onclick=e=>{const m=e.target.closest('.sty-mini');if(m)go('inst',{inst:m.dataset.key,candle:null});};
  TABLES.day=new Table($('styDayT'),{rows:list,page:30,csv:'study-'+d,cols:INST_COLS.filter(c=>c.k!=='date'),state:prefs.dayT||{sort:'rank',dir:1},onRow:r=>go('inst',{inst:r.key,candle:null})});
  prefs.dayT=TABLES.day.st;
  // minis load as they scroll into view; each instance is fetched once and cached
  const io=new IntersectionObserver(ents=>ents.forEach(en=>{if(!en.isIntersecting)return;io.unobserve(en.target);const o=BY_KEY.get(en.target.dataset.mini);
    candlesFor(o).then(c=>{if(!en.target.isConnected)return;const ch=new Chart(en.target,{type:'overlay',mini:true,height:96});CHARTS.push(ch);
      ch.setSeries([{label:o.symbol,sessions:c.sessions,base:prefs.gridMode==='pct'?o.prevClose:null,color:'#3b82f6'}]);})
      .catch(err=>{en.target.innerHTML=`<span class="sty-flag">${esc(err.message)}</span>`;});}),{rootMargin:'200px'});
  document.querySelectorAll('[data-mini]').forEach(el=>io.observe(el));
  CHARTS.push({destroy:()=>io.disconnect()});
}

function navInst(dir){
  const cur=BY_KEY.get(prefs.inst);if(!cur) return;
  let next=null;
  if(dir==='prev'||dir==='next'){const l=BY_DAY.get(cur.date),i=l.indexOf(cur);next=l[i+(dir==='next'?1:-1)];}
  else if(dir==='pday'||dir==='nday'){const i=DAYS.findIndex(x=>x.date===cur.date),d=DAYS[i+(dir==='nday'?1:-1)];if(d){const l=BY_DAY.get(d.date);next=l.find(x=>x.rank===cur.rank)||l[0];}}
  else if(dir==='psym'||dir==='nsym'){const l=DATA.rows.filter(x=>x.symbol===cur.symbol);next=l[l.indexOf(cur)+(dir==='nsym'?1:-1)];}
  if(next) go('inst',{day:next.date,inst:next.key,candle:null});
}
function viewInst(root){
  let o=BY_KEY.get(prefs.inst);
  if(!o){const l=BY_DAY.get(prefs.day)||BY_DAY.get((DAYS[DAYS.length-1]||{}).date)||[];o=l[0];}
  if(!o){root.innerHTML=shell('<div class="sty-card">No instance selected.</div>');wireStatus();return;}
  prefs.inst=o.key;prefs.day=o.date;
  const others=DATA.rows.filter(x=>x.symbol===o.symbol),oi=others.indexOf(o),list=BY_DAY.get(o.date),li=list.indexOf(o);
  const pinned=prefs.compare.includes(o.key);
  root.innerHTML=shell(`<div class="sty-card">
    <div class="sty-row">${dayNav(o.date)}
      <button class="btn sty-sm" data-act="nav" data-dir="prev" ${li>0?'':'disabled'} title="previous rank (←)">‹ #${li>0?list[li-1].rank:''}</button>
      <b style="font-size:18px">#${o.rank} ${esc(o.symbol)}</b>${o.series!=='EQ'?` <span class="pill-gray info-pill">${esc(o.series)}</span>`:''}
      ${tGain(o.gain)} <span class="sty-dim">${esc(o.date)} ${dow(o.date)}</span>
      <button class="btn sty-sm" data-act="nav" data-dir="next" ${li<list.length-1?'':'disabled'} title="next rank (→)">#${li<list.length-1?list[li+1].rank:''} ›</button>
      <span class="sty-dim">symbol win ${oi+1}/${others.length}</span>
      <button class="btn sty-sm" data-act="nav" data-dir="psym" ${oi>0?'':'disabled'}>‹ its previous win</button>
      <button class="btn sty-sm" data-act="nav" data-dir="nsym" ${oi<others.length-1?'':'disabled'}>its next win ›</button>
      <button class="btn sty-sm${pinned?' btn-fire':''}" data-act="pin" data-key="${esc(o.key)}">📌 ${pinned?'In compare':'Add to compare'}</button></div>
    <div class="sty-row sty-dim" style="font-size:13px">NSE: prev ${f2(o.prevClose)} · O ${f2(o.open)} H ${f2(o.high)} L ${f2(o.low)} · close ${f2(o.close)} · last ${f2(o.last)} · vol ${fInt(o.qty)} · trades ${fInt(o.trades)} · deliv ${fN(o.delivPer,1)}% · universe ${fInt(o.universe)}
      ${o.flags.length?`<span class="sty-flag" title="${esc(o.flags.join('\n'))}">⚑ ${esc(o.flags.join(' · '))}</span>`:''}</div>
    <div class="sty-row"><span class="sty-dim">zoom</span> <button class="btn sty-sm" data-act="zoom" data-s="all">All 3</button>${[0,1,2].map(i=>`<button class="btn sty-sm" data-act="zoom" data-s="${i}">${SLOT_LABEL[i]} ${esc(o.dates[i]||'—')}</button>`).join('')}
      <label class="sty-dim"><input type="checkbox" id="styLevels" ${prefs.levels?'checked':''}> NSE prev close / close lines on S0</label>
      <span class="sty-dim" style="margin-left:auto;font-size:12px">wheel/pinch zoom · drag pan · double-click reset · click a candle, then ←/→ (shift = 15)</span></div>
    <div id="styMain"><div class="sty-dim" style="padding:40px">Loading candles…</div></div><div id="styChecks" class="sty-dim" style="font-size:12px;margin-top:6px"></div></div>
    <div class="sty-card"><div class="sty-row"><b>Sessions</b></div><div id="stySessT"></div></div>
    <div class="sty-card"><div class="sty-row"><b>Candles</b> <span class="sty-dim">exactly as stored. Gap = minutes since the previous candle in that session (1 = no missing minute).</span></div><div id="styCandT"></div></div>`);
  wireStatus();wireDayNav();
  $('styLevels').onchange=e=>{prefs.levels=e.target.checked;savePrefs();const c=CHARTS[0];if(c){c.opt.showLevels=prefs.levels;c.draw();}};
  candlesFor(o).then(c=>{
    if(prefs.inst!==o.key||!$('styMain')) return;
    const ch=new Chart($('styMain'),{type:'candle',height:Math.max(360,Math.min(560,Math.round(window.innerHeight*0.58))),showLevels:!!prefs.levels,
      onSelect:(j,d)=>{prefs.candle=d.T[j].slice(0,16).replace('T',' ');savePrefs();const cr=document.querySelector('.sty-crumbs');if(cr)cr.innerHTML=crumbs();highlightCandle(d.T[j]);}});
    CHARTS.unshift(ch);
    ch.setSeries([{label:o.symbol,sessions:c.sessions,levels:[{slot:2,v:o.prevClose,label:'NSE prev'},{slot:2,v:o.close,label:'NSE close'}]}]);
    const k=c.checks;
    $('styChecks').innerHTML=`${fInt(k.n)} candles · chronology ${k.chrono?'✓':'✗'} · dates ${k.dateOk?'✓':'✗'} · OHLC ${k.ohlc?'✓':'✗'} · ${fInt(k.gaps)} minutes without a candle inside the sessions (not filled)`;
    sessionTable(o,c);candleTable(o,c,ch);
    if(prefs.candle){const d=ch.series[0].d,j=d.T.findIndex(t=>t.slice(0,16).replace('T',' ')===prefs.candle);if(j>=0)ch.select(j,true);}
    // warm the neighbours so stepping through the day is instant
    [list[li-1],list[li+1]].filter(Boolean).forEach(x=>candlesFor(x).catch(()=>{}));
  }).catch(err=>{if($('styMain'))$('styMain').innerHTML=`<span class="sty-flag">Could not load candles: ${esc(err.message)}</span>`;});
}
function sessionTable(o,c){
  const rows=c.sessions.map((s,i)=>{const cs=s.candles||[],sum=o.s[i]||{};
    return {slot:SLOT_LABEL[i],date:s.date,status:s.status,n:cs.length,first:cs[0]?cs[0][0].slice(11,16):null,last:cs.length?cs[cs.length-1][0].slice(11,16):null,
      o:cs[0]?+cs[0][1]:null,h:cs.length?Math.max(...cs.map(r=>+r[2])):null,l:cs.length?Math.min(...cs.map(r=>+r[3])):null,c:cs.length?+cs[cs.length-1][4]:null,
      v:cs.reduce((a,r)=>a+(+r[5]||0),0),tsym:s.tradingsymbol||'',tok:s.token||''};});
  new Table($('stySessT'),{rows,page:5,cols:[{k:'slot',label:'Slot'},{k:'date',label:'Date',fmt:v=>v?esc(v)+' <span class="sty-dim">'+dow(v)+'</span>':'—'},{k:'status',label:'Status'},
    {k:'n',label:'Candles',num:true},{k:'first',label:'First'},{k:'last',label:'Last'},{k:'o',label:'First open',num:true,fmt:f2},{k:'h',label:'High',num:true,fmt:f2},
    {k:'l',label:'Low',num:true,fmt:f2},{k:'c',label:'Last close',num:true,fmt:f2},{k:'v',label:'Volume',num:true,fmt:fInt},{k:'tsym',label:'Kite symbol'},{k:'tok',label:'Token'}],
    onRow:(r)=>{const i=SLOT_LABEL.indexOf(r.slot);if(CHARTS[0]&&CHARTS[0].zoomSession)CHARTS[0].zoomSession(i);}});
}
function candleTable(o,c,ch){
  const rows=[];
  c.sessions.forEach((s,i)=>(s.candles||[]).forEach((r,j,a)=>rows.push({idx:rows.length,slot:SLOT_LABEL[i],date:s.date,time:String(r[0]).slice(11,16),ts:String(r[0]),
    o:+r[1],h:+r[2],l:+r[3],c:+r[4],v:+r[5]||0,gap:j?minuteOf(r[0])-minuteOf(a[j-1][0]):null,chg:j?+r[4]-(+a[j-1][4]):null})));
  TABLES.cand=new Table($('styCandT'),{rows,page:200,csv:'candles-'+o.symbol+'-'+o.date,
    cols:[{k:'slot',label:'Slot'},{k:'date',label:'Date'},{k:'time',label:'Time'},{k:'o',label:'Open',num:true},{k:'h',label:'High',num:true},{k:'l',label:'Low',num:true},
      {k:'c',label:'Close',num:true},{k:'v',label:'Volume',num:true,fmt:fInt},{k:'chg',label:'Close − prev close',num:true,fmt:v=>fN(v,2)},
      {k:'gap',label:'Gap (min)',num:true,fmt:v=>v==null?'—':v>1?`<span class="sty-flag">${v}</span>`:String(v)},{k:'ts',label:'Timestamp (raw)'}],
    rowAttr:r=>` data-ts="${esc(r.ts)}"`,onRow:r=>{ch.select(r.idx,true);}});
}
function highlightCandle(ts){
  const t=TABLES.cand;if(!t) return;
  const i=t.view.findIndex(r=>r.ts===ts);if(i<0) return;
  const pg=Math.floor(i/t.o.page);if(pg!==t.st.page){t.st.page=pg;t.renderBody();}
  t.host.querySelectorAll('tr.sty-hl').forEach(x=>x.classList.remove('sty-hl'));
  const tr=t.host.querySelector(`tr[data-ts="${CSS.escape(ts)}"]`);if(tr){tr.classList.add('sty-hl');
    // scroll only the table's own box - never the page away from the chart being explored
    const box=t.host.querySelector('.sty-tw'),head=box.querySelector('thead').offsetHeight;
    const top=tr.offsetTop-head,bot=tr.offsetTop+tr.offsetHeight;
    if(top<box.scrollTop) box.scrollTop=top; else if(bot>box.scrollTop+box.clientHeight) box.scrollTop=bot-box.clientHeight;}
}
function togglePin(key){
  const i=prefs.compare.indexOf(key);if(i>=0)prefs.compare.splice(i,1);else prefs.compare.push(key);savePrefs();render();
}
function viewCompare(root){
  const pins=prefs.compare.map(k=>BY_KEY.get(k)).filter(Boolean);
  const mode=prefs.cmpMode||'stack',norm=prefs.cmpNorm||'first';
  root.innerHTML=shell(`<div class="sty-card"><div class="sty-row"><b>Compare</b> <span class="sty-dim">${pins.length} pinned - pin from a stock's page; any dates mix freely</span>
    <span style="margin-left:auto"><select id="styCmpMode"><option value="stack">stacked candles, own axes</option><option value="overlay"${mode==='overlay'?' selected':''}>overlay lines</option></select>
    ${mode==='overlay'?`<select id="styCmpNorm"><option value="first">% from first candle shown</option><option value="prev"${norm==='prev'?' selected':''}>% from NSE prev close of win day</option><option value="raw"${norm==='raw'?' selected':''}>raw price</option></select>`:''}
    <label class="sty-dim"><input type="checkbox" id="styLink" ${prefs.cmpLink!==false?'checked':''}> link zoom</label>
    <button class="btn sty-sm" data-act="clearpins">Clear</button></span></div>
    <div class="sty-row">${pins.map((o,i)=>`<span class="info-pill pill-gray" style="border-color:${SERIES_COLORS[i%SERIES_COLORS.length]}"><a data-open="${esc(o.key)}">${esc(o.date)} #${o.rank} ${esc(o.symbol)}</a> <a data-act="pin" data-key="${esc(o.key)}" title="remove">✕</a></span>`).join(' ')||'<span class="sty-dim">Nothing pinned yet.</span>'}</div>
    <div id="styCmp"></div></div>`);
  wireStatus();
  $('styCmpMode').onchange=e=>{prefs.cmpMode=e.target.value;savePrefs();render();};
  if($('styCmpNorm'))$('styCmpNorm').onchange=e=>{prefs.cmpNorm=e.target.value;savePrefs();render();};
  $('styLink').onchange=e=>{prefs.cmpLink=e.target.checked;savePrefs();};
  document.querySelector('[data-act="clearpins"]').onclick=e=>{e.stopPropagation();prefs.compare=[];savePrefs();render();};
  document.querySelectorAll('[data-open]').forEach(a=>a.onclick=()=>{const o=BY_KEY.get(a.dataset.open);go('inst',{day:o.date,inst:o.key,candle:null});});
  if(!pins.length) return;
  const host=$('styCmp');host.innerHTML='<div class="sty-dim" style="padding:20px">Loading…</div>';
  Promise.all(pins.map(o=>candlesFor(o))).then(all=>{
    if(!host.isConnected) return;host.innerHTML='';
    const link=(x0,x1,src)=>{if(prefs.cmpLink===false)return;CHARTS.forEach(c=>{if(c!==src&&c.setView)c.setView(x0,x1,true);});};
    if(mode==='overlay'){
      const el=document.createElement('div');host.appendChild(el);
      const ch=new Chart(el,{type:'overlay',height:Math.max(380,Math.round(window.innerHeight*0.6))});CHARTS.push(ch);
      ch.setSeries(pins.map((o,i)=>{const s=all[i].sessions,firstC=s.flatMap(x=>x.candles||[])[0];
        return {label:o.date+' '+o.symbol,sessions:s,base:norm==='raw'?null:norm==='prev'?o.prevClose:(firstC?+firstC[4]:null)};}));
      if(norm==='first'){ // re-base on the first candle in view whenever the view moves
        const rebase=()=>{ch.series.forEach(s=>{const d=s.d;let j=d.X.findIndex(x=>x>=ch.x0);if(j<0)j=0;s.base=d.C[j]||s.base;});};
        const orig=ch.draw.bind(ch);ch.draw=()=>{rebase();orig();};ch.draw();
      }
    }else{
      pins.forEach((o,i)=>{const wrap=document.createElement('div');wrap.className='sty-cmpitem';
        wrap.innerHTML=`<div class="sty-row" style="margin:6px 0 2px"><span style="color:${SERIES_COLORS[i%SERIES_COLORS.length]}">■</span> <b>${esc(o.symbol)}</b> <span class="sty-dim">${esc(o.date)} #${o.rank}</span> ${tGain(o.gain)}</div><div></div>`;
        host.appendChild(wrap);
        const ch=new Chart(wrap.lastChild,{type:'candle',height:pins.length>3?260:340,onView:link});CHARTS.push(ch);
        ch.setSeries([{label:o.symbol,sessions:all[i].sessions}]);});
    }
  }).catch(err=>{host.innerHTML=`<span class="sty-flag">${esc(err.message)}</span>`;});
}
function viewExplore(root){
  const e=prefs.explore,sel=(id,v,extra='')=>`<select id="${id}">${extra}${NUM_FIELDS.map(f=>`<option value="${f.k}"${v===f.k?' selected':''}>${esc(f.l)}</option>`).join('')}</select>`;
  root.innerHTML=shell(`<div class="sty-card"><div class="sty-row"><b>Scatter</b> X ${sel('styX',e.x)} <label class="sty-dim"><input type="checkbox" id="styLX" ${e.lx?'checked':''}> log</label>
      Y ${sel('styY',e.y)} <label class="sty-dim"><input type="checkbox" id="styLY" ${e.ly?'checked':''}> log</label> colour ${sel('styC',e.c,'<option value="">none</option>')}
      <span class="sty-dim">plots the rows the table below lets through</span></div><div id="styScat"></div></div>
    <div class="sty-card"><div class="sty-row"><b>Histogram</b> ${sel('styH',e.hist)} bins <select id="styB">${[10,20,40,80,160].map(b=>`<option${+e.bins===b?' selected':''}>${b}</option>`).join('')}</select>
      <label class="sty-dim"><input type="checkbox" id="styHL" ${e.hl?'checked':''}> log count</label> <span class="sty-dim">click a bar to filter the table to it</span></div><div id="styHist"></div></div>
    <div class="sty-card"><div class="sty-row"><b>All instances</b> <span class="sty-dim">filters: numbers <code>&gt;5</code> <code>3..7</code> <code>!=0</code>, text <code>abc</code> <code>=ABC</code> <code>!abc</code></span></div><div id="styAllT"></div></div>`);
  wireStatus();
  let cur=DATA.rows;
  const draw=()=>{scatter($('styScat'),cur,field(e.x),field(e.y),e.c?field(e.c):null,{height:380,logX:e.lx,logY:e.ly});
    histogram($('styHist'),cur,field(e.hist),+e.bins,{logY:e.hl,onBin:(a,b)=>{const k=e.hist;if(k==='date'||k==='dow'||!INST_COLS.find(c=>c.k===k)){return;}
      TABLES.all.st.filters[k]=a.toFixed(6)+'..'+b.toFixed(6);const inp=document.querySelector(`#styAllT input[data-f="${k}"]`);if(inp)inp.value=TABLES.all.st.filters[k];TABLES.all.renderBody();}});};
  const bind=(id,k,cb)=>{$(id).onchange=ev=>{e[k]=ev.target.type==='checkbox'?ev.target.checked:ev.target.value;savePrefs();draw();};};
  bind('styX','x');bind('styY','y');bind('styC','c');bind('styLX','lx');bind('styLY','ly');bind('styH','hist');bind('styB','bins');bind('styHL','hl');
  TABLES.all=new Table($('styAllT'),{rows:DATA.rows,page:100,csv:'study-instances',state:prefs.allT||{sort:'date',dir:-1},
    cols:INST_COLS.concat([{k:'flagText',label:'Flag text',get:FLAG_TEXT}]),onRow:r=>go('inst',{day:r.date,inst:r.key,candle:null}),
    onFilter:rows=>{cur=rows;clearTimeout(viewExplore._t);viewExplore._t=setTimeout(draw,60);}});
  prefs.allT=TABLES.all.st;
}
function viewSymbols(root){
  root.innerHTML=shell(`<div class="sty-card"><div class="sty-row"><b>Symbols</b> <span class="sty-dim">every symbol that reached the top 30, with each date it did. Click to see its instances.</span></div><div id="stySymT"></div></div>`);
  wireStatus();
  TABLES.sym=new Table($('stySymT'),{rows:SYMBOLS,page:100,csv:'study-symbols',state:prefs.symT||{sort:'wins',dir:-1},
    cols:[{k:'symbol',label:'Symbol',fmt:v=>'<b>'+esc(v)+'</b>'},{k:'series',label:'Series'},{k:'wins',label:'Wins',num:true},{k:'maxGain',label:'Best gain %',num:true,fmt:tGain},
      {k:'first',label:'First'},{k:'last',label:'Last'},{k:'dates',label:'Dates',cls:'sty-wrap'}],
    onRow:r=>{prefs.allT={sort:'date',dir:1,filters:{symbol:'='+r.symbol},page:0};go('explore');}});
  prefs.symT=TABLES.sym.st;
}

// keyboard: ←/→ previous/next rank, shift+←/→ previous/next day (on a stock's page)
document.addEventListener('keydown',e=>{
  if(!isActive()||prefs.view!=='inst'||!DATA) return;
  if(e.target&&(/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)||e.target.tagName==='CANVAS')) return;
  if(e.key==='ArrowRight'||e.key==='ArrowLeft'){e.preventDefault();navInst(e.shiftKey?(e.key==='ArrowRight'?'nday':'pday'):(e.key==='ArrowRight'?'next':'prev'));}
});

function injectStyles(){
  if($('studyStyles')) return;
  const s=document.createElement('style');s.id='studyStyles';
  s.textContent=`.sty{padding:6px 0 30px}.sty-head{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:flex-end;margin-bottom:6px}
.sty-sub{margin:8px 0 6px!important}.sty-sub .tab{padding:7px 14px;font-size:14px}
.sty-crumbs{font-size:13px;margin:6px 0 10px;color:var(--t2)}.sty-crumbs a,.sty a[data-open],.sty a[data-act]{color:var(--blue);cursor:pointer}
.sty-card{background:var(--bg-card);border:1px solid var(--border);border-radius:10px;padding:12px 14px;margin:10px 0;overflow:hidden}
.sty-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:4px 0}
.sty input,.sty select{background:var(--bg-raised);border:1px solid var(--border);border-radius:6px;color:var(--t1);padding:5px 8px;font-size:13px;font-family:'DM Mono',monospace}
.sty-sm{padding:5px 10px!important;font-size:13px!important}.sty-dim{color:var(--t3)}.sty-flag{color:var(--amber);font-size:12px}
.sty-help{font-size:14px;color:var(--t2);line-height:1.6;margin-top:8px}.sty-help pre,.sty-log{background:var(--bg-raised);padding:8px 10px;border-radius:6px;font-family:'DM Mono',monospace;font-size:12px;overflow:auto;max-height:240px;color:var(--t2)}
.sty-bar{flex:1;min-width:120px;height:6px;background:var(--bg-raised);border-radius:3px;overflow:hidden}.sty-bar>div{height:100%;background:var(--fire)}
.sty-chart{position:relative;width:100%}.sty-chart canvas{display:block;outline:none;touch-action:none;cursor:crosshair}
.sty-tip{position:absolute;display:none;pointer-events:none;z-index:5;background:rgba(12,16,24,.96);border:1px solid var(--border-hi);border-radius:6px;padding:6px 9px;font:12px/1.5 'DM Mono',monospace;color:var(--t1);white-space:nowrap}
.sty-heat{overflow-x:auto;margin:8px 0 4px}.sty-heat canvas{cursor:pointer}
.sty-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:8px;margin-top:10px}
.sty-mini{background:var(--bg-raised);border:1px solid var(--border);border-radius:8px;padding:6px 8px;cursor:pointer}.sty-mini:hover{border-color:var(--blue)}
.sty-mini-h{display:flex;justify-content:space-between;font-size:13px;font-family:'DM Mono',monospace}.sty-mini-c{height:96px}.sty-mini-c canvas{cursor:pointer}
.sty-mini-f{font-size:11px;color:var(--amber);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sty-tbar{display:flex;gap:10px;align-items:center;margin-bottom:6px;font-size:13px;color:var(--t2)}.sty-tbar .sty-pager{margin-left:auto}
.sty-tw{overflow:auto;max-height:640px}.sty-t thead tr:first-child th{position:sticky;top:0;z-index:2}.sty-t thead tr.sty-f th{position:sticky;top:35px;z-index:2;background:var(--bg-raised);padding:3px 4px;cursor:default}
.sty-t .sty-f input{width:100%;min-width:56px;padding:3px 5px;font-size:12px}.sty-t tbody tr{cursor:pointer}.sty-t tbody tr.sty-hl{background:rgba(251,191,36,.12)}
.sty-t td.sty-wrap{white-space:normal;max-width:520px;font-size:12px}
@media(max-width:700px){.sty-grid{grid-template-columns:repeat(auto-fill,minmax(150px,1fr))}.sty-head h3{font-size:15px}}`;
  document.head.appendChild(s);
}

window.RocketStudy={
  render:()=>{injectStyles();if(!STATUS&&!STATUS_ERR){const r=$('studyContent');if(r)r.innerHTML='<div class="sty-dim" style="padding:30px">Connecting to the study server…</div>';refresh(true);}else render();},
  _test:{layoutSessions,parseFilter,checkSessions,buildModel,niceTicks,scaler}
};
})();
