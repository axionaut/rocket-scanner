# Working instructions

- Work as a business and technical partner. Keep releases fast and scoped. Work directly unless the owner explicitly requests delegation.

## Combined model selection - owner, 13 November 2026

- Markov structural eligibility and common universe checks precede candidate inference; causal regime-specific mRMR weights feed the existing five-member Ensemble.
- Select at most the top five strictly positive Ensemble scores, with deterministic ties. The fifth selected score is an automatic relative cutoff, not an editable fixed 0.5 threshold. Fewer than five positive candidates means a smaller shortlist.
- Preserve the tested selection order: rank the reference candidate pool, select five, then require fresh live VWAP reclaim and the existing +1.5% VWAP anti-chase band. Do not silently promote the sixth name because a higher-ranked name is waiting.
- Only live entry-qualified candidates publish numeric recommendation scores. Failed stages remain inspectable with reasons. Shared allocation, broker validation, fees, cash controls, and trailing exits remain authoritative.
- Combined-model GO requires a verified live price and depth ladder no older than 10 seconds, an available sell offer within the existing IOC price cap, and exchange session VWAP. Page readiness and broker authorization use the same freshness limit; candle-derived VWAP must not replace exchange VWAP on the entry path.
- Preserve full-universe market/sector context and the original cross-sectional score calibration. Removing reference stocks from those calculations changes the model; do not claim that pruning alone preserves the tested strategy.


## Mandatory Release Protocol (Release Expert) - 8 November 2026

- **Never manually run `git commit` or `git push` for a release.**
- Whenever any user-facing code or strategy change is ready to deploy, hand off the release to the Release Expert by executing:
  `node dev/release.cjs "<brief release description>"`
- The Release Expert enforces that:
  1. `app.js`, `strategy.js`, and `finance.js` pass syntax validation.
  2. `APP_VERSION` in `app.js` is automatically incremented.
  3. `BUILD_TS` in `app.js` is stamped with the exact current IST timestamp (`YYYY-MM-DD HH:mm IST`).
  4. Documentation files (`brief.md`, `CLAUDE.md`, `AGENTS.md`) are synchronized with the new version and release description.
  5. Tracked web assets and documentation are staged and committed under `v<APP_VERSION>: <description>`.
  6. The release is pushed to `origin master` and clean git status is verified.
- Skipping `dev/release.cjs` is forbidden because it leaves the on-screen version and timestamp stale in the user's browser.

## Unified Profit-Underwritten Opportunity Swap (PUOS) Policy - owner, 11 November 2026

- Standalone trims to cash are retired. The system never sells underwater holdings merely to hold idle cash.
- Realized net profits from the 5-session rolling pool (configured via `Loss trim budget %`) strictly underwrite Opportunity Swaps.
- An Opportunity Swap is only permitted if the sacrifice loss is fully covered by available booked net profit (`LOSS_BUDGET.available()`). Zero banked profit completely blocks loss-bearing swaps to preserve account principal.
- An asymmetric expectancy hurdle is enforced: the incoming buyer's potential target gain must be >= the sacrifice's realized loss. Sacrifices are resized to smaller partial trims if necessary so the trade is net positive upon reaching target.
- Profitable runners are strictly protected and never sacrificed.

## Shared trading and testing policy - owner, 5 November 2026

- Live, account replay and strategy backtests call the same score-proportional allocation and execution rules. Only strategy-specific entry conditions vary. Native CUM retains the original v1617 VWAP entry/crossing/rebuy chain (implicit zero boundary, original +0.5 entry band) and is not filtered through StratGen RVOL/universe/held-position vetoes. Owner-approved replacement on 5 November adds DX_market60 entry filters: native second rise >3x first, the tested March-selected 200-stock sample, >=50% fresh intraday above-open breadth (>=100 stocks), prior stock close > EMA20 > EMA50 and >=60% prior closes above EMA20. Common allocation/exits are unchanged.
- Allocate available cash in proportion to positive executable stock scores; binary pass/fail strategies give equal weights to passing stocks. Enforce whole shares, dynamic MLoT cost coverage, fees, liquidity caps and cash reservations. If minimum viable orders cannot all fit, fund higher scores first. The former Min % Capital setting and StratGen percentage controls are retired.
- Account replay starts with actual holdings and free cash. Invested holdings cannot be spent again.
- Strategy backtests start flat with the full real account equity as cash (holdings/positions at current market value plus available cash), then fund entries only from remaining cash and filled exits. This initial-state difference was explicitly confirmed by the owner; it is not a different execution policy.
- Obtain, timestamp and retain monetary inputs from actual account data. Never hardcode example balances or silently substitute default capital. Preserve original snapshots and results.
- Use common RS exits with no minimum holding time, no maximum holding deadline, and separate realized/unrealized marks. Model unavailable tick/depth observations explicitly; do not claim exact broker fills or live fidelity from shared-code checks alone.
- Display the generated/currently tested strategy and progress while research runs. Never show a completed test before it completes.
- Do not place orders or silently change saved account/surveillance settings as part of research. User-authorized allocation changes apply through the existing live execution path.

## Owner controls - 6 November 2026

- Stocks per allocation (1-20) limits highest-scoring executable names before shared score-proportional sizing; this caps each allocation batch, not existing holdings. Apply captured controls in account replay and strategy tests.
- Target + % adds percentage points of average cost to the dynamic GTT level; 0 preserves the original calculation. Keep raw dynamic state separately to prevent cumulative additions. Preserve locked trigger prices and one confirmed single-leg GTT ID. Above-market adjusted targets must be attainable rather than chased on every uptick. Explicit research target/time overrides remain disclosed.
