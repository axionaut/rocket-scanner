import os
import glob
import json
import pandas as pd
import numpy as np

LOGS_DIR = 'Scanner Uploads'
INTRADAY_DIR = os.path.join(LOGS_DIR, 'Intraday')
DAILY_STORE = 'dev/btst_daily_store.pkl'
SLIPPAGE = 0.001
COST_MIS = 0.0003
COST_CNC = 0.0013

def build_point_in_time_universe():
    print("Building point-in-time universe...")
    with open(DAILY_STORE, 'rb') as f:
        import pickle
        store = pickle.load(f)
    return store

def extract_candidate_events():
    print("Extracting candidate events...")
    log_files = sorted(glob.glob(os.path.join(LOGS_DIR, 'btst_preview_log_*.jsonl')))
    records = []
    
    for lf in log_files:
        date_str = lf.split('_')[-1].replace('.jsonl', '')
        try:
            with open(lf, 'r') as f:
                for line in f:
                    try:
                        data = json.loads(line)
                    except:
                        continue
                    as_of = data.get('asOf')
                    if not as_of: continue
                    
                    timestamp = pd.to_datetime(as_of.replace(' IST', ''))
                    scores_dict = {}
                    for row in data.get('ens20', []): scores_dict[row[0]] = row[1]
                    for row in data.get('top20', []): 
                        if row[0] not in scores_dict: scores_dict[row[0]] = row[1]
                    
                    signals = data.get('diagnostics', {}).get('signals', [])
                    for sig in signals:
                        sym = sig.get('symbol')
                        ohlcv = sig.get('ohlcv', {})
                        imm_px = ohlcv.get('price')
                        if not imm_px: continue
                        score = scores_dict.get(sym, 0.0)
                        records.append({
                            'date': pd.to_datetime(date_str).date(),
                            'timestamp': timestamp,
                            'symbol': sym,
                            'score': score,
                            'imm_px': imm_px,
                        })
        except Exception as e:
            print(f"Error reading {lf}: {e}")
            
    df = pd.DataFrame(records)
    if not df.empty:
        df = df.sort_values(['date', 'timestamp']).drop_duplicates(subset=['date', 'timestamp', 'symbol'])
    return df

def annotate_observation_intervals(population):
    frame = population.sort_values(['symbol', 'timestamp']).copy()
    frame['past_interval_minutes'] = frame.groupby(['symbol', 'date']).timestamp.diff().dt.total_seconds() / 60
    frame['contiguous_5m'] = frame.past_interval_minutes.eq(5)
    frame['contiguous_5m_return'] = frame.past_observation_return.where(frame.contiguous_5m)
    return frame


def extract_historical_events(directory=INTRADAY_DIR):
    """Enumerate every valid completed observation, without outcome-based selection.

    This is a research population, not a trading recommendation. File membership
    remains subject to survivorship bias. Features use only earlier same-session
    observations; no future availability filter is applied.
    """
    parts, errors = [], []
    for filename in sorted(glob.glob(os.path.join(directory, '*.csv'))):
        if filename.endswith('.1d.csv'):
            continue
        try:
            bars = pd.read_csv(filename, usecols=['Date', 'Close'])
            bars['timestamp'] = pd.to_datetime(bars['Date']) + BAR_DURATION
            bars['imm_px'] = pd.to_numeric(bars['Close'], errors='coerce')
            if bars.timestamp.duplicated().any():
                raise ValueError('duplicate timestamps')
            bars = bars.sort_values('timestamp')
            bars = bars[np.isfinite(bars.imm_px) & (bars.imm_px > 0)].copy()
            bars['date'] = bars.timestamp.dt.date
            bars['symbol'] = os.path.basename(filename)[:-4]
            bars['past_observation_return'] = bars.groupby('date').imm_px.pct_change(fill_method=None)
            bars['source'] = 'historical_observation'
            bars = annotate_observation_intervals(bars)
            parts.append(bars[['date', 'timestamp', 'symbol', 'imm_px',
                               'past_observation_return', 'source', 'past_interval_minutes', 'contiguous_5m', 'contiguous_5m_return']])
        except Exception as error:
            errors.append({'file': filename, 'reason': str(error)})
    columns = ['date', 'timestamp', 'symbol', 'imm_px', 'past_observation_return', 'source',
               'past_interval_minutes', 'contiguous_5m', 'contiguous_5m_return']
    events = pd.concat(parts, ignore_index=True) if parts else pd.DataFrame(columns=columns)
    return events.sort_values(['timestamp', 'symbol']), pd.DataFrame(errors, columns=['file', 'reason'])

def equity_population(population, metadata):
    """Dated classification, independent of future price/outcome availability."""
    classified = population.merge(metadata[['date', 'symbol', 'series', 'asset_class']],
                                  on=['date', 'symbol'], how='left', validate='many_to_one')
    return classified[(classified.series == 'EQ') &
                      (classified.asset_class == 'common_equity')].copy()


def select_historical_candidates(population, selection="first_available", metadata=None):
    if selection not in ("first_available", "first_informative", "contiguous_5m"):
        raise ValueError("Unknown selection hypothesis")
    """Frozen exploratory hypotheses: strongest/weakest previous observation return.

    Take the first eligible cross-section in each session, one name per rule.
    This computational research budget is not a proposed capital allocation.
    Selection never ranks future outcomes or chooses the best time of the day.
    """
    if metadata is not None:
        population = equity_population(population, metadata)
    if selection == 'contiguous_5m':
        population = annotate_observation_intervals(population)
        population = population[population.contiguous_5m].copy()
    valid = population.dropna(subset=['past_observation_return']).copy()
    valid = valid.sort_values(['timestamp', 'symbol'])
    selected = []
    for date, session in valid.groupby('date'):
        if selection in ('first_informative', 'contiguous_5m'):
            breadth = session.groupby('timestamp').agg(breadth=('symbol', 'nunique'),
                low=('past_observation_return', 'min'), high=('past_observation_return', 'max'))
            eligible = breadth[(breadth.breadth >= 2) & (breadth.high > breadth.low)]
            if eligible.empty:
                continue
            selection_time = eligible.index[0]
        else:
            selection_time = session.timestamp.min()
        first = session[session.timestamp == selection_time]
        for rule, ascending in [('momentum', False), ('reversal', True)]:
            pick = first.sort_values('past_observation_return', ascending=ascending,
                                     kind='stable').iloc[[0]].copy()
            pick['hypothesis'] = rule
            pick['selection'] = selection
            pick['selection_breadth'] = first.symbol.nunique()
            pick['feature_dispersion'] = first.past_observation_return.max() - first.past_observation_return.min()
            pick['degenerate'] = (pick.selection_breadth < 2) | (pick.feature_dispersion == 0)
            selected.append(pick)
    columns = list(population.columns) + ['hypothesis', 'selection', 'selection_breadth', 'feature_dispersion', 'degenerate']
    return pd.concat(selected, ignore_index=True) if selected else pd.DataFrame(columns=columns)


def historical_attempt_ledger(candidates, outcomes):
    active = candidates[candidates.partition != 'purge'].copy()
    dimensions = pd.DataFrame([(mode, delay, horizon)
        for mode in ('common_endpoint', 'equal_duration') for delay in (0, 15)
        for horizon in ('5m', '15m', '60m', 'eod', 't1', 't2')],
        columns=['comparison', 'delay_minutes', 'horizon'])
    attempts = active.merge(dimensions, how='cross')
    keys = ['date', 'timestamp', 'symbol', 'hypothesis', 'comparison', 'delay_minutes', 'horizon']
    observed = outcomes[keys + ['status', 'net_return']]
    if not observed.status.isin(['price_proxy', 'policy_no_trade']).all():
        raise ValueError('Unknown or missing observed outcome status')
    if attempts[keys].isna().any().any() or observed[keys].isna().any().any():
        raise ValueError('Missing attempt or outcome identity')
    ledger = attempts.merge(observed, on=keys, how='outer', validate='one_to_one', indicator=True)
    if (ledger['_merge'] == 'right_only').any():
        raise ValueError('Outcome has no matching attempted candidate')
    ledger = ledger.drop(columns='_merge')
    ledger['status'] = ledger.status.fillna('unavailable')
    return ledger


def export_historical_diagnostics(candidates, outcomes):
    ledger = historical_attempt_ledger(candidates, outcomes)
    ledger.to_csv('dev/track1_historical_attempts.csv', index=False)
    groups = ['hypothesis', 'partition', 'degenerate', 'comparison', 'delay_minutes', 'horizon']
    coverage = ledger.groupby(groups).status.value_counts().unstack(fill_value=0)
    coverage = coverage.reindex(columns=['price_proxy', 'policy_no_trade', 'unavailable'], fill_value=0)
    coverage['attempted'] = coverage.sum(axis=1)
    coverage.to_csv('dev/track1_historical_coverage_by_hypothesis.csv')
    separate = outcomes.merge(candidates[['date', 'timestamp', 'symbol', 'hypothesis', 'degenerate']],
                              on=['date', 'timestamp', 'symbol', 'hypothesis'], validate='many_to_one')
    separate.groupby(groups).agg(observed=('net_return', 'size'), mean_net=('net_return', 'mean')).to_csv(
        'dev/track1_historical_results_by_degeneracy.csv')
    print(f'Attempt ledger: {len(ledger)}; unavailable {(ledger.status == "unavailable").sum()}; '
          f'degenerate candidate rows {int(candidates.degenerate.sum())}', flush=True)


def historical_session_ledger(calendar, candidates, outcomes):
    """Use frozen experiment partitions; account valuation remains separate."""
    calendar = calendar[['date', 'partition']].copy()
    if calendar.date.isna().any() or calendar.date.duplicated().any():
        raise ValueError('Invalid session calendar dates')
    if not calendar.partition.isin(['development', 'holdout', 'purge']).all():
        raise ValueError('Invalid session partition')
    sessions = calendar.merge(pd.DataFrame({'hypothesis': ['momentum', 'reversal']}), how='cross')
    picks = candidates[['date', 'hypothesis', 'timestamp', 'symbol', 'partition']].rename(
        columns={'partition': 'candidate_partition'})
    sessions = sessions.merge(picks, on=['date', 'hypothesis'], how='outer',
                              validate='one_to_one', indicator=True)
    if (sessions['_merge'] == 'right_only').any():
        raise ValueError('Candidate outside session calendar')
    selected = sessions['_merge'] == 'both'
    if (sessions.loc[selected, 'partition'] != sessions.loc[selected, 'candidate_partition']).any():
        raise ValueError('Candidate partition disagrees with frozen calendar')
    sessions = sessions.drop(columns='candidate_partition')
    sessions['selection_status'] = np.where(sessions['_merge'] == 'both', 'selected', 'no_selection')
    sessions = sessions.drop(columns='_merge')
    sessions.loc[sessions.partition == 'purge', 'selection_status'] = 'purged'
    dimensions = pd.DataFrame([(mode, delay, horizon)
        for mode in ('common_endpoint', 'equal_duration') for delay in (0, 15)
        for horizon in ('5m', '15m', '60m', 'eod', 't1', 't2')],
        columns=['comparison', 'delay_minutes', 'horizon'])
    ledger = sessions.merge(dimensions, how='cross')
    attempts = historical_attempt_ledger(candidates, outcomes)
    keys = ['date', 'hypothesis', 'comparison', 'delay_minutes', 'horizon']
    ledger = ledger.merge(attempts[keys + ['status']], on=keys, how='left', validate='one_to_one')
    ledger['execution_status'] = ledger.status.fillna(ledger.selection_status)
    ledger['account_return'] = np.nan
    return ledger.drop(columns='status')


def evaluate_historical_candidates(selection="first_available"):
    population = pd.read_csv('dev/track1_historical_events.csv', parse_dates=['timestamp'])
    population['date'] = pd.to_datetime(population['date']).dt.date
    population = annotate_observation_intervals(population)
    candidates = select_historical_candidates(population, selection)
    dates = sorted(population.date.unique())
    split = int(len(dates) * .7)
    # Two intervening sessions purge T+2 label overlap at the split.
    development, holdout = set(dates[:max(0, split - 2)]), set(dates[split:])
    candidates['partition'] = candidates.date.map(
        lambda d: 'development' if d in development else 'holdout' if d in holdout else 'purge')
    candidates.to_csv('dev/track1_historical_candidates.csv', index=False)
    calendar = pd.DataFrame({'date': dates})
    calendar['partition'] = calendar.date.map(
        lambda d: 'development' if d in development else 'holdout' if d in holdout else 'purge')
    calendar.to_csv('dev/track1_historical_sessions.csv', index=False)
    events = candidates[candidates.partition != 'purge'].drop_duplicates(['date', 'timestamp', 'symbol'])
    store = build_point_in_time_universe()
    frames = []
    for mode in ('common_endpoint', 'equal_duration'):
        frame, coverage = simulate_execution_and_alpha(events, store, mode)
        print(mode, coverage, flush=True)
        if not frame.empty:
            frames.append(frame)
    if not frames:
        empty = pd.DataFrame(columns=['date', 'timestamp', 'symbol', 'hypothesis', 'comparison',
                                      'delay_minutes', 'horizon', 'status', 'net_return'])
        historical_session_ledger(calendar, candidates, empty).to_csv(
            'dev/track1_historical_session_ledger.csv', index=False)
        print('No historical outcomes available; session coverage exported')
        return
    outcomes = pd.concat(frames, ignore_index=True).merge(
        candidates[['date', 'timestamp', 'symbol', 'hypothesis', 'partition']],
        on=['date', 'timestamp', 'symbol'], how='left', validate='many_to_many')
    outcomes.to_csv('dev/track1_historical_outcomes.csv', index=False)
    export_historical_diagnostics(candidates, outcomes)
    historical_session_ledger(calendar, candidates, outcomes).to_csv('dev/track1_historical_session_ledger.csv', index=False)
    summaries = []
    for key, group in outcomes.groupby(['hypothesis', 'partition', 'comparison', 'delay_minutes', 'horizon']):
        r = group.net_return
        losses = -r[r < 0].sum()
        summaries.append(dict(zip(['hypothesis', 'partition', 'comparison', 'delay_minutes', 'horizon'], key),
                              n=len(group), sessions=group.date.nunique(), mean_net=r.mean(),
                              win_rate=(r > 0).mean(), profit_factor=r[r > 0].sum()/losses if losses else np.nan,
                              alpha=group.alpha.mean(), alpha_se=block_se(group.dropna(subset=['alpha']), 'alpha')))
    summary = pd.DataFrame(summaries)
    summary.to_csv('dev/track1_historical_summary.csv', index=False)
    print(f'{len(candidates)} candidates; {len(outcomes)} outcomes; '
          f'{len(development)} development and {len(holdout)} holdout sessions. '
          'Frozen exploratory rules; observation metrics, no account benchmark claim.', flush=True)
    print(summary[(summary.partition == 'holdout') & (summary.comparison == 'equal_duration') &
                  (summary.delay_minutes == 0)].to_string(index=False))

# Development price-proxy study: no depth evidence or broker fills are inferred.
# Close observations are delayed 5 minutes to conservatively accommodate start-labelled bars.
BAR_DURATION = pd.Timedelta(minutes=5)
MAX_GAP = pd.Timedelta(minutes=5)

def net_return(entry, exit_price, cost):
    return exit_price * (1 - SLIPPAGE) * (1 - cost) / (entry * (1 + SLIPPAGE)) - 1

def matched_control(entries, exits, cost):
    valid = entries.notna() & exits.notna() & (entries > 0) & (exits > 0)
    return net_return(entries[valid], exits[valid], cost).median(), int(valid.sum())

def block_se(frame, column, block_days=3):
    # Bootstrap contiguous blocks of session totals/counts, preserving event weighting.
    daily = frame.groupby('date')[column].agg(['sum', 'count'])
    if len(daily) < 2 * block_days:
        return np.nan
    rng = np.random.default_rng(1494)
    estimates = []
    for _ in range(1000):
        indices = []
        while len(indices) < len(daily):
            start = rng.integers(0, len(daily) - block_days + 1)
            indices.extend(range(start, start + block_days))
        sample = daily.iloc[indices[:len(daily)]]
        estimates.append(sample['sum'].sum() / sample['count'].sum())
    return np.std(estimates, ddof=1)

def simulate_execution_and_alpha(events_df, daily_store, comparison="common_endpoint"):
    if comparison not in ("common_endpoint", "equal_duration"):
        raise ValueError("unknown comparison")
    data = {}
    errors = []
    for filename in sorted(glob.glob(os.path.join(INTRADAY_DIR, '*.csv'))):
        try:
            bars = pd.read_csv(filename)
            times = pd.to_datetime(bars['Date']) + BAR_DURATION
            series = pd.Series(pd.to_numeric(bars['Close'], errors='coerce').values, index=times)
            if series.index.has_duplicates:
                raise ValueError('duplicate timestamps')
            data[os.path.basename(filename)[:-4]] = series.sort_index()
        except Exception as error:
            errors.append({'file': filename, 'reason': str(error)})
    closes = daily_store['Close'].copy()
    closes.index = pd.to_datetime(closes.index).normalize()
    closes = closes.sort_index()
    sessions = closes.index.unique()
    results, missing = [], []
    for date, events in events_df.groupby('date'):
        start = pd.Timestamp(date)
        end = start + pd.Timedelta(days=1)
        day_parts = {}
        for symbol, series in data.items():
            subset = series.iloc[series.index.searchsorted(start):series.index.searchsorted(end)]
            if not subset.empty:
                day_parts[symbol] = subset
        if not day_parts:
            for _, event in events.iterrows():
                for delay in (0, 15):
                    missing.append({'symbol': event['symbol'], 'decision': event['timestamp'] + pd.Timedelta(minutes=delay),
                                    'reason': 'no intraday observations for session'})
            continue
        day = pd.concat(day_parts, axis=1).sort_index()
        for _, event in events.iterrows():
            symbol = event['symbol']
            candidate = day[symbol].dropna() if symbol in day else pd.Series(dtype=float, index=pd.DatetimeIndex([]))
            candidate = candidate[np.isfinite(candidate) & (candidate > 0)]
            baseline_rows = candidate[candidate.index > event['timestamp']]
            baseline_entry = (baseline_rows.index[0] if not baseline_rows.empty
                              and baseline_rows.index[0] - event['timestamp'] <= MAX_GAP else pd.NaT)
            for delay in (0, 15):
                decision = event['timestamp'] + pd.Timedelta(minutes=delay)
                # Policy skips are known from the decision clock, regardless of later price coverage.
                for horizon in ('5m', '15m', '60m', 'eod'):
                    endpoint = (pd.Timestamp(date) + pd.Timedelta(hours=15, minutes=30)
                                if horizon == 'eod' else baseline_entry + pd.Timedelta(minutes=int(horizon[:-1])))
                    if comparison == 'common_endpoint' and not pd.isna(endpoint) and decision >= endpoint:
                        results.append({'date': date, 'timestamp': event['timestamp'], 'symbol': symbol,
                                        'delay_minutes': delay, 'horizon': horizon, 'comparison': comparison,
                                        'entry_time': pd.NaT, 'exit_time': endpoint, 'net_return': 0.0,
                                        'control_return': np.nan, 'alpha': np.nan, 'control_count': 0,
                                        'status': 'policy_no_trade'})
                entry_rows = candidate[candidate.index > decision]
                if entry_rows.empty or entry_rows.index[0] - decision > MAX_GAP:
                    missing.append({'symbol': event['symbol'], 'decision': decision, 'reason': 'entry coverage'})
                    continue
                entry_time = entry_rows.index[0]
                entries = day.loc[entry_time]
                symbol = event['symbol']
                if symbol not in entries or not np.isfinite(entries[symbol]) or entries[symbol] <= 0:
                    missing.append({'symbol': symbol, 'decision': decision, 'reason': 'missing symbol entry'})
                    continue
                for horizon in ('5m', '15m', '60m', 'eod', 't1', 't2'):
                    endpoint = (pd.Timestamp(date) + pd.Timedelta(hours=15, minutes=30)
                                if horizon == 'eod' else baseline_entry + pd.Timedelta(minutes=int(horizon[:-1]))) if horizon not in ('t1', 't2') else pd.NaT
                    if comparison == 'common_endpoint' and not pd.isna(endpoint) and decision >= endpoint:
                        continue
                    cost = COST_MIS if horizon not in ('t1', 't2') else COST_CNC
                    if horizon in ('t1', 't2'):
                        future = sessions[sessions.date > date]
                        offset = int(horizon[1:]) - 1
                        if len(future) <= offset:
                            exits, exit_time = pd.Series(dtype=float), pd.NaT
                        else:
                            exit_time = future[offset]
                            exits = closes.loc[exit_time]
                    else:
                        target = (pd.Timestamp(date) + pd.Timedelta(hours=15, minutes=30)
                                  if horizon == 'eod' else (baseline_entry if comparison == 'common_endpoint' else entry_time) + pd.Timedelta(minutes=int(horizon[:-1])))
                        # A shared endpoint isolates entry timing. Waiting beyond it means no trade.
                        if pd.isna(target) or target <= entry_time:
                            if not pd.isna(target):
                                results.append({'date': date, 'timestamp': event['timestamp'], 'symbol': symbol,
                                                'delay_minutes': delay, 'horizon': horizon, 'comparison': comparison,
                                                'entry_time': pd.NaT, 'exit_time': target, 'net_return': 0.0,
                                                'control_return': np.nan, 'alpha': np.nan, 'control_count': 0,
                                                'status': 'policy_no_trade'})
                            else:
                                missing.append({'symbol': symbol, 'decision': decision, 'horizon': horizon,
                                                'reason': 'missing baseline endpoint'})
                            continue
                        rows = candidate[candidate.index >= target]
                        if rows.empty or rows.index[0] - target > MAX_GAP:
                            exits, exit_time = pd.Series(dtype=float), pd.NaT
                        else:
                            exit_time = rows.index[0]
                            exits = day.loc[exit_time]
                    common = entries.index.intersection(exits.index).difference([symbol])
                    control, count = matched_control(entries.reindex(common), exits.reindex(common), cost)
                    if symbol not in exits or not np.isfinite(exits[symbol]) or exits[symbol] <= 0 :
                        missing.append({'symbol': symbol, 'decision': decision, 'horizon': horizon, 'reason': 'outcome coverage'})
                        continue
                    result = net_return(entries[symbol], exits[symbol], cost)
                    results.append({'date': date, 'timestamp': event['timestamp'], 'symbol': symbol,
                                    'delay_minutes': delay, 'horizon': horizon, 'comparison': comparison, 'entry_time': entry_time,
                                    'exit_time': exit_time, 'net_return': result, 'control_return': control,
                                    'alpha': result - control, 'control_count': count, 'status': 'price_proxy'})
    pd.DataFrame(missing).to_csv(f'dev/track1_missing_coverage_{comparison}.csv', index=False)
    pd.DataFrame(errors).to_csv('dev/track1_file_errors.csv', index=False)
    return pd.DataFrame(results), {'events': len(events_df), 'missing': len(missing), 'file_errors': len(errors)}

def validate_out_of_sample(frame, coverage):
    print('DEVELOPMENT ONLY: legacy signals; available-file control, historical membership unverified.')
    print('Close-price proxies, assumed 5-minute availability delay; no depth/fill verification.')
    print('Fee rates are sensitivity assumptions, not reconciled historical charges; no account replay.')
    print('Common endpoints anchored to immediate entry; delayed entries after endpoint are zero-return cash outcomes.')
    print('Win/PF describe overlapping equal-weight observations, not funded account trades.')
    print('Policy returns include cash no-trades; alpha uses observed trades only. Missing evidence is excluded explicitly.')
    print(coverage)
    if frame.empty:
        print('No matched outcomes')
        return
    for (comparison, delay, horizon), group in frame.groupby(['comparison', 'delay_minutes', 'horizon']):
        returns = group.net_return
        losses = -returns[returns < 0].sum()
        pf = returns[returns > 0].sum() / losses if losses else np.nan
        se = block_se(group.dropna(subset=['alpha']), 'alpha')
        print(f'{comparison} delay={delay} {horizon}: n={len(group)} sessions={group.date.nunique()} '
              f'no_trade={(group.status == "policy_no_trade").sum()} net={returns.mean():.4%} alpha={group.alpha.mean():.4%} '
              f'block SE={se:.4%} (unavailable if fewer than 6 sessions) win={(returns > 0).mean():.2%} PF={pf:.3f}')
    frame.to_csv('dev/track1_timing_edge_results.csv', index=False)
    paired = frame.pivot_table(index=['date','timestamp','symbol','horizon','comparison'], columns='delay_minutes', values='net_return')
    if 0 in paired and 15 in paired:
        paired = paired.dropna(subset=[0,15])
        paired['delayed_minus_immediate'] = paired[15] - paired[0]
        paired.to_csv('dev/track1_paired_timing.csv')
        print(f'Matched delay comparisons: {len(paired)}; unmatched outcomes remain in coverage report.')

def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--screen-multibar', action='store_true')
    parser.add_argument('--sample-history', action='store_true',
                        help='Export the full causal observation population and coverage; no strategy fit')
    parser.add_argument('--interval-audit', action='store_true', help='Audit recorded picks without changing selection')
    parser.add_argument('--diagnose-history', action='store_true', help='Reconcile recorded outcomes without rerunning prices')
    parser.add_argument('--evaluate-history', action='store_true')
    parser.add_argument('--selection', choices=['first_available', 'first_informative', 'contiguous_5m'], default='first_available')
    args = parser.parse_args()
    if args.screen_multibar:
        from track1_multibar_screen import main as screen
        screen()
        return
    if args.interval_audit:
        population = pd.read_csv('dev/track1_historical_events.csv', parse_dates=['timestamp'])
        population['date'] = pd.to_datetime(population.date).dt.date
        population = annotate_observation_intervals(population)
        candidates = pd.read_csv('dev/track1_historical_candidates.csv', parse_dates=['timestamp'])
        keys = ['timestamp', 'symbol']
        audited = candidates.drop(columns=['past_interval_minutes', 'contiguous_5m', 'contiguous_5m_return'], errors='ignore').merge(
            population[keys + ['past_interval_minutes', 'contiguous_5m', 'contiguous_5m_return']],
            on=keys, how='left', validate='many_to_one')
        audited.to_csv('dev/track1_candidate_interval_audit.csv', index=False)
        population.groupby(['date', 'contiguous_5m']).size().to_csv('dev/track1_population_interval_coverage.csv')
        print(f'Interval audit: {len(audited)} picks; contiguous 5m {int(audited.contiguous_5m.fillna(False).sum())}; '
              f'unknown interval {int(audited.past_interval_minutes.isna().sum())}')
        return
    if args.diagnose_history:
        candidates = pd.read_csv('dev/track1_historical_candidates.csv', parse_dates=['timestamp'])
        candidates['date'] = pd.to_datetime(candidates.date).dt.date
        outcomes = pd.read_csv('dev/track1_historical_outcomes.csv', parse_dates=['timestamp'])
        outcomes['date'] = pd.to_datetime(outcomes.date).dt.date
        export_historical_diagnostics(candidates, outcomes)
        calendar = pd.read_csv('dev/track1_historical_sessions.csv')
        calendar['date'] = pd.to_datetime(calendar.date).dt.date
        historical_session_ledger(calendar, candidates, outcomes).to_csv('dev/track1_historical_session_ledger.csv', index=False)
        return
    if args.evaluate_history:
        # Preserve each earlier experiment before generating the next results.
        from pathlib import Path
        import shutil
        from datetime import datetime, timezone
        archive = Path('dev/track1_experiments') / datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%f')
        archive.mkdir(parents=True)
        for path in Path('dev').glob('track1_historical_*.csv'):
            if path.name != 'track1_historical_events.csv':
                shutil.copy2(path, archive / path.name)
        (archive / 'next_hypothesis.txt').write_text(
            args.selection + '\nAll previously inspected dates are development evidence; no fresh final validation.\n')
        evaluate_historical_candidates(args.selection)
        return
    if args.sample_history:
        events, errors = extract_historical_events()
        events.to_csv('dev/track1_historical_events.csv', index=False)
        errors.to_csv('dev/track1_historical_file_errors.csv', index=False)
        coverage = events.groupby('date').agg(observations=('symbol', 'size'), symbols=('symbol', 'nunique'))
        coverage.to_csv('dev/track1_historical_coverage.csv')
        print(f'Historical population: {len(events)} observations, {len(coverage)} sessions, '
              f'{events.symbol.nunique()} symbols; {len(errors)} file errors. Development only.')
        return
    store = build_point_in_time_universe()
    events = extract_candidate_events()
    if events.empty:
        print('No events')
        return
    frames, coverage = [], {}
    for mode in ('common_endpoint', 'equal_duration'):
        frame, report = simulate_execution_and_alpha(events, store, mode)
        frames.append(frame); coverage[mode] = report
    validate_out_of_sample(pd.concat(frames, ignore_index=True), coverage)

if __name__ == '__main__':
    main()
