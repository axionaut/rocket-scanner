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

## Automatic target addition - owner, 17 November 2026 (editable override - 18 November 2026)

- Target + % defaults automatically to the MLoT history total weighted median, using the same covered-stock-weighted harmonic calculation and two-decimal rounding as the displayed total.
- The user may manually type any value from 0 to 100% into `Target + %` (`targetExtraManual: true`) to override the automatic MLoT value, or clear the field to revert back to automatic MLoT tracking. Retain the last available auto value while history loads.

## MRMR entry guards - owner, 17 November 2026

- Original mRMR entries (score at or above floor) additionally require: (1) VWAP basing - a stock below session VWAP must have crossed it at least twice today; (2) no heavy selling volume - last 15 one-minute bars net down, at least 60% of their volume on down bars and bar volume at least 1.5x the session norm blocks entry. Metrics come from the mRMR worker's 1-minute bars; both guards are skipped until 15 session bars exist. Shared by the page and broker authorisation via picks/crossings (S.mrmrEntryGuard).

## Corrected mRMR indicator contract - owner, 17 November 2026

- Preserve prior-close continuous-return learning (`mrmr-prior-close-return-v2`) and the 218-indicator schema. Use real completed session candles for technical inference, with no appended flat quote candle; await the first completed session candle. Live price/depth and exchange VWAP remain authoritative for entry readiness.
- Session VWAP participation, dispersion and slopes exclude prior sessions. ADX uses Wilder smoothing, MACD histogram slope compares historical histograms, and named EMA9 inputs use period 9.
- Validate all 52 Ensemble semantic weight mappings against canonical indicator names and reject missing mappings. Indicator contract `mrmr-completed-indicators-20261117-v1` is mandatory for fresh snapshots and model caches; reject legacy indicator snapshots. No chase/volume research cutoffs, hand-set weights, allocation or exit changes were approved in this correction.

## VWAP / T-2 AVWAP Cross model - owner, 17 November 2026

- Separate AVWAP_CROSS model: existing universal hard filters, then binary upward crossover of session VWAP over AVWAP anchored at T-2 trading-session open. No mRMR score or indicator guards.
- Both signal lines use completed 5-minute HLC/3-volume bars; previous session-candle VWAP <= AVWAP and latest VWAP > AVWAP. No overnight comparison, no forming candles, no first or last session candle. Signal expires at the next candle close.
- Require T-2/T-1 history and current-session data; exchange calendar determines anchor and candle boundaries. Exchange VWAP/live quotes/depth remain execution inputs. Shared allocation and trailing exits apply; passing stocks have equal binary score 1.
- CUM removed from the visible dropdown; saved strategy is not silently switched. Original mRMR and combined model are unchanged.

## AVWAP rolling data visibility - owner, 18 November 2026

- Candle loading and numeric display run independently of entry eligibility and first/last-candle restrictions. Show the first completed session candle immediately; compare adjacent completed values for crossing without an additional confirmation delay.
- Keep completed T-2/T-1 history as a rolling baseline, refresh today separately, and preserve timestamped display values while refreshing and across helper restarts. Pre-open prior-session VWAP is explicitly dated and never treated as today's entry evidence.
- Block trade authorization during the first and last session candle even when a preceding candle supplied a crossover. Cached display-only values cannot authorize trades.

## Chart-aligned AVWAP crossing attribution - owner, 18 November 2026

- Attribute upward crossings to the linear intersection between the previous/current indicator points plotted at their 5-minute candle start times. Exclude intersections inside the first/last session candle, independently of execution-time guards.
- Detection still uses completed candles only. Never backdate execution or use the later point before its candle completes. Broker authorization recomputes the intersection and retains both values, anchor, crossing time and detection time. Reject prior AVWAP policy snapshots.

## AVWAP 4-candle uptrend & jump band - owner, 18 November 2026

- AVWAP_CROSS upward crossovers additionally require 4 contiguous completed 5-minute current-session candles (`t - prev_t == 5 min`, `volume > 0`) with non-red closes (`close >= open`), strictly rising candle closes (`C[t-3] < C[t-2] < C[t-1] < C[t]`), strictly rising session VWAP (`V[t-3] < V[t-2] < V[t-1] < V[t]`), and a 1-bar Session VWAP jump `100 * (V[t] / V[t-1] - 1)` within the `0.30%–0.50%` sweet spot (`AVWAP_JUMP_BAND`).
- Crossings before 4 completed session candles, failing the contiguous rising candle/VWAP check, or outside the `0.30%–0.50%` jump band remain inspectable in the table but cannot trigger GO. Broker authorization recomputes both checks from `vwapWindow` and `previous`/`current` under policy `avwap-t2-5m-v5-jump-band` and rejects prior AVWAP policy snapshots.



## ATR initial protection and trailing replacement - owner, 19 November 2026

- Supersedes the profit-only arming, MLoT/Markov extension tightening and swing-bounce exit rules above. Shared NSE exit policy is `rs-atr5m-ratchet-v1`.
- Initial protection uses one Wilder ATR14 from completed 5-minute candles, respecting the existing broker distance/tick checks. No breakeven or Target + % arming delay. Existing unprotected inventory starts from its current quote; confirmed stops are never lowered.
- Healthy new highs lift the stop with its existing rupee distance. Ordinary dips/rebounds do not squeeze it. Three contiguous completed candles with two strictly lower highs and closes confirm weakness; each new weak candle reduces distance by the larger of its high decline or ATR contraction, bounded at the broker minimum. Never apply the same candle twice.
- At minimum distance, keep trailing new highs; reaching minimum does not itself sell. Price crossing triggers the existing single-leg GTT lifecycle. Partial profit-funded trims retain their separate reservations and quantities.
- Missing ATR blocks new automated buy authorization; preserve existing protection while history refreshes. Shared replay uses causal candle evidence and labels missing ATR coverage explicitly. Parameters describe implementation, not validated profitability.
- Target addition remains saved for opportunity-swap expectancy; it no longer delays initial ATR protection. UI must distinguish broker-confirmed stops from pending protection and expose allocation cap versus cash numerically.

- Initial protective GTTs take priority over routine ratchets. Queue-full/expired-before-send errors are explicitly `notSubmitted` and retry with fresh quotes; genuine ambiguous broker writes retain reconciliation. ATR history uses a dedicated loader so whole-universe scoring cannot starve protection.
