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

    // BTST: +3% is the fallback for legacy positions and insufficient target-learning evidence.
    // New funded orders may carry a learned target; all unfilled positions exit by 15:20 next session.
    // No stop: overnight gaps jump stops (a -2% stop turned the walk-forward result negative).
    TARGET_PCT: 3.0,
    STOP_LOSS_PCT: 0,            // no stop-loss
    MAX_HOLD_DAYS: 1,            // exit on the next session
    EXIT_AT_MIN: 15 * 60 + 20,   // 15:20 IST time exit
    TOP_K: 5,                    // positions per day (equal weight)
    MIN_ALLOCATION_RS: 5000.0    // ₹5,000 minimum allocation per stock to ensure profits clear DP & charges
  };

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
    const daysHeld = Number(position.daysHeld || 0);
    const pnlPct = +(((ltp - avgCost) / avgCost) * 100).toFixed(2);

    const targetPct = Number(position.targetPct) > 0 ? Number(position.targetPct) : CONFIG.TARGET_PCT;
    // Use the target attached to this executed BTST entry; legacy positions retain +3%.
    if (pnlPct >= targetPct) {
      return {
        shouldExit: true,
        action: 'SELL',
        exitType: 'TARGET',
        pnlPct,
        reason: `Target hit: +${pnlPct}% (>= +${targetPct}%)`
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

    // Rule 3: Time exit - from the next session, sell at 15:20 if the target has not filled
    const now = new Date(Date.now() + 19800000);
    const nowMin = Number.isFinite(nowMinIST) ? nowMinIST : now.getUTCHours() * 60 + now.getUTCMinutes();
    const exitAt = CONFIG.EXIT_AT_MIN || (15 * 60 + 20);
    if (daysHeld >= CONFIG.MAX_HOLD_DAYS && nowMin >= exitAt - 5) {
      return {
        shouldExit: true,
        action: 'SELL',
        exitType: 'TIME_STOP',
        pnlPct,
        reason: `Time exit: held ${daysHeld} session${daysHeld === 1 ? '' : 's'} and +${targetPct}% not filled - sell at 15:20`
      };
    }
    if (daysHeld >= CONFIG.MAX_HOLD_DAYS) {
      return {
        shouldExit: false,
        action: 'HOLD',
        exitType: 'ACTIVE',
        pnlPct,
        reason: `Target +${targetPct}% not reached; time exit at 15:20 today (P&L ${pnlPct > 0 ? '+' : ''}${pnlPct}%)`
      };
    }

    // Otherwise maintain position
    return {
      shouldExit: false,
      action: 'HOLD',
      exitType: 'ACTIVE',
      pnlPct,
      reason: `Bought today: target +${targetPct}%; time exit 15:20 next session (P&L ${pnlPct > 0 ? '+' : ''}${pnlPct}%)`
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

  return {
    CONFIG,
    inputs,
    evaluateUniverse,
    filterUniverse,
    evaluateTrigger,
    evaluateExit,
    scoreStock
  };
}));

