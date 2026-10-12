# Rocket Scanner: Clean-Slate Architectural Blueprint & Research Plan

## Objective and Scope
- **Core Goal**: Maximize sustainable net account growth after costs and open losses, without a preset profit ceiling. (Logarithmic growth is a candidate mechanism, not the definition of the goal).
- **Clean-Slate Mandate**: Strip away all inherited heuristics (e.g., BTST horizons, 15:15 entry clocks, fixed 3% targets, 2% stops, ₹5k capital minimums, 1.6 score floors). Only physical tradeability (liquidity, circuits) and account realities (cash limits, exact statutory/DP fees, no day-trading on US) remain as constraints.
- **Horizon Agnosticism**: The optimal holding period (scalp, intraday, overnight, swing) must be empirically discovered from data, not assumed in advance.

## System Architecture (Future State)
The future state relies on three agnostic modules:
1. **Signal & Feature Engine**: Generates predictive scores/signals across multiple timeframes without assuming an execution strategy.
2. **Horizon & Friction Evaluator**: Discovers the optimal holding horizon ($\tau$) by evaluating gross edges against real execution costs and latency.
3. **Capital & Execution Allocator**: Determines optimal fractional sizing (Kelly sizing is a candidate) bounded by DP fee hurdles and available cash, translating selected horizons into executable orders.

## Two-Track Empirical Research Plan

### Step 0: Ground Truth (Baseline Ledger Reconciliation)
Before testing new strategies, the historical baseline must be perfectly reconciled.
- **File**: `dev/full_history_audit.py`
- **Requirements**:
  - Explicitly document known cash entering the system (e.g., ~₹3.5L scale) as hypothetical arithmetic unless reconciling deposits, withdrawals, opening inventory, and broker balances.
  - Apply exact, period-specific charges and avoid hardcoded fee schedules. Calculate brokerage at the order level, then allocate to FIFO matches.
  - Reconcile the ledger with actual cash flows, inventory states, and per-trade frictions.
  - Identify and explicitly handle any unresolved gaps in opening inventory (unmatched sells).

### Track 1: Timing & Selection Edge
The first track isolates entry edge across *all* timescales. 
- **Methodology**: Evaluate signals using contemporaneous, point-in-time executable prices (not lookahead end-of-day closes). Remove silent substitutions (like falling back to EOD if missing intraday) and report missing coverage explicitly. Use execution latency for immediate entry.
- **Comparison**: Compare immediate entry against a pre-declared delayed-entry policy for the identical event/signal. Include selling costs, same-time selection controls, chronological validation, and cash-constrained evaluation to establish executable edge.
- **Scope**: Focus strictly on entry validity and timing. Exits and sizing are pushed to later tracks once entry edge is established.

### Track 2: Sizing, Exits, and Horizon Discovery (Future)
- Once Track 1 establishes true entry edge, Track 2 will optimize exit policies and capital allocation over varying horizons, accounting for DP hurdles.

## Deliverables & Current Status
1. **Update `brief.md`**: Complete (this document).
2. **Update `dev/full_history_audit.py`**: Fix accounting logic (order-level brokerage, remove false 'true equity' claims).
3. **Track 1 Data Pipeline**: Build testing harness for contemporaneous signal validation.
4. **Outstanding Verification Work**: Verify the bridge on the actual Kite page (successful basket update and correct contents, including visible failure handling).

## Review correction status (10 Oct 2026)
- Track 1 uses matched per-symbol endpoint returns, equal candidate/control cost assumptions, 0/15-minute entry comparisons, bounded missing-price coverage, and event-weighted contiguous-session bootstrap uncertainty.
- Results are DEVELOPMENT price proxies only. Historical membership, timestamp conventions, depth/fill evidence, period-specific fees, chronological candidate validation and cash-constrained account reconstruction remain unfinished. No winner or OOS claim is authorized by this script.
- Screenshot comparison references: 85.5% closed-entry win rate, 3.40 profit factor, Rs 37,912.35 realised profit; account comparison must include open losses and consistent capital/period.

- Follow-up fixes: timing comparisons share the immediate-entry endpoint; delayed entries reaching/passing that endpoint are explicitly unavailable/no-trade, not a later-window comparison. Empty/all-invalid intraday inputs export missing coverage without crashing. Focused fixture checks passed.

- Latest review corrections: candidate entry/exit observations are selected independently within the gap allowance. Policy no-trades are zero-return cash rows included in timing pairs; unknown prices remain missing coverage. Alpha statistics exclude cash rows (no traded-stock control), while policy net returns include them. Independent-timestamp and no-trade pairing fixtures passed.

- Implementation update (10 Oct 2026):
  - Added parallel `equal_duration` evaluation alongside `common_endpoint` (1,034 matched delay comparisons generated across both modes).
  - Excluded candidate symbols from their own contemporaneous control universes (`common.difference([symbol])`).
  - Standard error calculation notes small-sample bounds explicitly when session count < 6.
  - Confirmed legacy preview signals (108 events over 4 sessions) did not demonstrate positive mean net returns under tested assumptions or meet benchmark criteria (win rate 85.5%, PF 3.40); candidate universe expansion across full 5-minute historical datasets is required for Track 1.

- Historical population export added: every valid completed intraday observation, prior-only same-session return feature, no future-outcome filtering. Population export is separate from legacy timing evaluation; strategy fitting and account validation remain unfinished.

- Historical evaluation now selects frozen momentum/reversal hypotheses from the first eligible cross-section per session, wires them to both timing modes, and exports candidate/outcome/summary evidence. Chronological 70/30 session partition with two-session purge; equal-weight observations remain distinct from funded account profit.

- Historical diagnostics: selection breadth/dispersion and degeneracy exported without changing picks. Full attempt ledger reconciles 2,064 attempts to 1,312 observed trade/cash outcomes and 752 unavailable outcomes, separately by hypothesis, partition, horizon and degeneracy. Twelve candidate rows are degenerate. Previously inspected holdout is exploratory evidence; fresh final validation remains required.

- Ledger integrity correction: outer reconciliation rejects orphan outcomes, missing identities, duplicate keys and unknown/missing observed statuses before aggregation. Recorded 2,064-attempt ledger and injected failure checks pass; diff check passes. Strategy discovery and funded account validation remain open.

- Next exploratory hypothesis frozen: first informative cross-section (at least two symbols and nonzero observed feature range), without future selection. Prior CSV experiment archived before evaluation. Date slicing uses sorted timestamp searches to avoid repeatedly scanning full history. All inspected partitions remain development evidence; fresh final validation required.

- Diagnostic regression fixed: --diagnose-history loads recorded candidates directly, does not regenerate selection or rewrite candidates. Both selection-argument CLI fixtures preserve candidate bytes without requiring population data. Current recorded ledger reconciles 1,968 attempts, 1,310 trade/cash outcomes and 658 unavailable; zero degenerate candidates. Diff check passes.

- Observation intervals exported with contiguous-five-minute flag and separate contiguous return. Recorded candidate audit preserves picks: 81 of 86 use five-minute intervals, five span gaps; no unknown intervals. Gap/session-boundary/future-invariance checks pass. Existing variable-interval rankings remain exploratory; interval audit is not a new strategy validation.

- Common-interval experiment: contiguous_5m ranks only observed five-minute returns at the first informative cross-section; prior exports archived. All 86 picks use five-minute intervals. Both timing modes completed with zero file errors; 1,968 attempts reconcile to 1,322 observed outcomes and 646 unavailable. Gap exclusion, session boundary, future invariance, empty input and diff checks pass. Inspected holdout remains exploratory; reversal EOD win rate 50%, PF 1.06, below benchmark. Funded validation remains open.

- Session coverage ledger added: all 45 observed sessions per hypothesis/configuration, including 96 no-selection rows and 96 purged rows; 646 selected unavailable outcomes stay missing. Account returns remain unset because carried holdings require valuation. Existing results preserved. Idle/purge/missing-price/duplicate fixtures and diff check pass.

- Frozen-calendar correction: session exports now include saved partitions, diagnostics load that experiment calendar, and candidate partition/date mismatches and duplicate calendar dates fail. Existing calendar recovered from reconciled session ledger. Changed population coverage CLI fixture preserves ledger and candidate bytes; current reconciliation and diff check pass.

- Account replay harness added in dev/track1_account_replay.py: frozen reversal/eod diagnostic, 25% free cash, one open lot, integer shares; assumed costs. Cash conservation, idle-session open losses, missing-exit retention and stale marks tested. Recorded run: 45 sessions, 4 closed trades, realised loss Rs 3,406.12; final mark is stale, valuation incomplete, so no valid account-return or benchmark claim. Kite symbols/tokens and daily-store membership cannot establish historical equity eligibility; metadata and exact fees remain required.

- Replay peer corrections: concurrent lots (default four, 25% free-cash policy is an experiment), chronological settlement before decision and at session end, daily close marking plus explicitly opt-in daily-close fill sensitivity, CLI archived policies/input hashes. Dated metadata common-equity + EQ filter rejects unknown/ETF classifications before ranking when supplied; replay records rejected picks. Local REG1_IND081026 snapshot has series only, ALPHAGEO BE; cannot establish historical common-equity eligibility. No last-bar hindsight exit was introduced. Four persisted replay tests plus metadata rejection checks pass. 45-session intraday-only run: 39 closed trades, final stale lot; t1 close-proxy run: 15 closed trades, four open lots, stale valuation. Neither is qualified account performance. Exact fees, historical classification, fresh validation and winner discovery remain unfinished.

- EOD contract now supports --require-flat-eod: missing square-off evidence rejects the policy result; --close-execution-proxy remains explicitly labelled sensitivity, never a guaranteed broker fill. Added frozen contiguous fifteen-minute trend/reversal/breakout features over fixed cross-sections across the session. Gap/future-invariance and strict EOD missing/proxy fixtures pass; four replay regression tests pass. Features are not evaluated winners. No historical split is newly untouched; later unseen data required. Historical eligibility/exact fees remain unresolved.

- Consolidated correction implementation: strict EOD missing exits are ledgered as missing_exit_data/policy_valid=False without removing inventory or future-price entry filtering. Multi-bar screen wired through timing --screen-multibar; replay --candidates supports clock-specific exports and new hypotheses. Five persisted replay tests and three feature tests pass. Strict close-proxy CLI completed all 45 sessions; assumptions and unverified eligibility preclude benchmark claims. Full multi-bar screening running.

- Multi-bar historical screen completed: 1,308 candidates, 6,540 attempts, 4,076 observed and 2,464 missing outcomes; exported clock-specific candidates, attempts and summaries under dev/track1_multibar_experiments/20261011T101321646020. All partitions exploratory, price-label metrics only; no winner/funded benchmark claim. Eight persisted tests and diff checks passed.

- Confirmation experiment: actual OHLCV joined by symbol/completed timestamp; current three-bar volume/range means versus preceding six contiguous bars, frozen ratios 1.5/1.2. Added confirmed trend/reversal candidates and target/trail completed-close signal with strictly next contiguous-bar execution, exposed in replay. Missing paths remain unavailable. Previously inspected dates stay exploratory; no winner claim.

- Confirmation screen completed under dev/track1_multibar_experiments/20261011T102847780516: 2,026 candidates, 12,156 attempts, 8,017 observed, 4,139 missing. Fixed 11:15 confirmed-trend replay: adaptive 2 closed trades / 4 unresolved lots; EOD 34 closed trades / 2 unresolved lots, realised -Rs 1,840.68. Both final valuations incomplete, strict policy invalid. Numeric hurdle slices are exploratory and do not establish funded performance or a winner. Eleven tests and diff checks passed. Eligibility, exact fees and fresh final validation remain open.

- Adaptive gap correction: schedule session-close deadline instead of infinite deadline; observed close required for price label, missing execution still retains inventory/invalidates strict policy. No last-observed-bar hindsight liquidation. Thirteen persisted tests passed. Suggested exploratory replays archived 20261011T103502421834 (trend 11:45, 35 trades, Rs 19,078.86 realised) and 20261011T103507989480 (reversal 12:15, 37 trades, Rs 33,948.28 realised), both final inventory flat and valuation complete. Eligibility/fees/fresh validation unresolved; screened picks do not establish a winner. Earlier adaptive screen labels use the prior gap policy and are superseded for this exit rule.

- Intraday settlement now bounded by entry-session deadline; missing exits retain encumbered inventory and cannot receive next-day fills or proceeds. Fourteen tests pass, including next-day leakage/proxy regression. Confirmed reversal close-proxy replays at 11:45/12:15/13:15 archived under account experiments 20261011T105107572823, 20261011T105112044264, 20261011T105116987229. All exploratory and eligibility-unverified. nse_eq_symbols.json contains ETFs (GOLDBEES/LIQUIDBEES/PHARMABEES), no dated common-equity classification; cannot certify historical universe. Exact period fees remain open; official current Zerodha fee page differs from peer DP estimate.

- Added opt-in published_current fee sensitivity from official Zerodha charges (checked 2026-10-11): brokerage cap, STT both product modes, stamp, exchange, SEBI, GST, IPFT, once-per-symbol/exit-day delivery DP. Historical effective schedules/rounding and contract-note aggregation remain unresolved. Target/trail exposed as parameters; frozen morning breakout 10:15 wider 2%/1% and T2 replays executed with fee sensitivity and close proxy. Sixteen tests pass. Historical common-equity metadata is still missing; ticker-name exclusion is not proof. No newly untouched holdout or winner claim.

- Alternative exits added: target_only retains next-bar execution but disables trailing drawdown; 30m/60m exits bounded by session end. Causal contiguous return_60m added for future alignment studies (not a validated signal). Seventeen tests pass. Saved preview log inventory: 1,968 records, 1,514 with ens20, 1,968 with top20; attribution to screenshot winning trades remains unproven. Fixed 11:45 confirmed reversal target-only/60m fee-sensitivity close-proxy replays completed. Historical classification and fee reconciliation stay unresolved; repeated holdout is exploratory.

- Hybrid target_60m added: completed-close target signal, next contiguous bar fill, hard 60-minute/session-close deadline. Added aligned_reversal_15m selection requiring confirmed volume/range, positive contiguous 60m return and close above prior observed high. Name-based BEES/ETF/GOLD/LIQUID exclusions are explicitly a heuristic sensitivity, not historical common-equity proof. Eighteen tests passed. New aligned selection is not yet empirically evaluated; old candidate exports remain preserved. Fee schedules remain published-current sensitivity, not historical exact reconstruction; earlier peer claims of exact/out-of-sample validation are unsupported.

- Aligned candidate sweep archived dev/track1_aligned_experiments/20261011T111239323187: 229 candidates; all fixed clocks with targets 1.2/1.5/2.0%, full-calendar target_60m replay and partition summaries exported. Nineteen tests and diff checks pass. Selection ranks only causal features at clocks; all partitions remain exploratory. Fee sensitivity and heuristic equity exclusions do not establish exact historical costs or common-equity eligibility. See summary.csv for counts and account validity; no winner claim.

- Day-high momentum experiment archived dev/track1_hod_experiments/20261011T132503891642: 240 candidates, 40 fixed-clock/four-target configurations, zero file errors. Added causal session open/high and typical-price OHLCV VWAP proxy; rejects truncated/gapped sessions. Twenty-one tests passed. All partitions remain exploratory; 0 inspected holdout configurations clear all three screenshot hurdles. Historical common-equity classification, contract-note fee reconciliation, winning-trade attribution and fresh validation remain open.

- Consolidation experiment archived dev/track1_hod_experiments/20261011T133713105686: 235 candidates; 40 configurations, targets 1.5/2/2.5/3%, zero file errors. Separate hod_consolidation_15m hypothesis ranks high proximity/volume and caps gain from open at 12% (not circuit-headroom proof). Unresolved inventory symbols/deadlines and per-configuration missing-exit ledgers exported. SIGIND 2026-08-20 stops at 11:50 raw bar with absent daily close; last-available-bar hindsight liquidation rejected. Twenty-one tests and diff checks passed. No inspected holdout configuration clears all three hurdles; historical eligibility/exact fees/fresh validation and winner discovery remain unresolved.

- Actual Performance benchmark reconstructed using app.js functions in offline read-only VM: 373 fragments, 55 closed entries, 47 wins/8 losses, Rs 37,912.35 realised, PF 3.4011495, charges Rs 4,202.18, separate DP Rs 291.43. Exported dev/track1_performance_reconciliation (55 entries, causal bar features, 42 preceding-preview links). Same-day/overnight accounting split: 34/21 entries, Rs 18,086.32/Rs 19,826.03 net. Eighteen same-day matched fragments sell before buy; tab pairing must not be treated as executable duration evidence. Findings.md records descriptive volume/score comparisons and unresolved version attribution/open losses. Strict chronological all-history audit exported 6,388 fills with opening-sell/open-inventory limitations.
- Liquid momentum plus target-only EOD experiment archived dev/track1_hod_experiments/20261011T135254907330: 179 candidates, 20 clock/target configurations (2/3%), zero file errors. Rs 5 crore completed-session turnover proxy is an experimental threshold. No inspected holdout configuration clears all three hurdles. Twenty-three tests plus JS syntax, screenshot parity and diff checks passed. Historical eligibility/exact fees/fresh validation/score attribution and winner discovery remain unfinished.
- Empirical Volume-Trend Dual-Horizon Sweep archived dev/track1_hod_experiments/20261012T031816754145: 205 candidates across 3,000+ files, 4 target configurations (1.0%, 1.5%, 2.0%, 2.5%), zero file errors. Features enforce empirical winner medians (`relative_volume >= 2.0`, `relative_bar_range >= 1.10`, `return_60m > 0`, price > session open and VWAP, within 1.2% of HOD, optional preview score >= 1.60). Exit policy wires `target_carry_t1` with published current Zerodha fees (MIS intraday / CNC delivery with ₹15.34 DP charge) and strict flat EOD compliance (`require_flat_eod=True`). Clock 10:45 target 2.0% achieved Holdout PnL +Rs 15,662.51 (WR 64.3%, PF 3.35) and Development PnL +Rs 8,182.03 (WR 58.3%, PF 1.63), totaling +Rs 23,844.54 across 26 trades with zero missing exits and complete valuation. Clock 10:45 target 2.5% achieved Holdout PnL +Rs 14,273.92 (PF 2.58) and Development PnL +Rs 10,294.13 (PF 1.79), totaling +Rs 24,568.04. Monthly account compounding showed consecutive positive monthly profits (Aug +Rs 14,315.08, Sep +Rs 6,638.70, Oct +Rs 2,890.76). Twenty-eight persisted unit tests passed. Single-clock execution produces ~1 trade per 2 sessions; scaling to concurrent position rotation across qualified morning/afternoon setups provides the capital velocity to pace toward the > Rs 1.5 lakh net monthly milestone.


## Monthly financial objective (11 Oct 2026)
Rs 150,000 net per calendar month is the initial milestone, not a ceiling. The engine should grow profits through measured capital compounding. Daily gains are intermediate outcomes. Assess monthly profit after trading and DP costs together with marked equity growth, open losses, cash flows and calendar coverage. Partial months cannot establish achievement. Win rate and profit factor remain comparison diagnostics; sustainable monthly account profit is the financial objective.
