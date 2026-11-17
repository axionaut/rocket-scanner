# Working instructions

- Work as a business and technical partner. Keep releases fast and scoped. Work directly unless the owner explicitly requests delegation.

## Combined model selection - owner, 13 November 2026

- Markov structural eligibility and common universe checks precede candidate inference; causal regime-specific mRMR weights feed the existing five-member Ensemble.
- Select at most the top five strictly positive Ensemble scores, with deterministic ties. The fifth selected score is an automatic relative cutoff, not an editable fixed 0.5 threshold. Fewer than five positive candidates means a smaller shortlist.
- Preserve the tested selection order: rank the reference candidate pool, select five, then require fresh live VWAP reclaim only (anti-chase band and pre-entry offer-vs-cap gate retired 17 Nov 2026 by owner; the IOC order's own +0.25% cap still bounds execution). Do not silently promote the sixth name because a higher-ranked name is waiting.
- Only live entry-qualified candidates publish numeric recommendation scores. Failed stages remain inspectable with reasons. Shared allocation, broker validation, fees, cash controls, and trailing exits remain authoritative.
- Combined-model GO requires a verified live price and depth ladder no older than 15 minutes (900 seconds, aligned with MRMR; updated 16 Nov 2026 while keeping 30s global stream freshness), an available sell offer (price cap enforced by the IOC order itself), and exchange session VWAP. Page readiness and broker authorization use the same freshness limit; candle-derived VWAP must not replace exchange VWAP on the entry path.
- Preserve full-universe market/sector context and the original cross-sectional score calibration. Removing reference stocks from those calculations changes the model; do not claim that pruning alone preserves the tested strategy.


## Shared mRMR learning - owner, 16 November 2026

- Both Original mRMR and Markov / mRMR / Ensemble use `mrmr-prior-close-return-v2`.
- Across the full filtered stock universe, correlate each indicator at the previous session close with the actual percentage return from that close to the current price. Include positive, flat and negative returns.
- Learn continuous Pearson relevance and redundancy on prior-close observations, refresh weights with current returns, and use signed weighted current-universe percentiles for standalone scores.
- The combined model projects the canonical live indicator weights into its existing Ensemble inputs. Historical training uses prior-close observations and actual subsequent returns known before each training observation. Reject legacy snapshot versions.

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
- Realized booked profits from today only (no prior-session carryover) (configured via `Loss trim budget %`) strictly underwrite Opportunity Swaps.
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

- Superseded 16 Nov 2026: Stocks per allocation is retired. Owner position limits (16 Nov 2026): Min position Rs (default 25,000) and Max position Rs (default 50,000) replace Stocks per allocation for normal allocation buys. No normal buy order is smaller than Min; free cash below it waits. A stock's total position (holding + new buy) never exceeds Max; extra cash stays free. The number of names follows from cash and the limits, with score-proportional sizing between them and the existing top-5 combined-model selection unchanged. Live page plan, helper Auto-Buy/bridge authorisation, and account replay use the same limits; old snapshots without limits keep their recorded count. Opportunity-swap buys and all sell/trim rules (PUOS) are unchanged.
- Superseded 16 Nov 2026: Target + % sets only the arming hurdle (1.25% + Target + %; 0 preserves immediate breakeven arming) before placing a single-leg trailing stop, without clamping the stop up to a tight minimum-profit floor. Once armed at or above the hurdle, the stop starts at breakeven / MLoT trail (`trailStep`) and ratchets upward monotonically via MLoT and Markov adaptation. Keep raw dynamic state separately, preserve locked trigger prices and one confirmed single-leg GTT ID, and retain explicit research overrides.

## Inclusive allocation budgets - owner, 17 November 2026

- Min/Max allocation rupees include buy charges. Min is the minimum cash budget to allocate, with whole shares rounded down inside it. Max caps existing holding value plus new shares and buy charges. Normal allocation uses available cash without an extra fixed rupee reserve. The page, broker authorisation and replay apply the same budget semantics.

## Automatic target addition - owner, 17 November 2026

- Target + % automatically follows the MLoT history total weighted median, using the same covered-stock-weighted harmonic calculation and two-decimal rounding as the displayed total. The field is read-only. Retain the last available target while history loads.
