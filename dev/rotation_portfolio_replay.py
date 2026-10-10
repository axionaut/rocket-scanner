import os, json, glob
import pandas as pd
from collections import deque
from full_history_audit import load_data, match_fifo

UP = os.path.join(os.path.dirname(__file__), '..', 'Scanner Uploads')
COST = 0.38
TARGET = 3.0 # Baseline +3%
INITIAL_CAPITAL = 1000000.0 # 10 Lakhs assumption for base capital

bars_cache = {}
def bars(sym):
    if sym not in bars_cache:
        f = os.path.join(UP, 'Intraday', sym + '.csv')
        df = pd.read_csv(f) if os.path.exists(f) else pd.DataFrame(columns=['Date', 'Open', 'High', 'Low', 'Close', 'Volume'])
        if not df.empty:
            df['Date'] = pd.to_datetime(df['Date'])
            df = df.sort_values('Date').reset_index(drop=True)
            df['Day'] = df['Date'].dt.normalize()
        bars_cache[sym] = df
    return bars_cache[sym]

def get_inherited_state(df, cutoff_date='2026-09-18'):
    df['exec_dt'] = pd.to_datetime(df['order_execution_time'])
    past_df = df[df['exec_dt'] < pd.Timestamp(cutoff_date)].copy()
    
    trades_df, open_pos, unreconciled = match_fifo(past_df)
    
    realized_pnl = trades_df['pnl'].sum() if not trades_df.empty else 0
    open_cost = 0
    for sym, lots in open_pos.items():
        for lot in lots:
            open_cost += lot['qty'] * lot['price']
            
    cash = INITIAL_CAPITAL + realized_pnl - open_cost
    
    inherited = []
    for sym, lots in open_pos.items():
        for lot in lots:
            inherited.append({
                'symbol': sym,
                'qty': lot['qty'],
                'entry_price': lot['price'],
                'entry_date': pd.Timestamp(lot['date'])
            })
    return cash, inherited

def exit_baseline(sym, entry, entry_date):
    df = bars(sym)
    if df.empty: return None, None
    path = df[df.Date > pd.Timestamp(entry_date) + pd.Timedelta(hours=15)]
    if path.empty: return None, None
    tgt = entry * 1.03
    for _, b in path.iterrows():
        if b.High > tgt:
            px = max(b.Open, tgt) if b.Open > tgt else tgt
            return b.Date, px / entry * 100 - 100 - COST
    return None, None # Still open

def exit_candidate(sym, entry, entry_date):
    # Pure T+2 session close expiry
    df = bars(sym)
    if df.empty: return None, None
    dt_ts = pd.Timestamp(entry_date).normalize()
    # Find unique days after entry
    unique_days = df[df.Day > dt_ts].Day.unique()
    if len(unique_days) >= 2:
        t2_day = unique_days[1]
        path_t2 = df[df.Day == t2_day]
        if not path_t2.empty:
            b = path_t2.iloc[-1] # Close of T+2 session
            return b.Date, b.Close / entry * 100 - 100 - COST
    return None, None # Still open

def load_preview_logs():
    files = sorted(glob.glob(os.path.join(UP, 'btst_preview_log_*.jsonl')))
    sigs = []
    for f in files:
        dt = f.split('_')[-1].replace('.jsonl', '')
        if dt > '2026-10-09': continue
        
        last_data = None
        with open(f, 'r') as fp:
            for line in fp:
                if not line.strip(): continue
                data = json.loads(line)
                if data.get('gateOn'):
                    last_data = data
                    
        if last_data and 'top20' in last_data:
            # Get the day's close price for entry
            for r in last_data['top20']:
                sym = r[0]
                score = r[1]
                
                if score > 0:
                    df = bars(sym)
                    if df.empty: continue
                    dt_ts = pd.Timestamp(dt).normalize()
                    path = df[df.Day == dt_ts]
                    if not path.empty:
                        px = path.iloc[-1].Close
                        sigs.append({
                            'symbol': sym,
                            'day': dt,
                            'score': score,
                            'price': px
                        })
                        
    # Group by day, sort by score desc
    daily_sigs = {}
    for s in sigs:
        daily_sigs.setdefault(s['day'], []).append(s)
    for d in daily_sigs:
        daily_sigs[d].sort(key=lambda x: x['score'], reverse=True)
    return daily_sigs

def mark_to_market(open_pos, date_str='2026-10-09'):
    # Mark to market on specific date
    mtm_val = 0
    mtm_pnl = 0
    dt = pd.Timestamp(date_str).normalize()
    for o in open_pos:
        df = bars(o['sym'])
        if df.empty: continue
        path = df[df.Day <= dt]
        px = o['entry']
        if not path.empty:
            px = path.iloc[-1].Close
        val = o['amt'] * (px / o['entry'])
        mtm_val += val
        mtm_pnl += val - o['amt']
    return mtm_val, mtm_pnl

def run_portfolio(daily_sigs, initial_cash, inherited_holdings, use_candidate_for_new=False, exclude_sig_id=None):
    cash = initial_cash
    open_pos = []
    trade_profits_new = []
    
    # Load inherited
    for h in inherited_holdings:
        amt = h['qty'] * h['entry_price']
        exit_dt, ret = exit_baseline(h['symbol'], h['entry_price'], h['entry_date'])
        open_pos.append({
            'sym': h['symbol'],
            'amt': amt,
            'entry': h['entry_price'],
            'entry_date': h['entry_date'],
            'exit_date': exit_dt,
            'ret': ret,
            'is_new': False,
            'sig_id': None
        })
        
    days = sorted(list(daily_sigs.keys()))
    for d in days:
        if d > '2026-10-09': break
        t = pd.Timestamp(d).normalize()
        
        # Process exits today before allocating
        # exit_date is a Timestamp with time, so we compare its normalize() to t
        closed = [o for o in open_pos if o['exit_date'] is not None and o['exit_date'].normalize() <= t]
        for o in closed:
            profit = o['amt'] * (o['ret'] / 100)
            cash += o['amt'] + profit
            if o['is_new']:
                trade_profits_new.append(profit)
            open_pos.remove(o)
            
        # Allocate to new signals
        equity = cash + sum(o['amt'] for o in open_pos)
        
        for s in daily_sigs[d]:
            sig_id = f"{s['symbol']}_{d}"
            if sig_id == exclude_sig_id: continue
            
            amt = min(cash, equity / 5)
            if amt < 5000: continue
            
            cash -= amt
            
            if use_candidate_for_new:
                exit_dt, ret = exit_candidate(s['symbol'], s['price'], d)
            else:
                exit_dt, ret = exit_baseline(s['symbol'], s['price'], d)
                
            open_pos.append({
                'sym': s['symbol'],
                'amt': amt,
                'entry': s['price'],
                'entry_date': t,
                'exit_date': exit_dt,
                'ret': ret,
                'is_new': True,
                'sig_id': sig_id
            })
            
    mtm_val, mtm_pnl = mark_to_market(open_pos, '2026-10-09')
    final_eq = cash + mtm_val
    
    # Calculate MTM specifically for new trades that are open
    new_mtm = 0
    for o in open_pos:
        if o['is_new']:
            df = bars(o['sym'])
            if not df.empty:
                path = df[df.Day <= pd.Timestamp('2026-10-09').normalize()]
                if not path.empty:
                    last_px = path.iloc[-1].Close
                    new_mtm += o['amt'] * (last_px / o['entry'] - 1)
                  
    total_new_profit = sum(trade_profits_new) + new_mtm
    
    return final_eq, total_new_profit, trade_profits_new

if __name__ == '__main__':
    print("Loading tradebook for inherited state...")
    df, store = load_data()
    initial_cash, inherited = get_inherited_state(df, '2026-09-18')
    print(f"Inherited Cash: Rs {initial_cash:,.2f}")
    print(f"Inherited Holdings: {len(inherited)}")
    
    daily_sigs = load_preview_logs()
    
    print("\nRunning Baseline Portfolio (Target Only)...")
    base_eq, base_new_profit, base_trades = run_portfolio(daily_sigs, initial_cash, inherited, False)
    
    print("Running Candidate Portfolio (T+2 Close Expiry on New)...")
    cand_eq, cand_new_profit, cand_trades = run_portfolio(daily_sigs, initial_cash, inherited, True)
    
    def get_taken_sigs(daily_sigs, initial_cash, inherited, use_candidate):
        cash = initial_cash
        open_pos = []
        taken = []
        
        for h in inherited:
            exit_dt, ret = exit_baseline(h['symbol'], h['entry_price'], h['entry_date'])
            open_pos.append({'sym': h['symbol'], 'amt': h['qty']*h['entry_price'], 'exit_date': exit_dt, 'ret': ret})
            
        days = sorted(list(daily_sigs.keys()))
        for d in days:
            if d > '2026-10-09': break
            t = pd.Timestamp(d).normalize()
            closed = [o for o in open_pos if o['exit_date'] is not None and o['exit_date'].normalize() <= t]
            for o in closed:
                cash += o['amt'] + o['amt'] * (o['ret'] / 100)
                open_pos.remove(o)
                
            equity = cash + sum(o['amt'] for o in open_pos)
            for s in daily_sigs[d]:
                sig_id = f"{s['symbol']}_{d}"
                amt = min(cash, equity / 5)
                if amt < 5000: continue
                cash -= amt
                
                if use_candidate: exit_dt, ret = exit_candidate(s['symbol'], s['price'], d)
                else: exit_dt, ret = exit_baseline(s['symbol'], s['price'], d)
                
                open_pos.append({'sym': s['symbol'], 'amt': amt, 'exit_date': exit_dt, 'ret': ret})
                taken.append(sig_id)
        return taken

    cand_taken = get_taken_sigs(daily_sigs, initial_cash, inherited, True)
    
    max_adv_n1 = float('inf') # We want min advantage to see true robustness
    worst_sig = None
    
    print("\nRunning True N-1 Re-allocations for candidate trades...")
    if cand_taken:
        for sig_id in cand_taken:
            b_eq, b_np, _ = run_portfolio(daily_sigs, initial_cash, inherited, False, exclude_sig_id=sig_id)
            c_eq, c_np, _ = run_portfolio(daily_sigs, initial_cash, inherited, True, exclude_sig_id=sig_id)
            
            adv = c_np - b_np
            if adv < max_adv_n1:
                max_adv_n1 = adv
                worst_sig = sig_id
    else:
        max_adv_n1 = 0
        worst_sig = "None"

    adv = cand_new_profit - base_new_profit
    print(f"\n--- Bounded Replay Results (18 Sep - 09 Oct 2026) ---")
    print(f"Final Equity (Baseline)  : Rs {base_eq:,.2f}")
    print(f"Final Equity (Candidate) : Rs {cand_eq:,.2f}")
    print(f"New Trades PnL (Base)    : Rs {base_new_profit:,.2f}")
    print(f"New Trades PnL (Cand)    : Rs {cand_new_profit:,.2f}")
    print(f"Advantage (Total PnL)    : Rs {adv:,.2f}")
    print(f"Advantage (True N-1)     : Rs {max_adv_n1:,.2f} (When excluding {worst_sig})")
    
    if max_adv_n1 > 0:
        print("\nConclusion: Candidate provides systemic alpha (N-1 advantage is positive).")
    else:
        print("\nConclusion: Candidate fails N-1 robustness check.")
