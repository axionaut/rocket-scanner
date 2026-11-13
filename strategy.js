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
  const _liveMarketState = {
    nse: { active: false, detectedAt: 0, reason: null },
    us: { active: false, detectedAt: 0, reason: null }
  };
  function setMarketLiveOverride(market, active, reason='tape_active', now=Date.now()){
    if(market==='nse'||market==='all') _liveMarketState.nse = { active: !!active, detectedAt: now, reason };
    if(market==='us'||market==='all') _liveMarketState.us = { active: !!active, detectedAt: now, reason };
  }
  function isMarketLiveOverride(market, now=Date.now(), timeoutMs=300000){
    const st = market === 'us' ? _liveMarketState.us : _liveMarketState.nse;
    return !!st.active && (now - st.detectedAt <= timeoutMs);
  }
  function getMarketLiveState(){
    return { ..._liveMarketState };
  }

  function nseSession(day, holidays=null, symbol=null){
    const date=new Date(String(day)+'T12:00:00Z');
    if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==day)return null;
    const special=NSE_SESSION_RULES.special?.[day];
    if(special){
      const sym=String(symbol||'').toUpperCase().replace(/^NSE:/,'').replace(/-EQ$/,'');
      return {...special,date:day,special:true,close:symbol&&special.casSymbols?.includes(sym)?special.casClose:special.close};
    }
    const c=nseClock();
    // Dynamic market-sensing: verified live ticks flowing today automatically unlock the session without manual code edits
    if(c.day===day && isMarketLiveOverride('nse')){
      return {date:day,name:'Special Session (Auto-Detected)',preopen:540,open:555,close:930,postClose:960,special:true,autoDetected:true};
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
    const c=nseClock(at);
    // Dynamic market-sensing override: active live ticks stream continuous trading regardless of static calendars
    if(isMarketLiveOverride('nse', at)){
      const weekday=new Date(c.day+'T12:00:00Z').getUTCDay();
      // Pre-open auction protection on standard weekdays: regular trading begins at 09:15
      if(weekday>=1&&weekday<=5&&c.minute>=540&&c.minute<555)return false;
      return true;
    }
    const s=nseSession(c.day,holidays,symbol);
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

  // One allocation decision for the live basket, account replay and strategy tests.
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
      if(!reason&&floor>ceiling+1e-7){
        reason = spendable < floor
          ? `Available cash cannot cover the whole-share minimum order (needs ₹${Math.round(floor).toLocaleString('en-IN')})`
          : `Liquidity or allocation cap cannot cover the whole-share cost breakeven minimum (needs ₹${Math.round(floor).toLocaleString('en-IN')})`;
      }
      if(!reason&&selected.length>=maxStocks)reason='Stocks per allocation limit reached; higher scores funded first';
      if(!reason&&reserved+floor>spendable+1e-7)reason=`Cash cannot cover every minimum order (needs ₹${Math.round(floor).toLocaleString('en-IN')}); higher scores funded first`;
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
    const isSwap = request.kind === 'opportunity-swap' || request.isOpportunitySwap;
    const budget=Math.min(live.cash,Number.isFinite(live.allocationCap)?live.allocationCap:Infinity);
    const qty=Math.min(request.qty,quantityWithinBudget(budget,request.cap,request.cap*1.003));
    if(!(qty>0)) {
      if (isSwap) throw Error('Cash unavailable: waiting for sacrifice sell fill');
      throw Error('Entry no longer fits available cash');
    }
    if(minimum>0&&qty*request.cap<minimum) {
      if (isSwap) throw Error('Cash unavailable: waiting for sacrifice sell fill');
      throw Error(`Cash left fits only ${qty} share(s) (Rs ${Math.round(qty*request.cap)}), below the Rs ${Math.round(minimum)} minimum`);
    }
    if(isSwap){
      if(request.fundingPending||!request.fundingSale)throw Error('Cash unavailable: waiting for sacrifice sell fill');
      const sale=request.fundingSale;
      const economics=swapEconomics(Number(request.sacrificeAvgCost),sale.price,sale.qty,request.cap,qty,Number(request.swapTargetPct));
      if(!economics||economics.buyerPotentialGain+1e-9<economics.lossRs)throw Error('Executable swap target gain no longer covers sacrifice loss');
    }
    return qty;
  }

  /**
   * Opportunity Swap (OS) Engine Evaluation:
   * Finds high-liberation-efficiency, shallow, stagnant holdings that can be sacrificed
   * to immediately fund high-conviction buy setups when available cash is exhausted.
   *
   * Dynamic checks:
   * 1. Market breadth >= 50%
   * 2. Not circuit-broken
   * 3. Buyer anti-chase ceiling (<= 1% above VWAP / Opening Range High)
   * 4. Sacrifice dwell time (>= 60 min, not bought in last hour)
   * 5. Sacrifice momentum failure (pnl < 0 AND (dayChg <= 0 OR ltp <= vwap))
   * 6. Sacrifice shallow loss limit (lossPct <= 2.5% and lossRs <= 250)
   * 7. Deficit-aware partial trimming (bounded by loss limit, preserving winners & balance)
   * 8. Sacrifice ranked by lowest lossPct (highest Liberation Efficiency Ratio)
   */
  function swapSellBasket(sac,now=Date.now()) {
    const symbol=String(sac?.symbol||sac?.sym||'').toUpperCase();
    const qty=Number(sac?.sharesToSell),price=Number(sac?.limitPrice||sac?.sellPrice||sac?.ltp);
    if(!symbol||!Number.isInteger(qty)||qty<1||!(price>0))throw Error('Invalid sacrifice sell basket');
    return [{id:now,instrument:{tradingsymbol:symbol,symbol,exchange:'NSE',type:'EQ',segment:'NSE',lotSize:1},weight:0,
      params:{transactionType:'SELL',product:'CNC',orderType:'LIMIT',validity:'DAY',validityTTL:1,
        quantity:qty,price,triggerPrice:0,disclosedQuantity:0,lastPrice:Number(sac.ltp)||price,variety:'regular',tags:['RS_SWAP']}}];
  }
  // One conservative, fee-inclusive economic contract for preview and executable swaps.
  function swapEconomics(avgCost,sellPrice,sellQty,buyPrice,buyQty,targetPct) {
    if(![avgCost,sellPrice,sellQty,buyPrice,buyQty,targetPct].every(Number.isFinite)||
      !(avgCost>0&&sellPrice>0&&sellQty>=1&&buyPrice>0&&buyQty>=1&&targetPct>0))return null;
    const sellFees=sumChargeParts(calcZerodhaChargesSplit(sellPrice,sellQty,true,false,false));
    const originalBuyFees=sumChargeParts(calcZerodhaChargesSplit(avgCost,sellQty,false,false,true));
    const buyFees=sumChargeParts(calcZerodhaChargesSplit(buyPrice,buyQty,false,false,true));
    const targetPrice=buyPrice*(1+targetPct/100);
    const targetFees=sumChargeParts(calcZerodhaChargesSplit(targetPrice,buyQty,true,false,false));
    const lossRs=Math.max(0,(avgCost-sellPrice)*sellQty);
    const buyerPotentialGain=(targetPrice-buyPrice)*buyQty;
    return {lossRs,
      buyerPotentialGain,
      sellFees,buyFees,targetFees,targetPrice};
  }
  function evaluateOpportunitySwap(unfundedCandidates, heldPositions, options = {}) {
    if (!Array.isArray(unfundedCandidates) || !unfundedCandidates.length) {
      return { eligible: false, reason: 'No pending buy candidates' };
    }
    if (!Array.isArray(heldPositions) || !heldPositions.length) {
      return { eligible: false, reason: 'No open positions to evaluate for sacrifice' };
    }
    const breadth = Number.isFinite(options.breadth) ? Number(options.breadth) : 0.50;
    if (breadth < 0.50) {
      return { eligible: false, reason: `Market breadth ${(breadth * 100).toFixed(1)}% < 50%` };
    }
    if (options.circuitBroken) {
      return { eligible: false, reason: 'Swap circuit breaker active (prior swap stopped out)' };
    }

    const maxLossPct = Number.isFinite(options.maxLossPct) ? Number(options.maxLossPct) : 50.0;
    const minLossPct = Number.isFinite(options.minLossPct) ? Number(options.minLossPct) : 0.75;
    // Profit-underwritten budget: loss is strictly bounded by available banked profit from 5-day pool
    const profitBudget = Number.isFinite(options.profitBudget) ? Math.max(0, Number(options.profitBudget)) : (Number.isFinite(options.maxLossRs) ? Number(options.maxLossRs) : 0);
    const maxLossRs = Number.isFinite(options.maxLossRs) ? Math.max(0, Number(options.maxLossRs)) : profitBudget;
    const targetPct = Number.isFinite(options.targetPct) ? Number(options.targetPct) : 1.25;
    const minDwellMs = Number.isFinite(options.minDwellMs) ? Number(options.minDwellMs) : 3600000;
    const availableCash = Math.max(0, Number(options.availableCash || 0));
    const usableCreditFactor = Number.isFinite(options.usableCreditFactor) ? Number(options.usableCreditFactor) : 0.80; // SEBI / Kite CNC T-day instant credit
    const now = options.now || Date.now();

    // 1. Pick the highest-scoring pending buy candidate (already qualified by active strategy)
    const validBuyers = unfundedCandidates.filter(c => {
      const px = Number(c.price || c.ltp);
      const score = Number(c.score);
      return px > 0 && score > 0;
    }).sort((a, b) => (b.score || 0) - (a.score || 0));

    if (!validBuyers.length) {
      return { eligible: false, reason: 'No buy candidates with valid price and strategy score' };
    }

    const buyer = validBuyers[0];
    const buyerPx = Number(buyer.price || buyer.ltp);
    const minTicket = Number(buyer.minCapital) > 0
      ? Number(buyer.minCapital)
      : Math.max(CONFIG.MIN_ALLOCATION_RS, buyerPx * (buyer.minShares || 1));

    // Deficit calculation against buffered ticket to ensure whole-share viability with charges
    const targetBudget = Math.max(minTicket * 1.003, buyerPx * 1.003);
    const deficit = Math.max(0, targetBudget - availableCash);
    if (deficit <= 0) {
      return { eligible: false, buyer, minTicket, availableCash, reason: `Available cash (₹${availableCash.toFixed(0)}) covers minTicket (₹${minTicket.toFixed(0)}); no swap needed` };
    }

    // 2. Filter and rank held positions for the best sacrifice
    const sacrifices = [];
    let greenRunnersCount = 0;
    let freshEntriesCount = 0;
    let bouncingCount = 0;
    let deepLossCount = 0;
    let hasZombieHoldings = false;

    for (const h of heldPositions) {
      const sym = h.symbol || h.sym;
      const qty = Number(h.qty);
      const avgCost = Number(h.avgCost || h.cost);
      const ltp = Number(h.ltp || h.lastPrice);
      if (!sym || !(qty > 0 && avgCost > 0 && ltp > 0)) continue;

      // In profit -> protect running winners!
      if (ltp >= avgCost) {
        greenRunnersCount++;
        continue;
      }

      // Check Zombie Capital Exemption:
      // Underwater position (unrealizedPct < 0) held for >= 7 sessions (or >= 10 calendar days).
      const daysHeld = h.firstAt > 0 ? (now - h.firstAt) / 86400000 : (h.firstSeenDay ? (now - new Date(h.firstSeenDay).getTime()) / 86400000 : 0);
      const sessionsHeld = Number.isFinite(h.sessionsHeld) ? h.sessionsHeld : Math.floor(daysHeld * (5 / 7));
      const isZombie = (ltp < avgCost) && (daysHeld >= 10 || sessionsHeld >= 7);
      if (isZombie) hasZombieHoldings = true;

      const lossPct = ((avgCost - ltp) / avgCost) * 100;
      // Skip near-breakeven spread noise (-0.01% to -0.49%)
      if (lossPct < minLossPct) {
        continue;
      }

      const dayOpen = Number(h.open || h.dayOpen || 0);
      const dayChg = Number.isFinite(h.dayChg) ? h.dayChg : (dayOpen > 0 ? ((ltp - dayOpen) / dayOpen) * 100 : 0);

      // T1 / BTST exclusion: stocks bought yesterday release ₹0 usable cash today under SEBI / Zerodha rules
      const settledQty = Number(h.settledQty != null ? h.settledQty : (h.t1 ? 0 : qty));
      if (settledQty <= 0 || h.t1 === true || h.isT1 === true) {
        continue;
      }

      // Deficit-aware partial sizing bounded by profit underwriting budget in absolute rupees.
      // A deep underwater position (e.g. -5% or -10%) is trimmed by part-selling only as many shares
      // as the absolute rupee loss budget (maxLossRs) allows (or full settledQty if Zombie Capital).
      const lossPerShare = Math.max(0.01, avgCost - ltp);
      const maxSharesByLoss = isZombie ? settledQty : Math.floor(maxLossRs / lossPerShare);
      if (maxSharesByLoss <= 0) continue; // Even 1 share exceeds rupee loss ceiling

      const sellPrice = typeof options.sellPriceFor==='function' ? Number(options.sellPriceFor(h)) : Number(h.sellPrice||ltp);
      if(!(sellPrice>0&&sellPrice<=ltp))continue;
      const effectiveUsableLtp = sellPrice * usableCreditFactor;
      const sharesNeeded = Math.ceil(deficit / effectiveUsableLtp);
      let sharesToSell = Math.min(settledQty, maxSharesByLoss, sharesNeeded);
      if (sharesToSell <= 0) continue;

      // Fee-inclusive underwriting is monotonic in sell quantity. Resize the sacrifice
      // before testing its whole-share replacement; never promise an unfunded ticket.
      if(!isZombie){
        let lo=0,hi=sharesToSell;
        while(lo<hi){const mid=Math.ceil((lo+hi)/2),e=swapEconomics(avgCost,sellPrice,mid,buyerPx,1,targetPct);
          if(e&&e.lossRs<=maxLossRs+1e-9)lo=mid;else hi=mid-1;}
        sharesToSell=lo;
      }
      if(sharesToSell<1)continue;
      const liberatedGross=sharesToSell*sellPrice;
      const liberatedUsable=Math.max(0,liberatedGross*usableCreditFactor-
        sumChargeParts(calcZerodhaChargesSplit(sellPrice,sharesToSell,true,false,false)));
      const totalFunding=availableCash+liberatedUsable;
      const finalBuyerShares=Math.floor(totalFunding/(buyerPx*1.003));
      if(finalBuyerShares<1||finalBuyerShares*buyerPx+1e-9<minTicket)continue;
      const economics=swapEconomics(avgCost,sellPrice,sharesToSell,buyerPx,finalBuyerShares,targetPct);
      if(!economics||(!isZombie&&economics.lossRs>maxLossRs+1e-9)||
        economics.buyerPotentialGain+1e-9<economics.lossRs)continue;
      const {lossRs,buyerPotentialGain}=economics;
      const ler = liberatedUsable / (lossRs || 1);
      sacrifices.push({
        symbol: sym,
        qty,
        sharesToSell,
        isPartial: sharesToSell < qty,
        remainingQty: qty - sharesToSell,
        avgCost,
        ltp,
        lossPct,
        lossRs,
        buyerPotentialGain,
        buyerQty:finalBuyerShares,
        buyerDebit:finalBuyerShares*buyerPx*1.003,
        sellPrice,
        limitPrice:sellPrice,
        isZombie,
        daysHeld: Math.round(daysHeld),
        sessionsHeld,
        liberatedGross,
        liberatedUsable,
        liberatedRs: liberatedGross, // backwards compatibility
        totalFunding,
        deficit,
        ler,
        dayChg,
        position: h
      });
    }

    if (!sacrifices.length) {
      if (greenRunnersCount === heldPositions.length) {
        return { eligible: false, buyer, deficit, minTicket, reason: 'All open positions are profitable; profitable runners are strictly protected' };
      }
      if (maxLossRs <= 0 && !hasZombieHoldings) {
        return { eligible: false, buyer, deficit, minTicket, availableCash, reason: 'No available banked net profit in 5-day pool to underwrite swap loss' };
      }
      let specificReason = 'No held positions qualify for sacrifice';
      if ((greenRunnersCount + freshEntriesCount + bouncingCount) > 0) {
        specificReason = `No eligible sacrifice candidates (${greenRunnersCount} green, ${freshEntriesCount} fresh, ${bouncingCount} bouncing)`;
      }
      return { eligible: false, buyer, deficit, minTicket, reason: specificReason };
    }

    // Rank sacrifices strictly by deepest underwater percentage loss first (worst loser trimmed first)
    sacrifices.sort((a, b) => (b.lossPct - a.lossPct) || (b.lossRs - a.lossRs));
    const chosen = sacrifices[0];
    const trimLabel = chosen.isPartial ? `Trim ${chosen.sharesToSell}/${chosen.qty} sh` : `Sell full ${chosen.sharesToSell} sh`;
    const zombieTag = chosen.isZombie ? ' [Zombie Capital]' : '';

    return {
      eligible: true,
      buyer,
      sacrifice: chosen,
      buyerQty:chosen.buyerQty,
      buyerDebit:chosen.buyerDebit,
      minTicket,
      deficit,
      availableCash,
      reason: `${trimLabel} of ${chosen.symbol}${zombieTag} (-₹${chosen.lossRs.toFixed(1)}, -${chosen.lossPct.toFixed(2)}%) to liberate ₹${chosen.liberatedGross.toFixed(0)} (₹${chosen.liberatedUsable.toFixed(0)} usable) for ${buyer.symbol} (Score ${buyer.score})`
    };
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
  function evaluateTrigger(stock, book = null) {
    const x=inputs(stock),ltp=x.price,dayHigh=x.high,upperCircuit=x.upperCircuit;
    if(!(ltp>0))return {canBuy:false,reason:'Invalid price'};

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

  // Relative admission, not a fixed numeric threshold. Deterministic ties keep
  // the shortlist bounded even when several committee scores are identical.
  const MEM_PICK_POLICY = 'mem-top5-positive-vwap-v1';
  const MEM_QUOTE_TTL_MS = 30000;
  function memQuoteState(quote,now=Date.now()) {
    const price=Number(quote?.price),vwap=Number(quote?.vwap),age=now-Number(quote?.priceAt);
    if(!(price>0))return {state:'WAIT',reason:'Price unavailable; waiting for a live quote'};
    if(!(vwap>0))return {state:'WAIT',reason:'Exchange session VWAP unavailable; waiting for a verified tick'};
    if(quote?.priceSource!=='live tick'||!Number.isFinite(age)||age<0)return {state:'WAIT',reason:'Live quote not verified'};
    if(age>MEM_QUOTE_TTL_MS)return {state:'WAIT',reason:`Quote is ${Math.ceil(age/1000)}s old; needs an update (maximum ${MEM_QUOTE_TTL_MS/1000}s)`};
    const bookAt=Number(quote?.bookAt),bookAge=now-bookAt;
    if(!(bookAt>0)||!Number.isFinite(bookAge)||bookAge<0)return {state:'WAIT',reason:'Waiting for a verified live order book'};
    if(bookAge>MEM_QUOTE_TTL_MS)return {state:'WAIT',reason:`Order book is ${Math.ceil(bookAge/1000)}s old; needs an update (maximum ${MEM_QUOTE_TTL_MS/1000}s)`};
    const ask=Number(quote?.ask),askQty=Number(quote?.askQty);
    if(!(ask>0&&askQty>=1))return {state:'WAIT',reason:'No sell offer available in the live order book'};
    const size=Number(quote?.tickSize),rawCap=price*1.0025,cap=size>0?Math.floor(rawCap/size+1e-9)*size:rawCap;
    if(ask>cap+1e-9)return {state:'WAIT',reason:`Best offer ₹${ask.toFixed(2)} exceeds entry price cap ₹${cap.toFixed(2)}`};
    return {state:'READY',reason:'Fresh quote and executable offer verified'};
  }
  function selectMemCandidates(ranking) {
    const seen=new Set();
    const positive=(ranking||[]).filter(r=>Array.isArray(r)&&typeof r[0]==='string'&&Number.isFinite(r[1])&&r[1]>0)
      .map(([s,score])=>[s.toUpperCase(),score]).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]))
      .filter(([s])=>{if(seen.has(s))return false;seen.add(s);return true;});
    const shortlist=positive.slice(0,5);
    return {policy:MEM_PICK_POLICY,limit:5,positiveCount:positive.length,topSymbols:shortlist.map(r=>r[0]),cutoff:shortlist.length?shortlist[shortlist.length-1][1]:null,shortlist};
  }
  function memEntryState(source,symbol,quote,now=Date.now()) {
    if(source?.rules?.pickPolicy!==MEM_PICK_POLICY)return {state:'WAIT',reason:'Awaiting the adaptive top-five strategy update'};
    const p=source.ensemblePipeline,at=Date.parse(p?.asOf),sym=String(symbol||'').toUpperCase();
    if(source.ok!==true||p?.ok!==true||source.session!==nseClock(now).day||!Number.isFinite(at)||now<at||now-at>180000)return {state:'WAIT',reason:'Awaiting fresh combined-model scores'};
    if(!source.selection?.topSymbols?.includes(sym))return {state:'WAIT',reason:source.watchlist?.[sym]?.reason||'Awaiting the failed-stage assessment for this stock'};
    const ready=memQuoteState(quote,now);if(ready.state!=='READY')return ready;
    const price=Number(quote.price),vwap=Number(quote.vwap);
    if(!nseContinuous(now,sym))return {state:'WAIT',reason:'Outside continuous trading session'};
    if(price<vwap)return {state:'WAIT',reason:`Shortlist #${source.selection.topSymbols.indexOf(sym)+1}: needs +${((vwap/price-1)*100).toFixed(2)}% to reclaim VWAP ₹${vwap.toFixed(2)} (last ₹${price.toFixed(2)})`};
    if(price>vwap*1.015)return {state:'WAIT',reason:'Outside VWAP anti-chase band (+1.5%)'};
    const pick=source.picks?.find(p=>p.symbol===sym);
    if(!pick?.triggered||!source.ranking?.some(r=>r[0]===sym&&Number.isFinite(r[1])&&r[1]>0))return {state:'WAIT',reason:source.watchlist?.[sym]?.reason||'Awaiting current execution eligibility'};
    return {state:'GO',reason:'Top-five positive Ensemble candidate; fresh VWAP entry confirmed'};
  }

  // 27 Oct 2026 (owner): market-trend gates removed for every live and paper model.
  function entryGateApplies(){
    return false;
  }

  function applySelectedModel(model) {
    const selected=String(model||'CUM').toUpperCase();
    if(!['CUM','MARKOV_3PCT','ENS','PATH','MRMR'].includes(selected))throw Error('Unknown selected model');
    CONFIG.TARGET_PCT=1.25;CONFIG.STOP_LOSS_PCT=0;CONFIG.MAX_HOLDING_DAYS=null;
  }

  return {
    NSE_SESSION_RULES,nseSession,nseClock,nseContinuous,setMarketLiveOverride,isMarketLiveOverride,getMarketLiveState,
    applySelectedModel,
    entryScoreCapped,
    MEM_PICK_POLICY,MEM_QUOTE_TTL_MS,selectMemCandidates,memEntryState,memQuoteState,
    CUM_ENTRY_BAND,
    CUM_REFINEMENT,
    cumRefinementReason,
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
    evaluateOpportunitySwap,
    swapEconomics,
    swapSellBasket,
    CONFIG,
    inputs,
    evaluateUniverse,
    filterUniverse,
    evaluateTrigger,
    evaluateExit,
    scoreStock
  };
}));
