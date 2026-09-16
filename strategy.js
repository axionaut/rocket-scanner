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
    MIN_PRICE: 50.0,
    MAX_PRICE: 5000.0,
    MIN_TURNOVER: 50000000,      // ₹5 Crore minimum traded value
    MIN_AVG_VOLUME: 100000,      // 1 Lakh shares 10-day average
    MIN_RVOL: 1.5,               // 1.5x time-of-day expected volume

    // Tier 2: Entry Triggers
    MAX_HIGH_DISTANCE_PCT: 1.2,  // Within 1.2% of Day High
    MIN_CIRCUIT_HEADROOM_PCT: 3.0, // At least 3.0% below Upper Circuit

    // Tier 3: Exit Governor & Allocation
    TARGET_PCT: 2.0,             // +2.0% profit target
    STOP_LOSS_PCT: 1.8,          // -1.8% hard stop loss
    MAX_HOLD_DAYS: 4,            // 4 days max hold before time-stop exit
    MIN_ALLOCATION_RS: 5000.0    // ₹5,000 minimum allocation per stock to ensure profits clear DP & charges
  };

  /**
   * Tier 1: Filter raw universe down to liquid, clean momentum candidates
   * @param {Array} stocks - List of stock objects from Kite universe
   * @param {Set} heldSymbols - Set of uppercase symbols currently open
   * @returns {Array} Filtered candidates
   */
  function filterUniverse(stocks, heldSymbols = new Set()) {
    if (!Array.isArray(stocks)) return [];

    return stocks.filter(stock => {
      if (!stock || !stock.symbol) return false;
      const sym = String(stock.symbol).toUpperCase().trim();

      // Guard: Never recommend a stock already held (prevents averaging down)
      if (heldSymbols.has(sym)) return false;

      const ltp = Number(stock.ltp || stock.price || stock.c || 0);
      if (!(ltp >= CONFIG.MIN_PRICE && ltp <= CONFIG.MAX_PRICE)) return false;

      // Turnover & Volume checks
      const volume = Number(stock.dayVolume || stock.volume || stock.v || stock.vol || 0);
      const turnover = Number(stock.turnover || (ltp * volume) || 0);
      const avgVol10 = Number(stock.avgVol10 || stock.av10 || 0);

      const passesLiquidity = (turnover >= CONFIG.MIN_TURNOVER) || (avgVol10 >= CONFIG.MIN_AVG_VOLUME);
      if (turnover > 0 && avgVol10 > 0 && !passesLiquidity) return false;

      // RVOL check (must have volume momentum)
      const rvol = Number(stock.relvol || stock.relVolAtTime || stock.rvol || stock.relVol || 0);
      if (rvol > 0 && rvol < CONFIG.MIN_RVOL) return false;

      // Trend Strength: Must be trading above day's open
      const open = Number(stock.open1d || stock.open || stock.dayOpen || stock.o || 0);
      if (open > 0 && ltp < open) return false;

      // Trend Strength: Must be trading above VWAP
      const vwap = Number(stock.vwap || stock.vwap5 || 0);
      if (vwap > 0 && ltp < vwap) return false;

      return true;
    });
  }

  /**
   * Tier 2: Real-time Entry Trigger on candidate stock
   * @param {Object} stock - Candidate stock data
   * @param {Object} book - Live order-book data { bids, asks, bidQty, askQty }
   * @returns {Object} Trigger evaluation
   */
  function evaluateTrigger(stock, book = null) {
    const ltp = Number(stock.ltp || stock.price || stock.c || 0);
    const dayHigh = Number(stock.high1d || stock.high || stock.dayHigh || stock.h || 0);
    const upperCircuit = Number(stock.upperCircuit || stock.uc || (ltp * 1.20));

    if (ltp <= 0) {
      return { canBuy: false, reason: 'Invalid price' };
    }
    if (dayHigh <= 0) {
      return { canBuy: false, reason: 'No day high data' };
    }

    // 1. Proximity to Day High (Micro-continuation within 1.2%)
    const distToHighPct = ((dayHigh - ltp) / ltp) * 100;
    if (distToHighPct > CONFIG.MAX_HIGH_DISTANCE_PCT) {
      return { canBuy: false, reason: `${distToHighPct.toFixed(1)}% below day high ₹${dayHigh.toFixed(2)} (max ${CONFIG.MAX_HIGH_DISTANCE_PCT}%)` };
    }

    // 2. Circuit headroom check (at least 3% below Upper Circuit)
    const circuitRoomPct = upperCircuit > 0 ? ((upperCircuit - ltp) / ltp) * 100 : 10;
    if (circuitRoomPct < CONFIG.MIN_CIRCUIT_HEADROOM_PCT) {
      return { canBuy: false, reason: `Near circuit ceiling (${circuitRoomPct.toFixed(1)}% headroom)` };
    }

    // 3. Order Book Depth Imbalance (if live depth is provided)
    let depthScore = 50;
    if (book) {
      const totalBuyQty = Number(book.buyQty || book.totalBidQty || 0);
      const totalSellQty = Number(book.sellQty || book.totalAskQty || 0);

      if (totalBuyQty > 0 && totalSellQty > 0) {
        if (totalBuyQty <= totalSellQty) {
          return { canBuy: false, reason: 'Seller depth dominates order book' };
        }
        depthScore = Math.min(100, Math.round((totalBuyQty / (totalBuyQty + totalSellQty)) * 100));
      }
    }

    // Target and Stop prices
    const targetPrice = +(ltp * (1 + CONFIG.TARGET_PCT / 100)).toFixed(2);
    const stopPrice = +(ltp * (1 - CONFIG.STOP_LOSS_PCT / 100)).toFixed(2);

    return {
      canBuy: true,
      symbol: stock.symbol,
      limitPrice: ltp,
      targetPrice,
      stopPrice,
      depthScore,
      targetPct: CONFIG.TARGET_PCT,
      stopLossPct: CONFIG.STOP_LOSS_PCT,
      reason: 'Volume surge + depth pressure at day highs'
    };
  }

  /**
   * Tier 3: Hard Exit Governor for Open Positions
   * Evaluates active position and signals immediate liquidation if rule is triggered
   * @param {Object} position - Position data { symbol, avgCost, qty, daysHeld }
   * @param {number} liveLtp - Current live market price
   * @returns {Object} Exit verdict
   */
  function evaluateExit(position, liveLtp) {
    if (!position || !(position.avgCost > 0)) {
      return { shouldExit: false, action: 'HOLD', reason: 'Invalid position cost' };
    }

    const avgCost = Number(position.avgCost);
    const ltp = Number(liveLtp || position.ltp || avgCost);
    const daysHeld = Number(position.daysHeld || 0);
    const pnlPct = +(((ltp - avgCost) / avgCost) * 100).toFixed(2);

    // Rule 1: Target Hit (+2.0%)
    if (pnlPct >= CONFIG.TARGET_PCT) {
      return {
        shouldExit: true,
        action: 'SELL',
        exitType: 'TARGET',
        pnlPct,
        reason: `Target hit: +${pnlPct}% (>= +${CONFIG.TARGET_PCT}%)`
      };
    }

    // Rule 2: Hard Stop-Loss Hit (-1.8%)
    if (pnlPct <= -CONFIG.STOP_LOSS_PCT) {
      return {
        shouldExit: true,
        action: 'SELL',
        exitType: 'STOP_LOSS',
        pnlPct,
        reason: `Stop-loss hit: ${pnlPct}% (<= -${CONFIG.STOP_LOSS_PCT}%)`
      };
    }

    // Rule 3: Time Stop Expired (>= 4 days without target)
    if (daysHeld >= CONFIG.MAX_HOLD_DAYS) {
      return {
        shouldExit: true,
        action: 'SELL',
        exitType: 'TIME_STOP',
        pnlPct,
        reason: `Time-stop expired: held ${daysHeld} days (max ${CONFIG.MAX_HOLD_DAYS} days)`
      };
    }

    // Otherwise maintain position
    return {
      shouldExit: false,
      action: 'HOLD',
      exitType: 'ACTIVE',
      pnlPct,
      reason: `Tracking: P&L ${pnlPct > 0 ? '+' : ''}${pnlPct}%, Day ${daysHeld}/${CONFIG.MAX_HOLD_DAYS}`
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
    filterUniverse,
    evaluateTrigger,
    evaluateExit,
    scoreStock
  };
}));

