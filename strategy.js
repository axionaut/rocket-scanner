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

  // 19 Oct (owner): the minimum order comes from charges and the fixed +1.25% start, not a flat Rs 5,000.
  // A new position must net at least half its gross target gain after round-trip CNC charges, incl. the
  // once-per-stock-per-day DP fee. An add to a held stock shares that sale's DP fee, so only the
  // proportional charges apply and any whole share qualifies.
  function minOrderRs(held) {
    const v = 1e6, t = CONFIG.TARGET_PCT / 100;
    const pct = (sumChargeParts(calcZerodhaChargesSplit(v, 1, false, false, true)) + sumChargeParts(calcZerodhaChargesSplit(v, 1, true, false, true))) / v;
    const dp = held ? 0 : calcZerodhaChargesSplit(1, 1, true, false, false).dp;
    return t / 2 > pct ? Math.ceil(dp / (t / 2 - pct)) : Infinity;
  }
  CONFIG.MIN_ALLOCATION_RS = minOrderRs(false);

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
    if(heldSymbols.has(String(stock.symbol).trim().toUpperCase()))return reject('Already held (no additional buys)');
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
    const buy=Number(book?.buyQty??book?.totalBidQty),sell=Number(book?.sellQty??book?.totalAskQty);
    if(!Number.isFinite(buy)||!Number.isFinite(sell)||buy<=0||sell<=0)return {canBuy:false,reason:'Two-sided order-book totals unavailable'};
    if(buy<=sell)return {canBuy:false,reason:'Buyer depth does not exceed seller depth'};
    const depthScore=Math.round(100*buy/(buy+sell));

    // Target and Stop prices
    const targetPrice = +(ltp * (1 + CONFIG.TARGET_PCT / 100)).toFixed(2);
    const stopPrice = CONFIG.STOP_LOSS_PCT > 0 ? +(ltp * (1 - CONFIG.STOP_LOSS_PCT / 100)).toFixed(2) : null;

    return {
      canBuy: true,
      symbol: stock.symbol,
      limitPrice: ltp,
      targetPrice,
      stopPrice,
      depthScore,
      targetPct: CONFIG.TARGET_PCT,
      stopLossPct: CONFIG.STOP_LOSS_PCT,
      reason: 'Near-high policy and buyer-depth conditions met'
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
    const targetPrice = Number(position.targetPrice) > 0 ? Number(position.targetPrice) : avgCost * (1 + targetPct / 100);
    if(position.bracket) {
      const lower=Number(position.bracketLower)||0,sell=ltp>=targetPrice||(lower>0&&ltp<=lower);
      return {shouldExit:sell,action:sell?'SELL':'HOLD',exitType:sell?'BRACKET':'BRACKET_ACTIVE',pnlPct,
        lockStopPrice:lower||null,reason:sell?'Broker bracket trigger reached; awaiting limit fill.':`Bracket upper ${targetPrice.toFixed(2)}${lower>0?`, lower ${lower.toFixed(2)}`:''}`};
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

  // Operational inventory basis. A sale releases average cost, never a selected buy lot.
  // Re-entry after a complete exit starts a new position and a new peak window.
  function weightedPosition(opening, fills, expectedQty){
    let qty=Number(opening?.qty||0),avgCost=Number(opening?.price||0),buyTime=opening?.time||null,cycles=0;
    const bad=reason=>({ok:false,reason});
    if(!Number.isFinite(qty)||qty<0||(qty>0&&!(avgCost>0&&Number.isFinite(avgCost))))return bad('Opening cost is unknown');
    if(expectedQty!=null&&!(Number.isFinite(Number(expectedQty))&&Number(expectedQty)>=0))return bad('Invalid portfolio quantity');
    const sorted=fills.map((f,i)=>({...f,_i:i})).sort((a,b)=>String(a.time).localeCompare(String(b.time))||a._i-b._i);
    for(const f of sorted){
      const q=Number(f.qty),price=Number(f.price),side=String(f.side||f.type||'').toUpperCase();
      if(!(q>0&&price>0&&Number.isFinite(q)&&Number.isFinite(price))||!f.time||!['BUY','SELL'].includes(side))return bad('Invalid execution fill');
      if(side==='BUY'){
        if(!qty){avgCost=0;buyTime=f.time;cycles++;}
        avgCost=(avgCost*qty+price*q)/(qty+q);qty+=q;
      }else{
        if(q>qty+1e-6)return bad('Sales exceed explained inventory');
        qty=Math.max(0,qty-q);if(!qty){avgCost=0;buyTime=null;}
      }
    }
    if(expectedQty!=null&&Math.abs(qty-Number(expectedQty))>1e-6)return bad('Execution and portfolio quantities disagree');
    return {ok:true,qty,avgCost,buyTime,cycles};
  }

  // The saturation cap belongs to the Ensemble aggregate, not individual models.
  function entryScoreCapped(model, score){
    return model === 'ENS' && Number.isFinite(score) && score >= 2.15;
  }

  // 23 Oct 2026 (owner): PATH buys without the market gate (live and its M:PATH paper account); every other model keeps it.
  function entryGateApplies(model){
    return String(model || '').replace(/^M:/, '') !== 'PATH';
  }

  return {
    entryScoreCapped,
    entryGateApplies,
    weightedPosition,
    exitBuyWindows,
    bookedSession,
    calcZerodhaChargesSplit,
    minOrderRs,
    CONFIG,
    inputs,
    evaluateUniverse,
    filterUniverse,
    evaluateTrigger,
    evaluateExit,
    scoreStock
  };
}));
