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
