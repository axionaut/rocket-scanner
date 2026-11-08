// strategy.js — Clean 3-Tier Strategy Engine for Rocket Scanner
// Tier 1: Universe Selection ("Which")
// Tier 2: Real-time Order Book Trigger ("When")
// Tier 3: Hard Exit Governor ("Exit & Protection")

(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.RocketStrategy = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Shared by browser, helper and Python candle readers. JSON block is read verbatim by nse_calendar.py.
  /* NSE_SESSION_RULES_BEGIN */
  const NSE_SESSION_RULES = {"version":"nse-session-2026-11-08","special":{"2026-11-08":{"name":"Diwali Muhurat","preopen":845,"open":860,"close":930,"casClose":915,"postClose":960,"casSymbols":["360ONE","ABB","ABCAPITAL","ADANIENSOL","ADANIENT","ADANIGREEN","ADANIPORTS","ADANIPOWER","ALKEM","AMBER","AMBUJACEM","ANANDRATHI","ANGELONE","APLAPOLLO","APOLLOHOSP","ASHOKLEY","ASIANPAINT","ASTRAL","ATHERENERG","AUBANK","AUROPHARMA","AXISBANK","BAJAJ-AUTO","BAJAJFINSV","BAJFINANCE","BANDHANBNK","BANKBARODA","BANKINDIA","BDL","BEL","BHARATFORG","BHARTIARTL","BHEL","BIOCON","BLUESTARCO","BOSCHLTD","BPCL","BRITANNIA","BSE","CAMS","CANBK","CDSL","CGPOWER","CHOLAFIN","CIPLA","COALINDIA","COCHINSHIP","COFORGE","COLPAL","CONCOR","COROMANDEL","CROMPTON","CUB","CUMMINSIND","DABUR","DATAPATTNS","DELHIVERY","DIVISLAB","DIXON","DLF","DMART","DRREDDY","EICHERMOT","ENRIN","ETERNAL","FEDERALBNK","FORCEMOT","FORTIS","GAIL","GLENMARK","GMRAIRPORT","GODFRYPHLP","GODREJCP","GODREJPROP","GRASIM","GVT&D","HAL","HAVELLS","HCLTECH","HDFCAMC","HDFCBANK","HDFCLIFE","HEROMOTOCO","HINDALCO","HINDPETRO","HINDUNILVR","HINDZINC","HYUNDAI","ICICIBANK","ICICIGI","ICICILIFE","IDEA","IDFCFIRSTB","IEX","INDHOTEL","INDIANB","INDIGO","INDUSINDBK","INDUSTOWER","INFY","INOXWIND","IOC","IREDA","IRFC","ITC","JINDALSTEL","JIOFIN","JSWENERGY","JSWSTEEL","JUBLFOOD","KALYANKJIL","KARURVYSYA","KAYNES","KEI","KFINTECH","KOTAKBANK","KPITTECH","LAURUSLABS","LICHSGFIN","LICI","LODHA","LT","LTF","LTM","LUPIN","M&M","MAHABANK","MANAPPURAM","MANKIND","MARICO","MARUTI","MAXHEALTH","MAZDOCK","MCX","MFSL","MOTHERSON","MOTILALOFS","MPHASIS","MUTHOOTFIN","NAM-INDIA","NATIONALUM","NAUKRI","NAVINFLUOR","NBCC","NESTLEIND","NHPC","NIFTYFPI","NMDC","NTPC","NYKAA","OBEROIRLTY","OFSS","OIL","ONGC","PAGEIND","PATANJALI","PAYTM","PERSISTENT","PETRONET","PFC","PGEL","PHOENIXLTD","PIDILITIND","PIIND","PNB","PNBHOUSING","POLICYBZR","POLYCAB","POWERGRID","POWERINDIA","PREMIERENE","PRESTIGE","RADICO","RBLBANK","RECLTD","RELIANCE","RVNL","SAGILITY","SAIL","SBICARD","SBILIFE","SBIN","SHREECEM","SHRIRAMFIN","SIEMENS","SOLARINDS","SONACOMS","SRF","SUNPHARMA","SUPREMEIND","SUZLON","SWIGGY","SYRMA","TATACONSUM","TATAELXSI","TATAPOWER","TATASTEEL","TCS","TECHM","TIINDIA","TITAN","TMPV","TORNTPHARM","TRENT","TVSMOTOR","UJJIVANSFB","ULTRACEMCO","UNIONBANK","UNITDSPR","UNOMINDA","UPL","VBL","VEDL","VMM","VOLTAS","WAAREEENER","WIPRO","YESBANK","ZYDUSLIFE"],"source":"https://nsearchives.nseindia.com/content/circulars/CMTR76941.pdf","classificationSource":"https://nsearchives.nseindia.com/content/fo/fo_mktlots.csv","classificationAsOf":"2026-11-08","classificationSha256":"a52889218e2ca1a9acd233b986f613833ef239127fab72548663d8eefacd8ceb"}}};
  /* NSE_SESSION_RULES_END */
  function nseSession(day, holidays=null, symbol=null){
    const date=new Date(String(day)+'T12:00:00Z');
    if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==day)return null;
    const special=NSE_SESSION_RULES.special[day];
    if(special){
      const sym=String(symbol||'').toUpperCase().replace(/^NSE:/,'').replace(/-EQ$/,'');
      return {...special,date:day,special:true,close:symbol&&special.casSymbols.includes(sym)?special.casClose:special.close};
    }
    const weekday=date.getUTCDay();
    if(weekday===0||weekday===6||(holidays?.has?holidays.has(day):Array.isArray(holidays)&&holidays.includes(day)))return null;
    return {date:day,name:'Regular',preopen:540,open:555,close:930,postClose:960,special:false};
  }
  function nseClock(at=Date.now()){
    const d=new Date(Number(at)+19800000);
    return {day:d.toISOString().slice(0,10),minute:d.getUTCHours()*60+d.getUTCMinutes()};
  }
  function nseContinuous(at=Date.now(),symbol=null,holidays=null){
    if(!Number.isFinite(Number(at)))return false;
    const c=nseClock(at),s=nseSession(c.day,holidays,symbol);
    return !!s&&c.minute>=s.open&&c.minute<s.close;
  }

  const CONFIG = {
    // Tier 1: Universe Filters
    MIN_PRICE: 5.0,               // mirrors dev/btst_engine.py LIQ; not read by the app's decision path
    MAX_PRICE: 4000.0,
    MIN_TURNOVER: 50000000,      // ₹5 Crore minimum traded value
    MIN_AVG_VOLUME: 100000,      // 1 Lakh shares 10-day average
    MIN_RVOL: 1.5,               // 1.5x time-of-day expected volume

    // Tier 2: Entry Triggers
    MAX_HIGH_DISTANCE_PCT: 1.2,  // Within 1.2% of Day High
    MIN_CIRCUIT_HEADROOM_PCT: 3.0, // At least 3.0% below Upper Circuit

    // Common bracket start on weighted average cost; the helper ratchets a broker OCO.
    // Profit-funded loss trims are budgeted separately, with no unconditional loss sale.
    TARGET_PCT: 1.25,
    STOP_LOSS_PCT: 0,            // no stop-loss
    TOP_K: 5,                    // positions per day (equal weight)
    MIN_ALLOCATION_RS: 0,        // set below from charges: minOrderRs(false)
    // Profit Lock / Ratchet Trailing Exit
    PROFIT_LOCK_ACTIVATION_PCT: 0,   // v1455: early lock OFF (0). Replay on 65 live signals: every +1-2% lock lost to the target alone; only the runner (arm at target, 1% trail) beat it
    PROFIT_LOCK_FLOOR_PCT: 0.3,      // Legacy protected floor once armed (LIMIT fills are not guaranteed) (+0.3% break-even)
    PROFIT_LOCK_STEP2_PCT: 1.5,      // When peak reaches +1.5%, step floor up to +1.0%
    PROFIT_LOCK_TRAIL_DROP_PCT: 0.5  // Exit if price drops 0.5% from peak (min 10 paise)
  };

  // v1622 (owner 4 Nov 2026): Size from dynamic MLoT breakeven turnover & share count.
  // The minimum profit booked is the dynamic MLoT trail distance (max(0.26%, p50 - p25)).
  // Required turnover is the exact volume at which this dynamic profit covers round-trip charges + the Rs 15.34 DP fee.
  // The minimum order for any stock is the whole shares reaching that turnover. Hardcoded Rs 5,900 removed.
  function dynamicTrailGapPct(mlot) {
    const p25 = Number.isFinite(mlot?.p25) ? mlot.p25 : 0.35;
    const p50 = Number.isFinite(mlot?.p50) ? mlot.p50 : 1.09;
    return Math.max(0.26, +((p50 - p25) || 0).toFixed(2));
  }

  function breakevenTurnover(held = false, mlot = null) {
    if (held) return 0;
    const gapPct = dynamicTrailGapPct(mlot);
    const v = 1e6;
    const buyParts = calcZerodhaChargesSplit(v, 1, false, false, true);
    const sellParts = calcZerodhaChargesSplit(v * (1 + gapPct / 100), 1, true, false, true);
    const propPct = (sumChargeParts(buyParts) + sumChargeParts(sellParts)) / v;
    const margin = (gapPct / 100) - propPct;
    const dp = calcZerodhaChargesSplit(1, 1, true, false, false).dp || 15.34;
    return margin > 0.0001 ? Math.ceil(dp / margin) : Math.ceil(dp / 0.0026);
  }

  function minSharesForStock(price, held = false, mlot = null) {
    if (!(price > 0) || !Number.isFinite(price)) return 0;
    if (held) return 1;
    const t = breakevenTurnover(false, mlot);
    return Math.max(1, Math.ceil(t / price));
  }

  function minOrderRs(held = false, mlot = null) {
    return breakevenTurnover(held, mlot);
  }
  CONFIG.MIN_ALLOCATION_RS = minOrderRs(false);

  // Whole shares must fit the allocation INCLUDING buy charges.
  function quantityWithinBudget(budget, price, unitDebit) {
    if (!(budget > 0) || !Number.isFinite(budget) || !(price > 0) || !Number.isFinite(price)) return 0;
    const unit = unitDebit ?? price + sumChargeParts(calcZerodhaChargesSplit(price, 1, false, false, false));
    if (!(unit >= price) || !Number.isFinite(unit)) return 0;
    let qty = Math.floor(budget / unit + 1e-10);
    while (qty > 0 && qty * unit > budget + 1e-7) qty--;
    return qty;
  }

  // USD fee estimate, checked 5 Nov 2026 against IBKR and FINRA schedules.
  // Tiered includes a conservative 0.0035/share venue reserve, not an exact route fee.
  function ibkrOrderFee(qty,price,plan='fixed',sell=false,day='2026-11-05'){
    if(!(qty>0&&price>0))return 0;
    const commission=Math.min(Math.max(plan==='tiered'?.35:1,qty*(plan==='tiered'?.0035:.005)),qty*price*.01);
    const taf=sell&&(day<'2026-10-01'||day>'2026-12-31')?Math.min(9.79,qty*.000195):0;
    const regulatory=qty*.000003+(sell?qty*price*.0000206+taf:0);
    const routing=plan==='tiered'?qty*(.0035+.0002)+commission*(.000175+.00056):0;
    return Math.ceil((commission+regulatory+routing)*100-1e-9)/100;
  }

  function minimumAllocationRs(price, requested, held = false, unitDebit = null, mlot = null) {
    if (!(price > 0) || !Number.isFinite(price)) return Infinity;
    if (held) return price;
    const minShares = minSharesForStock(price, false, mlot);
    const economic = minShares * price;
    const reqShares = quantityWithinBudget(requested, price, unitDebit);
    return Math.max(economic, reqShares * price);
  }

  // One allocation decision for the live basket, account replay and StratGen.
  // Callers provide contemporaneous eligibility/quotes, never a different sizing model.
  function planAccountEntries(candidates, account) {
    const maxStocks=account.maxStocks??20;
    if(!Number.isInteger(maxStocks)||maxStocks<1||maxStocks>20)throw Error('Stocks per allocation must be an integer from 1 to 20');
    const cash=Number(account.cash);
    if(!Number.isFinite(cash)||cash<0)throw Error('Recorded available cash is required');
    const capital=Number(account.capital)>0?Math.min(cash,Number(account.capital)):cash;
    const spendable=Math.max(0,capital-1),alloc={},reasons={},selected=[];
    const pool=[...candidates].sort((a,b)=>(b.score||0)-(a.score||0)||
      ((a.triggerAt??Infinity)-(b.triggerAt??Infinity))||(b.rvol||0)-(a.rvol||0)||(b.barRs||0)-(a.barRs||0)||a.symbol.localeCompare(b.symbol));
    const fees=account.orderCharges||((qty,price)=>sumChargeParts(calcZerodhaChargesSplit(price,qty,false,false,false)));
    const quantity=(budget,r)=>{
      if(!account.orderCharges)return quantityWithinBudget(budget,r.price,r.unit);
      let lo=0,hi=Math.floor(budget/r.price);
      while(lo<hi){const n=Math.ceil((lo+hi)/2);if(n*r.price+fees(n,r.price)<=budget+1e-7)lo=n;else hi=n-1;}
      return lo;
    };
    let reserved=0;
    for(const r of pool){
      let reason=r.reason||null;
      if(!reason&&!(r.price>0&&Number.isFinite(r.price)))reason='No valid buy price';
      if(!reason&&!(r.score>0&&Number.isFinite(r.score)))reason='A positive executable strategy score is required';
      if(!reason&&!(r.liquidityCap>0))reason='No turnover or order-book depth to enforce the market-impact cap';
      const unit=r.unitDebit??r.price+sumChargeParts(calcZerodhaChargesSplit(r.price,1,false,false,false));
      const minimum=account.minimumShares?account.minimumShares(r.price,!!r.held,account.mlot):minSharesForStock(r.price,!!r.held,account.mlot),floor=account.orderCharges?minimum*r.price+fees(minimum,r.price):minimum*unit;
      const ceiling=Math.min(spendable,r.liquidityCap,Number(account.maxAlloc)>0?Number(account.maxAlloc):Infinity);
      if(!reason&&floor>ceiling+1e-7)reason='Liquidity or allocation cap cannot cover the whole-share cost breakeven minimum';
      if(!reason&&selected.length>=maxStocks)reason='Stocks per allocation limit reached; higher scores funded first';
      if(!reason&&reserved+floor>spendable+1e-7)reason='Cash cannot cover every minimum order; higher scores funded first';
      if(reason){reasons[r.symbol]=reason;continue;}
      selected.push({...r,unit,minimum,floor,ceiling});reserved+=floor;
    }
    // Weighted water filling: preserve minimum viable orders, cap market impact,
    // and redistribute capacity released by a binding cap to the other names.
    const target=Math.min(spendable,selected.reduce((n,r)=>n+r.ceiling,0));
    let lo=0,hi=selected.reduce((n,r)=>Math.max(n,r.ceiling/r.score),0);
    for(let i=0;i<60;i++){const mid=(lo+hi)/2,total=selected.reduce((n,r)=>n+Math.max(r.floor,Math.min(r.ceiling,mid*r.score)),0);if(total>target)hi=mid;else lo=mid;}
    let remaining=spendable;
    for(const r of selected){
      const budget=Math.max(r.floor,Math.min(r.ceiling,lo*r.score)),qty=Math.max(r.minimum,quantity(budget,r));
      const cost=qty*r.price,charges=fees(qty,r.price),debit=cost+charges;
      if(debit>remaining+1e-7||debit>r.ceiling+1e-7)throw Error('Score allocation exceeded its funded capacity');
      alloc[r.symbol]={qty,capital:cost,charges,debit,budget,minimum:r.minimum*r.price,score:r.score,weight:r.score/selected.reduce((n,x)=>n+x.score,0)};remaining-=debit;
    }
    // Largest remainders; no cash overrun or fractional shares.
    const rounding=[...selected].sort((a,b)=>((alloc[b.symbol].budget/ b.unit)%1)-((alloc[a.symbol].budget/a.unit)%1)||b.score-a.score);
    for(const r of rounding){const x=alloc[r.symbol],extra=account.orderCharges?r.price+fees(x.qty+1,r.price)-x.charges:r.unit;if(extra>remaining+1e-7||x.debit+extra>r.ceiling+1e-7)continue;x.qty++;x.capital=x.qty*r.price;x.charges=fees(x.qty,r.price);const debit=x.capital+x.charges;remaining-=debit-x.debit;x.debit=debit;}
    return {alloc,reasons,funded:selected.map(r=>r.symbol),remaining,minimum:breakevenTurnover(false,account.mlot),mode:'score-proportional'};
  }

  function authorizeAccountEntry(request, live, minimum) {
    const budget=Math.min(live.cash,Number.isFinite(live.allocationCap)?live.allocationCap:Infinity);
    const qty=Math.min(request.qty,quantityWithinBudget(budget,request.cap,request.cap*1.003));
    if(!(qty>0))throw Error('Entry no longer fits available cash');
    if(minimum>0&&qty*request.cap<minimum)throw Error(`Cash left fits only ${qty} share(s) (Rs ${Math.round(qty*request.cap)}), below the Rs ${Math.round(minimum)} minimum`);
    return qty;
  }

  /**
   * Tier 1: Filter raw universe down to liquid, clean momentum candidates
   * @param {Array} stocks - List of stock objects from Kite universe
   * @param {Set} heldSymbols - Set of uppercase symbols currently open
   * @returns {Array} Filtered candidates
   */
  // Missing measurements cannot establish eligibility. The thresholds are policy,
  // not a validated forecast of profit (see CLAUDE.md evidence limits).
  function inputs(stock = {}) {
    const n=(...values)=>{for(const v of values){if(v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v)))return Number(v);}return null;};
    const price=n(stock.price,stock.ltp,stock.c);
    const volume=n(stock.dayVolume,stock.volume,stock.v,stock.vol);
    return {price,volume,turnover:n(stock.turnover,price>0&&volume>=0?price*volume:null),
      avgVol10:n(stock.avgVol10,stock.av10),rvol:n(stock.relAt,stock.relVolAtTime,stock.relvol,stock.rvol,stock.relVol),
      open:n(stock.open1d,stock.open,stock.dayOpen,stock.o),vwap:n(stock.vwap,stock.vwap5),
      high:n(stock.high1d,stock.high,stock.dayHigh,stock.h),upperCircuit:n(stock.upperCircuit,stock.uc)};
  }
  function evaluateUniverse(stock, heldSymbols = new Set()) {
    const reject=reason=>({eligible:false,reason});
    if(!stock?.symbol)return reject('Invalid stock');
    // Invariant 2 (owner 5 Oct 2026): Re-crossings can add to held positions when below average cost.
    if(heldSymbols.has(String(stock.symbol).trim().toUpperCase()))return reject('Already held (re-crossing requires price below average cost)');
    const x=inputs(stock);
    if(!(x.price>=CONFIG.MIN_PRICE&&x.price<=CONFIG.MAX_PRICE))return reject('Price outside Rs 5 to Rs 4,000 range');
    if(!(x.turnover>=CONFIG.MIN_TURNOVER||x.avgVol10>=CONFIG.MIN_AVG_VOLUME))return reject('Liquidity below Rs 5 Cr turnover / 100,000 average shares, or unavailable');
    if(!(x.rvol>=CONFIG.MIN_RVOL))return reject('RVOL below 1.5x or unavailable');
    if(!(x.open>0&&x.price>x.open))return reject('Price must be above day open (valid open required)');
    if(!(x.vwap>0&&x.price>x.vwap))return reject('Price must be above VWAP (valid VWAP required)');
    return {eligible:true,reason:'Liquid momentum candidate'};
  }
  function filterUniverse(stocks, heldSymbols = new Set()) {
    return Array.isArray(stocks)?stocks.filter(s=>evaluateUniverse(s,heldSymbols).eligible):[];
  }

  /**
   * Tier 2: Real-time Entry Trigger on candidate stock
   * @param {Object} stock - Candidate stock data
   * @param {Object} book - Live order-book data { bids, asks, bidQty, askQty }
   * @returns {Object} Trigger evaluation
   */
    // Universal metric resolver for ANY strategy generated by StratGen
  function resolveStockMetric(stock, x, key) {
    if (!key) return null;
    const k = String(key).trim().toLowerCase();
    switch (k) {
      case 'close': case 'ltp': case 'price': return x.price;
      case 'open': case 'dayopen': return x.open || x.price;
      case 'high': case 'dayhigh': return x.high || x.price;
      case 'low': case 'daylow': return stock.low ?? stock.dayLow ?? x.price;
      case 'volume': case 'dayvolume': return x.volume;
      case 'turnover': return x.turnover;
      case 'rvol': case 'relvol': return x.rvol ?? stock.rvol ?? stock.relAt ?? 1.0;
      case 'vwap': return x.vwap || x.price;
      case 'rsi': return stock.rsi !== undefined ? Number(stock.rsi) : (stock.rsi14 !== undefined ? Number(stock.rsi14) : null);
      case 'macd': return stock.macd !== undefined ? Number(stock.macd) : null;
      case 'macd_sig': case 'macd_signal': return stock.macd_sig !== undefined ? Number(stock.macd_sig) : (stock.macdSig !== undefined ? Number(stock.macdSig) : null);
      case 'macd_hist': return stock.macd_hist !== undefined ? Number(stock.macd_hist) : (stock.macdHist !== undefined ? Number(stock.macdHist) : null);
      case 'stoch_k': return stock.stoch_k !== undefined ? Number(stock.stoch_k) : (stock.stochK !== undefined ? Number(stock.stochK) : null);
      case 'stoch_d': return stock.stoch_d !== undefined ? Number(stock.stoch_d) : (stock.stochD !== undefined ? Number(stock.stochD) : null);
      case 'ema9': return stock.ema9 !== undefined ? Number(stock.ema9) : null;
      case 'ema20': return stock.ema20 !== undefined ? Number(stock.ema20) : null;
      case 'ema50': return stock.ema50 !== undefined ? Number(stock.ema50) : null;
      case 'ema200': return stock.ema200 !== undefined ? Number(stock.ema200) : null;
      case 'ema50_1d': return stock.ema50_1d !== undefined ? Number(stock.ema50_1d) : (stock.ema50 !== undefined ? Number(stock.ema50) : null);
      case 'ema200_1d': return stock.ema200_1d !== undefined ? Number(stock.ema200_1d) : (stock.ema200 !== undefined ? Number(stock.ema200) : null);
      case 'aroon_up_1d': return stock.aroon_up_1d !== undefined ? Number(stock.aroon_up_1d) : (stock.aroonUp !== undefined ? Number(stock.aroonUp) : null);
      case 'pivot_p': return stock.pivot_p !== undefined ? Number(stock.pivot_p) : (stock.pp !== undefined ? Number(stock.pp) : null);
      case 'pivot_r1': return stock.pivot_r1 !== undefined ? Number(stock.pivot_r1) : (stock.r1 !== undefined ? Number(stock.r1) : null);
      case 'pivot_r2': return stock.pivot_r2 !== undefined ? Number(stock.pivot_r2) : (stock.r2 !== undefined ? Number(stock.r2) : null);
      case 'pivot_s1': return stock.pivot_s1 !== undefined ? Number(stock.pivot_s1) : (stock.s1 !== undefined ? Number(stock.s1) : null);
      case 'keltner_lower': return stock.keltner_lower !== undefined ? Number(stock.keltner_lower) : null;
      case 'keltner_upper': return stock.keltner_upper !== undefined ? Number(stock.keltner_upper) : null;
      case 'donchian_lower': return stock.donchian_lower !== undefined ? Number(stock.donchian_lower) : null;
      case 'donchian_upper': return stock.donchian_upper !== undefined ? Number(stock.donchian_upper) : null;
      case 'bb_lower': return stock.bb_lower !== undefined ? Number(stock.bb_lower) : null;
      case 'bb_upper': return stock.bb_upper !== undefined ? Number(stock.bb_upper) : null;
      default:
        if (k.startsWith('pattern_')) {
          const pat = k.replace('pattern_', '').replace(/_/g, ' ');
          if (stock[k] !== undefined) return stock[k] ? 1 : 0;
          if (stock.pattern) return String(stock.pattern).toLowerCase().includes(pat) ? 1 : 0;
          if (Array.isArray(stock.patterns)) return stock.patterns.some(p => String(p).toLowerCase().includes(pat)) ? 1 : 0;
          return 0;
        }
        if (stock[key] !== undefined && Number.isFinite(Number(stock[key]))) return Number(stock[key]);
        return null;
    }
  }

  function evaluateCondition(lVal, op, rVal) {
    if (lVal === null || lVal === undefined || rVal === null || rVal === undefined) return false;
    if (isNaN(lVal) || isNaN(rVal)) return false;
    switch (op) {
      case '>': return lVal > rVal;
      case '<': return lVal < rVal;
      case '>=': return lVal >= rVal;
      case '<=': return lVal <= rVal;
      case '==': return lVal == rVal;
      case '!=': return lVal != rVal;
      default: return false;
    }
  }

  function evaluateTrigger(stock, book = null) {
    const x=inputs(stock),ltp=x.price,dayHigh=x.high,upperCircuit=x.upperCircuit;
    if(!(ltp>0))return {canBuy:false,reason:'Invalid price'};

    // Dynamic StratGen Strategy Execution (Universal Binary Pass/Fail for ANY strategy)
    const dep = CONFIG.ACTIVE_STRATGEN_DEPLOYED;
    if(dep && (dep.live_capability_version !== 'rs-stratgen-live-1' || !(dep.program_schema==='rs-strategy-program-1'&&dep.program_validation?.contract_hash===dep.sha256)&&dep.test_evidence?.live_parity !== true)){
      return {canBuy:false,reason:'Strategy program has not been compiled by the shared engine'};
    }
    if(dep?.live_capability_version==='rs-stratgen-live-1'){
      const signal=stock.stratgenSignal;
      if(!signal||signal.contractHash!==dep.sha256||!Number.isFinite(signal.computedAt)||signal.computedAt>Date.now()+1000||Date.now()-signal.computedAt>signalTtlMs(dep))return {canBuy:false,reason:'Awaiting fresh shared-engine contract evaluation'};
      if(!signal.eligible)return {canBuy:false,reason:signal.reason||'Shared strategy conditions are not satisfied'};
      return {canBuy:true,symbol:stock.symbol,limitPrice:ltp,targetPrice:null,stopPrice:null,targetPct:0,stopLossPct:0,reason:'Tested entry contract satisfied; shared RS trailing exit; no minimum holding period; no maximum'};
    }
    if(dep && dep.spec && Array.isArray(dep.spec.entry_rules) && dep.spec.entry_rules.length > 0){
      const universe=evaluateUniverse(stock);
      if(!universe.eligible)return {canBuy:false,reason:universe.reason};
      const rules = dep.spec.entry_rules;
      for(const rule of rules){
        const ind = (rule.indicator || '').toLowerCase();
        const op = rule.op || '>';
        const lVal = resolveStockMetric(stock, x, ind);

        let rVal = null;
        if(rule.value !== undefined && rule.value !== null){
          rVal = Number(rule.value);
        } else if(rule.ref){
          rVal = resolveStockMetric(stock, x, rule.ref.toLowerCase());
        }

        if(!evaluateCondition(lVal, op, rVal)){
          const lStr = lVal !== null ? (Number.isFinite(lVal) ? lVal.toFixed(2) : lVal) : 'N/A';
          const rStr = rVal !== null ? (Number.isFinite(rVal) ? rVal.toFixed(2) : rVal) : (rule.ref || 'target');
          return {
            canBuy: false,
            reason: `Pending rule: ${rule.indicator} (${lStr}) ${op} ${rule.ref || rule.value} (${rStr})`
          };
        }
      }

      const targetPrice = +(ltp * (1 + CONFIG.TARGET_PCT / 100)).toFixed(2);
      const stopPrice = CONFIG.STOP_LOSS_PCT > 0 ? +(ltp * (1 - CONFIG.STOP_LOSS_PCT / 100)).toFixed(2) : null;
      return {
        canBuy: true,
        symbol: stock.symbol,
        limitPrice: ltp,
        targetPrice,
        stopPrice,
        targetPct: CONFIG.TARGET_PCT,
        stopLossPct: CONFIG.STOP_LOSS_PCT,
        reason: `All strategy rules satisfied (${dep.name || 'StratGen Alpha'})`
      };
    }

    if(!(dayHigh>0)||dayHigh<ltp)return {canBuy:false,reason:'Missing or inconsistent day high'};
    const distToHighPct=(dayHigh-ltp)/ltp*100;
    if(distToHighPct>CONFIG.MAX_HIGH_DISTANCE_PCT)return {canBuy:false,reason:`${distToHighPct.toFixed(2)}% from day high (max 1.2%)`};
    if(!(upperCircuit>0))return {canBuy:false,reason:'Upper circuit unavailable'};
    const circuitRoomPct=(upperCircuit-ltp)/ltp*100;
    if(circuitRoomPct<CONFIG.MIN_CIRCUIT_HEADROOM_PCT)return {canBuy:false,reason:`Only ${circuitRoomPct.toFixed(2)}% circuit headroom (min 3%)`};

    const targetPrice = +(ltp * (1 + CONFIG.TARGET_PCT / 100)).toFixed(2);
    const stopPrice = CONFIG.STOP_LOSS_PCT > 0 ? +(ltp * (1 - CONFIG.STOP_LOSS_PCT / 100)).toFixed(2) : null;

    return {
      canBuy: true,
      symbol: stock.symbol,
      limitPrice: ltp,
      targetPrice,
      stopPrice,
      targetPct: CONFIG.TARGET_PCT,
      stopLossPct: CONFIG.STOP_LOSS_PCT,
      reason: 'Near-high and circuit headroom conditions met'
    };
  }

  /**
   * Tier 3: Hard Exit Governor for Open Positions
   * Evaluates active position and signals immediate liquidation if rule is triggered
   * @param {Object} position - Position data { symbol, avgCost, qty, daysHeld }
   * @param {number} liveLtp - Current live market price
   * @returns {Object} Exit verdict
   */
  function evaluateExit(position, liveLtp, nowMinIST) {
    if (!position || !(position.avgCost > 0)) {
      return { shouldExit: false, action: 'HOLD', reason: 'Invalid position cost' };
    }

    const avgCost = Number(position.avgCost);
    const ltp = Number(liveLtp ?? position.ltp);
    if(!(ltp>0))return {shouldExit:false,action:'WAIT',reason:'Live price unavailable'};
    const pnlPct = +(((ltp - avgCost) / avgCost) * 100).toFixed(2);

    const targetPct = Number(position.targetPct) > 0 ? Number(position.targetPct) : CONFIG.TARGET_PCT;
    const hasTarget = Number(position.targetPrice) > 0;
    const targetPrice = hasTarget ? Number(position.targetPrice) : avgCost * (1 + targetPct / 100);
    if(position.bracket) {
      const lower=Number(position.bracketLower)||0,sell=(hasTarget&&ltp>=targetPrice)||(lower>0&&ltp<=lower);
      return {shouldExit:sell,action:sell?'SELL':'HOLD',exitType:sell?'BRACKET':'BRACKET_ACTIVE',pnlPct,
        lockStopPrice:lower||null,reason:sell?'Broker bracket trigger reached; awaiting limit fill.':lower>0?`Trailing stop ${lower.toFixed(2)}`:hasTarget?`Bracket upper ${targetPrice.toFixed(2)}`:'Awaiting breakeven arming'};
    }
    // v1451: a runner's target GTT was cancelled by the helper, which now trails it; the helper's
    // stop replaces both the target and the local lock computation.
    const runnerStop = Number(position.runnerStopPrice);
    if (runnerStop > 0) {
      const stopPct = +(((runnerStop - avgCost) / avgCost) * 100).toFixed(2);
      const sell = ltp <= runnerStop;
      return {
        shouldExit: sell, action: sell ? 'SELL' : 'HOLD', exitType: sell ? 'PROFIT_LOCK' : 'RUNNER',
        pnlPct, runner: true, lockArmed: true, lockStopPrice: runnerStop, lockStopPct: stopPct,
        peakPnlPct: Number.isFinite(Number(position.peakPnlPct)) ? Number(position.peakPnlPct) : null,
        reason: sell
          ? `Runner stop hit: +${pnlPct}% (stop ${stopPct >= 0 ? '+' : ''}${stopPct}%)`
          : `Runner past target: helper trails the peak, stop ${stopPct >= 0 ? '+' : ''}${stopPct}% (P&L ${pnlPct > 0 ? '+' : ''}${pnlPct}%)`
      };
    }
    // v1462: the helper's swing stop below the target (the target GTT stays live above it).
    const swingStop = Number(position.swingStopPrice);
    if (swingStop > 0 && ltp < targetPrice - 1e-8) {
      const stopPct = +(((swingStop - avgCost) / avgCost) * 100).toFixed(2);
      const sell = ltp <= swingStop;
      return {
        shouldExit: sell, action: sell ? 'SELL' : 'HOLD', exitType: sell ? 'PROFIT_LOCK' : 'PROFIT_LOCK_ARMED',
        pnlPct, lockArmed: true, lockStopPrice: swingStop, lockStopPct: stopPct,
        peakPnlPct: Number.isFinite(Number(position.peakPnlPct)) ? Number(position.peakPnlPct) : null,
        reason: sell
          ? `Swing stop hit: +${pnlPct}% (stop +${stopPct}%)`
          : `Profit protected: swing stop +${stopPct}%, target +${targetPct}% (P&L ${pnlPct > 0 ? '+' : ''}${pnlPct}%)`
      };
    }
    // Use the target attached to this executed BTST entry; legacy positions retain +3%.
    if (ltp >= targetPrice - 1e-8) {
      return {
        shouldExit: true,
        action: 'SELL',
        exitType: 'TARGET',
        pnlPct,
        reason: `Target hit: +${pnlPct}% (>= +${targetPct}%)`
      };
    }

    // Rule 1.5: Profit Lock / Ratchet Trailing Exit
    // If trade touched +1.0% or more, lock +0.3% break-even floor (+1.0% floor once peak >= +1.5%) and trail 0.5% (min 10p)
    const peakPnlPct = Number(position.peakPnlPct ?? position.highPnlPct);
    const actPct = Number(CONFIG.PROFIT_LOCK_ACTIVATION_PCT) || 0;
    const floorPct = (Number.isFinite(peakPnlPct) && peakPnlPct >= (CONFIG.PROFIT_LOCK_STEP2_PCT || 1.5))
      ? 1.0
      : (CONFIG.PROFIT_LOCK_FLOOR_PCT || 0.3);
    const dropPct = CONFIG.PROFIT_LOCK_TRAIL_DROP_PCT || 0.5;
    const isLockArmed = actPct > 0 && Number.isFinite(peakPnlPct) && peakPnlPct >= actPct;
    const peakPrice = isLockArmed && avgCost > 0 ? avgCost * (1 + peakPnlPct / 100) : null;
    const trailDropAmount = peakPrice != null ? Math.max(peakPrice * (dropPct / 100), 0.10) : 0;
    const trailStopPrice = peakPrice != null ? +(peakPrice - trailDropAmount).toFixed(2) : null;
    const floorPrice = isLockArmed && avgCost > 0 ? +(avgCost * (1 + floorPct / 100)).toFixed(2) : null;
    const lockStopPrice = isLockArmed ? Math.max(floorPrice, trailStopPrice) : null;
    const effectiveStopPct = lockStopPrice != null && avgCost > 0 ? +(((lockStopPrice - avgCost) / avgCost) * 100).toFixed(2) : null;

    if (isLockArmed && pnlPct <= effectiveStopPct) {
      return {
        shouldExit: true,
        action: 'SELL',
        exitType: 'PROFIT_LOCK',
        pnlPct,
        peakPnlPct,
        effectiveStopPct,
        lockStopPrice,
        reason: `Profit lock triggered: dropped to +${pnlPct}% from +${peakPnlPct}% peak (trail stop was +${effectiveStopPct}%)`
      };
    }

    // Rule 2: Hard Stop-Loss Hit (only when a stop is configured)
    if (CONFIG.STOP_LOSS_PCT > 0 && pnlPct <= -CONFIG.STOP_LOSS_PCT) {
      return {
        shouldExit: true,
        action: 'SELL',
        exitType: 'STOP_LOSS',
        pnlPct,
        reason: `Stop-loss hit: ${pnlPct}% (<= -${CONFIG.STOP_LOSS_PCT}%)`
      };
    }

    // Otherwise maintain position
    return {
      shouldExit: false,
      action: 'HOLD',
      exitType: isLockArmed ? 'PROFIT_LOCK_ARMED' : 'ACTIVE',
      pnlPct,
      peakPnlPct: isLockArmed ? peakPnlPct : null,
      lockStopPct: effectiveStopPct,
      lockStopPrice,
      lockArmed: isLockArmed,
      reason: isLockArmed
        ? `Profit lock active: peak +${peakPnlPct}%, stop ratcheted to +${effectiveStopPct}% (P&L ${pnlPct > 0 ? '+' : ''}${pnlPct}%)`
        : `Target +${targetPct}% with adaptive profit protection (P&L ${pnlPct > 0 ? '+' : ''}${pnlPct}%)`
    };
  }

  /**
   * Composite scoring function (0 to 100) based on 3-Tier criteria
   * @param {Object} stock - Stock data
   * @param {Object} book - Live order-book data
   * @returns {number} Score from 0 to 100
   */
  function scoreStock(stock, book = null) {
    if (!stock) return 0;
    const ltp = Number(stock.ltp || stock.price || stock.c || 0);
    const dayHigh = Number(stock.high1d || stock.high || stock.dayHigh || stock.h || 0);
    const dayOpen = Number(stock.open1d || stock.open || stock.dayOpen || stock.o || 0);
    const volume = Number(stock.dayVolume || stock.volume || stock.v || stock.vol || 0);
    const turnover = Number(stock.turnover || (ltp * volume) || 0);
    const avgVol10 = Number(stock.avgVol10 || stock.av10 || 0);

    // Basic price filter
    if (ltp < CONFIG.MIN_PRICE || ltp > CONFIG.MAX_PRICE) return 0;

    // Liquidity base
    let score = 50;
    if (turnover >= CONFIG.MIN_TURNOVER || avgVol10 >= CONFIG.MIN_AVG_VOLUME) {
      score += 10;
    }

    // Trend alignment (above open)
    if (dayOpen > 0 && ltp > dayOpen) {
      score += 10;
    } else if (dayOpen > 0 && ltp < dayOpen) {
      return 25; // below open: penalized
    }

    // High proximity (up to +20 points, only if within 1.2%)
    if (dayHigh > 0) {
      const distToHighPct = ((dayHigh - ltp) / ltp) * 100;
      if (distToHighPct <= CONFIG.MAX_HIGH_DISTANCE_PCT) {
        const proxScore = Math.max(0, Math.round(20 * (1 - (distToHighPct / CONFIG.MAX_HIGH_DISTANCE_PCT))));
        score += proxScore;
      }
    }

    // Order book depth (up to +10 points)
    if (book) {
      const buyQty = Number(book.buyQty || book.totalBidQty || 0);
      const sellQty = Number(book.sellQty || book.totalAskQty || 0);
      if (buyQty > 0 && sellQty > 0) {
        if (buyQty > sellQty) {
          const depthRatio = buyQty / (buyQty + sellQty);
          score += Math.round(depthRatio * 10);
        }
      }
    }

    return Math.min(100, Math.max(0, score));
  }

function calcZerodhaChargesSplit(price, qty, isSell, isIntraday, skipDp){
  const posVal=price*Math.abs(qty);
  const brokerage=isIntraday?Math.min(0.0003*posVal,20):0;
  const stt=isIntraday?(isSell?0.00025*posVal:0):0.001*posVal;
  const txn=0.0000307*posVal;
  const sebi=0.000001*posVal;
  const gst=0.18*(brokerage+sebi+txn);
  const stamp=isSell?0:(isIntraday?0.00003:0.00015)*posVal;
  const dp=(isSell&&!isIntraday&&!skipDp)?15.34:0;
  return {brokerage,stt,txn,sebi,gst,stamp,dp};
}
function sumChargeParts(parts){
  return Object.values(parts).reduce((sum,v)=>sum+(v||0),0);
}
// Shared realised P&L: the page and profit-funded exits use this exact calculation.
function bookedSession(session,holdingCosts,tradebook){
  const getHoldingAvgCost=sym=>holdingCosts[sym]??null;
  const enrichExitPnlRow=row=>row;
  const TRADEBOOK_STATS=tradebook;
  if(!session) return null;
  const bySym={};
  session.orders.forEach(o=>{
    if(!bySym[o.symbol]) bySym[o.symbol]={buys:[],sells:[]};
    if(o.type==='BUY') bySym[o.symbol].buys.push(o);
    else if(o.type==='SELL') bySym[o.symbol].sells.push(o);
  });

  const rows=[];
  const dpCharged=new Set();
  Object.entries(bySym).forEach(([sym,{buys,sells}])=>{
    if(!sells.length) return;
    const totalSellQty=sells.reduce((s,o)=>s+o.qty,0);
    // v1119: the time of the LAST sell for this symbol, so the panel can say how long after the
    // exit the day high arrived. orders.csv carries fill times to the second (v1096).
    const _sellTime=sells.map(o=>String(o.time||'')).filter(Boolean).sort().pop()||null;
    const avgSell=sells.reduce((s,o)=>s+o.price*o.qty,0)/totalSellQty;
    const holdingAvg=getHoldingAvgCost(sym);
    const totalBuyQty=buys.reduce((s,o)=>s+o.qty,0);
    // v1438: Chronological same-day matching.  Zerodha settles intraday only when
    // buy shares are available at the time of the sell.  A sell-then-rebuy of carried
    // stock (e.g. GTT fires at 10:10, re-buy at 14:30) is a delivery sell + a new
    // position, not an intraday round-trip.  Walk buys and sells by time: a sell
    // share counts as same-day only when a preceding same-day buy share exists.
    // 25 Sep: each leg also keeps its OWN sell proceeds and buy lots. Using the symbol's average
    // sell for every leg priced SHANTIGOLD's 09:26 carried sell (293.97) and its later same-day
    // sells (314.32, 323.65) all at 310.23: the total survived, the legs and their charges did not.
    let sameDayQty=0,deliveryQty=0,sameCost=0,sameProceeds=0,deliveryProceeds=0;
    const sortedSells=sells.slice().sort((a,b)=>String(a.time).localeCompare(String(b.time)));
    const lots=buys.slice().sort((a,b)=>String(a.time).localeCompare(String(b.time))).map(b=>({t:String(b.time||''),q:Number(b.qty),p:Number(b.price),v:0}));
    let li=0;
    const avail=[],sameOrderValues=[];
    for(const s of sortedSells){
      const sTime=String(s.time||'');
      while(li<lots.length&&lots[li].t<=sTime) avail.push(lots[li++]);
      let need=Number(s.qty),sellMatched=0;
      while(need>0&&avail.length){
        const lot=avail[0],use=Math.min(need,lot.q);
        sameDayQty+=use;sameCost+=use*lot.p;sameProceeds+=use*Number(s.price);
        lot.v+=use*lot.p;sellMatched+=use*Number(s.price);
        lot.q-=use;need-=use;
        if(lot.q<=0) avail.shift();
      }
      deliveryQty+=need;deliveryProceeds+=need*Number(s.price);
      if(sellMatched>0) sameOrderValues.push(sellMatched);
    }
    lots.forEach(l=>{if(l.v>0) sameOrderValues.push(l.v);});
    // Zerodha caps intraday brokerage at Rs 20 PER ORDER; charging the leg as one order halved it
    // for SHANTIGOLD's four ~Rs 1 lakh same-day orders (Rs 40 instead of Rs 80, plus GST).
    const sameDayBrokerage=sameOrderValues.reduce((t,v)=>t+Math.min(0.0003*v,20),0);
    const todayAvg=sameDayQty>0?sameCost/sameDayQty:null;
    const sameSellAvg=sameDayQty>0?sameProceeds/sameDayQty:null;
    const deliverySellAvg=deliveryQty>0?deliveryProceeds/deliveryQty:null;
    const components=[];
    const addKnownComponent=(qty,avgBuy,isSameDay)=>{
      const avgSell=isSameDay?sameSellAvg:deliverySellAvg;
      if(!(qty>0)||!(avgBuy>0)) return;
      const skipDp=isSameDay||dpCharged.has(sym);
      if(!isSameDay) dpCharged.add(sym);
      const bcS=calcZerodhaChargesSplit(avgBuy,qty,false,isSameDay,false);
      const scS=calcZerodhaChargesSplit(avgSell,qty,true,isSameDay,skipDp);
      if(isSameDay){
        const shift=sameDayBrokerage-(bcS.brokerage+scS.brokerage);
        scS.brokerage+=shift;scS.gst+=0.18*shift;
      }
      const parts={
        _brok:+(bcS.brokerage+scS.brokerage).toFixed(2),
        _stt:+(bcS.stt+scS.stt).toFixed(2),
        _txn:+(bcS.txn+scS.txn).toFixed(2),
        _sebi:+(bcS.sebi+scS.sebi).toFixed(2),
        _gst:+(bcS.gst+scS.gst).toFixed(2),
        _stamp:+(bcS.stamp+scS.stamp).toFixed(2),
        _dp:+(bcS.dp+scS.dp).toFixed(2)
      };
      const charges=+sumChargeParts(parts).toFixed(2);
      const capital=avgBuy*qty;
      const netPnl=+((avgSell-avgBuy)*qty-charges).toFixed(2);
      components.push({qty,avgBuy,capital,proceeds:avgSell*qty,charges,netPnl,...parts});
    };
    if(sameDayQty>0) addKnownComponent(sameDayQty,todayAvg,true);
    if(deliveryQty>0&&holdingAvg!=null) addKnownComponent(deliveryQty,holdingAvg,false);
    if(deliveryQty>0&&holdingAvg==null){
      if(sameDayQty===0){
        // If tradebook has the same sell date, use its exact FIFO-realized row.
        const tradebookRow=TRADEBOOK_STATS?._loadedThisSession
          && TRADEBOOK_STATS.lastDate===session.date
          && TRADEBOOK_STATS.lastDayRows?.find(r=>r.sym===sym);
        if(tradebookRow){
          rows.push(enrichExitPnlRow({...tradebookRow,_sort:tradebookRow.netPnl},session.date));
          return;
        }
      }
      // Preserve a known intraday component, but disclose carried shares whose cost is unavailable.
      const skipDp=dpCharged.has(sym);
      dpCharged.add(sym);
      const scS=calcZerodhaChargesSplit(deliverySellAvg,deliveryQty,true,false,skipDp);
      const _brok=+scS.brokerage.toFixed(2),_stt=+scS.stt.toFixed(2),_txn=+scS.txn.toFixed(2);
      const _sebi=+scS.sebi.toFixed(2),_gst=+scS.gst.toFixed(2),_stamp=+scS.stamp.toFixed(2),_dp=+scS.dp.toFixed(2);
      const charges=+sumChargeParts({_brok,_stt,_txn,_sebi,_gst,_stamp,_dp}).toFixed(2);
      rows.push(enrichExitPnlRow({sym,sellTime:_sellTime,lots:sells.length,qty:deliveryQty,capital:null,buyPrice:null,sellPrice:+deliverySellAvg.toFixed(2),_brok,_stt,_txn,_sebi,_gst,_stamp,_dp,charges,winRate:null,netPnl:null,netPnlPct:null,_sort:-Infinity,_noAvgCost:true},session.date));
    }
    if(!components.length) return;
    const matchedQty=components.reduce((sum,c)=>sum+c.qty,0);
    const capital=components.reduce((sum,c)=>sum+c.capital,0);
    const avgBuy=capital/matchedQty;
    const avgSellMatched=components.reduce((sum,c)=>sum+c.proceeds,0)/matchedQty;
    const _brok=+components.reduce((sum,c)=>sum+c._brok,0).toFixed(2);
    const _stt=+components.reduce((sum,c)=>sum+c._stt,0).toFixed(2);
    const _txn=+components.reduce((sum,c)=>sum+c._txn,0).toFixed(2);
    const _sebi=+components.reduce((sum,c)=>sum+c._sebi,0).toFixed(2);
    const _gst=+components.reduce((sum,c)=>sum+c._gst,0).toFixed(2);
    const _stamp=+components.reduce((sum,c)=>sum+c._stamp,0).toFixed(2);
    const _dp=+components.reduce((sum,c)=>sum+c._dp,0).toFixed(2);
    const charges=+components.reduce((sum,c)=>sum+c.charges,0).toFixed(2);
    const netPnl=+components.reduce((sum,c)=>sum+c.netPnl,0).toFixed(2);
    const netPnlPct=capital>0?+(netPnl/capital*100).toFixed(2):null;
    rows.push(enrichExitPnlRow({sym,sellTime:_sellTime,lots:sells.length,legs:{sells:sortedSells.map(o=>({time:String(o.time||''),qty:Number(o.qty),price:Number(o.price)})),buys:buys.map(o=>({time:String(o.time||''),qty:Number(o.qty),price:Number(o.price)})).sort((a,b)=>a.time.localeCompare(b.time))},qty:matchedQty,capital,buyPrice:+avgBuy.toFixed(2),sellPrice:+avgSellMatched.toFixed(2),_brok,_stt,_txn,_sebi,_gst,_stamp,_dp,charges,winRate:netPnl>0?100:0,netPnl,netPnlPct,_sort:netPnl},session.date));
  });
  const total=+rows.reduce((s,r)=>s+(r.netPnl||0),0).toFixed(2);
  const unknownRows=rows.filter(r=>r.netPnl==null).length;
  // Only return Orders.csv result if there are actual sell rows — if today only has buys,
  // fall through to tradebook so yesterday's session P&L shows instead of ₹0.
  if(!rows.length) return null;
  return {source:'Orders.csv',date:session.date,total,rows,unknownRows,hasOrders:session.orders.length>0};
}


  // Economic FIFO for exit opportunity: never match an earlier sell to a later buy.
  // A replacement buy ends the old quantity's opportunity window to avoid counting it twice.
  function exitBuyWindows(symbol,date,orders,history=[]){
    const stamp=t=>String(t||'').replace('T',' ').slice(0,19);
    const normal=o=>({side:String(o.type||o.side||'').toUpperCase(),qty:Number(o.qty),price:Number(o.price),time:stamp(o.time)});
    const before=history.filter(o=>o.symbol===symbol&&stamp(o.time).slice(0,10)<date).map(normal).sort((a,b)=>a.time.localeCompare(b.time));
    const open=[];
    const consume=(qty,visit)=>{let left=qty;while(left>0&&open.length){const b=open[0],n=Math.min(left,b.qty);if(visit)visit(b,n);b.qty-=n;left-=n;if(!b.qty)open.shift();}return left;};
    for(const t of before){if(t.side==='BUY')open.push({...t});else consume(t.qty);}
    const day=orders.map(normal).filter(t=>t.qty>0&&t.price>0&&t.time.slice(0,10)===date).sort((a,b)=>a.time.localeCompare(b.time));
    const exits=[];
    for(const t of day){
      if(t.side==='BUY'){
        let left=t.qty;
        for(let i=exits.length-1;i>=0&&left>0;i--){const e=exits[i];if(e.until||e.sellTime>=t.time||!e.qty)continue;const q=Math.min(left,e.qty);e.qty-=q;exits.push({...e,qty:q,until:t.time});left-=q;}
        open.push({...t});
      }else if(t.side==='SELL'){
        const left=consume(t.qty,(b,q)=>exits.push({qty:q,buyTime:b.time,buyPrice:b.price,sellTime:t.time,sellPrice:t.price,until:null}));
        if(left>0)exits.push({qty:left,buyTime:null,sellTime:t.time,sellPrice:t.price,until:null});
      }
    }
    return exits.filter(e=>e.qty>0);
  }

  // Operational inventory basis: one weighted average over every share held.
  // v1600 (owner 29 Oct): a sale releases cost the way Zerodha books it. Same-day buys made before the sale go
  // first (earliest first), then carried shares at their opening average, so a same-day add that is sold again
  // leaves the carried shares at their own cost (LLOYDSENGG: 64 stay at 97.61). Fills are one session's.
  // Re-entry after a complete exit starts a new position and a new peak window.
  function weightedPosition(opening, fills, expectedQty){
    let qty=Number(opening?.qty||0),avgCost=Number(opening?.price||0),buyTime=opening?.time||null,cycles=0;
    let carriedQty=qty,carriedAvg=avgCost;const lots=[];
    const bad=reason=>({ok:false,reason});
    if(!Number.isFinite(qty)||qty<0||(qty>0&&!(avgCost>0&&Number.isFinite(avgCost))))return bad('Opening cost is unknown');
    if(expectedQty!=null&&!(Number.isFinite(Number(expectedQty))&&Number(expectedQty)>=0))return bad('Invalid portfolio quantity');
    const sorted=fills.map((f,i)=>({...f,_i:i})).sort((a,b)=>String(a.time).localeCompare(String(b.time))||a._i-b._i);
    for(const f of sorted){
      const q=Number(f.qty),price=Number(f.price),side=String(f.side||f.type||'').toUpperCase();
      if(!(q>0&&price>0&&Number.isFinite(q)&&Number.isFinite(price))||!f.time||!['BUY','SELL'].includes(side))return bad('Invalid execution fill');
      if(side==='BUY'){
        if(!qty){avgCost=0;buyTime=f.time;cycles++;}
        lots.push({q,p:price});qty+=q;
      }else{
        if(q>qty+1e-6)return bad('Sales exceed explained inventory');
        let left=q;
        while(left>1e-9&&lots.length){const n=Math.min(left,lots[0].q);lots[0].q-=n;left-=n;if(lots[0].q<=1e-9)lots.shift();}
        carriedQty=Math.max(0,carriedQty-left);
        qty=Math.max(0,qty-q);if(!qty){avgCost=0;buyTime=null;carriedQty=0;lots.length=0;}
      }
      if(qty>0)avgCost=(carriedQty*carriedAvg+lots.reduce((n,l)=>n+l.q*l.p,0))/qty;
    }
    if(expectedQty!=null&&Math.abs(qty-Number(expectedQty))>1e-6)return bad('Execution and portfolio quantities disagree');
    return {ok:true,qty,avgCost,buyTime,cycles};
  }

  // The saturation cap belongs to the Ensemble aggregate, not individual models.
  // v1607 (owner 30 Oct): Cumulative Change buys only fresh crossings: score below floor + 0.5. Replayed under the live
  // rules on 29/30 Oct triggers it was the only one-change variant better on both days (+0.06% vs +0.02%; -0.21% vs -0.41%).
  // Owner-approved 5 Nov research candidate DX_market60; raw CUM scoring is unchanged.
  const CUM_REFINEMENT = Object.freeze({version:'cum-v1638',middayCutoffMin:690,maxVwapGapPct:0.75});
  function cumRefinementReason(symbol,context,trigger=null,market='NSE',quote=null,now=null){
    if(market==='NSE'){
      const ist=new Date((now||Date.now())+19800000);
      const m=ist.getUTCHours()*60+ist.getUTCMinutes();
      if(m<570)return 'before the 09:30 opening-range close';
      if(m>=690)return 'CUM midday entry freeze active after 11:30 IST';
    }
    if(quote?.price>0&&quote?.vwap>0&&quote.price>quote.vwap*1.0075)return 'CUM gap ceiling: price stretched >0.75% above VWAP';
    return null;
  }

  const CUM_ENTRY_BAND = 0.5;
  function entryScoreCapped(model, score, floor){
    return model==='CUM'&&Number.isFinite(score)&&Number.isFinite(floor)&&score>=floor+CUM_ENTRY_BAND;
  }

  // v1635: a StratGen signal is produced at a completed bar and is valid until the
  // next bar of its own timeframe closes (90 s remains the floor for 1-minute work).
  function timeframeMinutesOf(dep){
    const match=/(\d+)\s*(minute|min|hour|hr)/i.exec(String(dep?.spec?.timeframe||dep?.timeframe||''));
    if(!match)return 5;
    const n=parseInt(match[1],10);
    return Math.max(1,Math.min(375,/^h/i.test(match[2])?n*60:n));
  }
  function signalTtlMs(dep){return Math.max(90000,timeframeMinutesOf(dep)*60000+30000);}

  // 27 Oct 2026 (owner): market-trend gates removed for every live and paper model.
  function entryGateApplies(){
    return false;
  }

  function applyDeployedStrategy(dep) {
    CONFIG.TARGET_PCT=1.25;CONFIG.STOP_LOSS_PCT=0;CONFIG.MAX_HOLDING_DAYS=null;CONFIG.ACTIVE_STRATGEN_DEPLOYED=null;
    if(!dep)return;
    if(dep==='MARKOV_3PCT'||dep.isMarkov||dep.strategy_id==='markov_multihorizon_3pct'){
      CONFIG.TARGET_PCT=1.25;
      CONFIG.STOP_LOSS_PCT=0;
      CONFIG.MAX_HOLDING_DAYS=null;
      CONFIG.ACTIVE_STRATGEN_DEPLOYED=null;
      return;
    }
    // Proposal TP/SL/horizons must never silently rewrite the common executor.
    if(dep.spec?.exit?.policy!=='rs-trail-min5-v2'||!(dep.program_schema==='rs-strategy-program-1'&&dep.program_validation?.contract_hash===dep.sha256)&&dep.test_evidence?.live_parity!==true)return;
    CONFIG.TARGET_PCT=0;CONFIG.ACTIVE_STRATGEN_DEPLOYED=dep;
  }

  return {
    NSE_SESSION_RULES,nseSession,nseClock,nseContinuous,
    applyDeployedStrategy,
    entryScoreCapped,
    CUM_ENTRY_BAND,
    CUM_REFINEMENT,
    cumRefinementReason,
    timeframeMinutesOf,
    signalTtlMs,
    entryGateApplies,
    weightedPosition,
    exitBuyWindows,
    bookedSession,
    calcZerodhaChargesSplit,
    minOrderRs,
    breakevenTurnover,
    minSharesForStock,
    dynamicTrailGapPct,
    quantityWithinBudget,
    minimumAllocationRs,
    planAccountEntries,
    ibkrOrderFee,
    authorizeAccountEntry,
    CONFIG,
    inputs,
    evaluateUniverse,
    filterUniverse,
    evaluateTrigger,
    evaluateExit,
    scoreStock
  };
}));
