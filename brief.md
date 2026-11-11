# Active Task: Deployed v1683 / Operational

Rocket Scanner v1683 deployed at 2026-11-11 13:22 IST. System operational and in sync with origin/master.

---

### Recent Deployed Releases
- **v1683:** Calculate Loss Budget from full 5-session rolling pool and eliminate StratGen status jitter
- **v1682:** Show OS eligibility reason in unfunded GO row tooltips and status
- **v1681:** Fix EXECUTION_CONTROLS ReferenceError on frontend and display required minimum order rupees in allocation status
- **v1680:** Unified Profit-Underwritten Opportunity Swap (PUOS) and Release Expert doc maintenance
- **v1679:** Removed manual Buy Basket and Kite auto-send buttons from top control bar.
- **v1678:** Disqualified already-executed Markov stocks so liberated cash funds fresh candidates.
- **v1677:** Resolved LOSS_BUDGET and Opportunity Swap trigger collision via swapPending guard and isLossGtt check.
- **v1676:** Non-reentrant swap guard, reuse resting GTTs, transient waiting for sacrifice sell fill.
- **v1671:** Removed redundant 1% VWAP filter from `evaluateOpportunitySwap` in `strategy.js` to strictly preserve verified strategy GO breakouts.
- **v1670:** Relaxed swap anti-chase ceiling and calibrated test harness.
- **v1669:** Initial deficit-aware partial Opportunity Swap engine with SEBI 80% usable margin factor, loss ceiling protection, and UI swap eligibility indicators.
- **v1668:** Fixed Markov live reversal signals and UI equality.
- **v1659:** Verified SDL handler with live job progress; resolved exit DOM field reads.
- **v1658:** Native StratGen inline-script syntax and permanent core-row retention before testing/after reset/restore.
- **v1654:** Implemented JSON plug/receiver with verified single engine source registry.
