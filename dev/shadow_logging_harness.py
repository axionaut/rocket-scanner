import json
import os
from datetime import datetime
import pandas as pd

SHADOW_STATE_FILE_BASE = 'Scanner Uploads/prospective_shadow_state_base.json'
SHADOW_STATE_FILE_CAND = 'Scanner Uploads/prospective_shadow_state_cand.json'
UP = os.path.join(os.path.dirname(__file__), '..', 'Scanner Uploads')

def load_shadow_state(file_path):
    if os.path.exists(file_path):
        with open(file_path, 'r') as f:
            return json.load(f)
    return {
        'cash': 350000.0,
        'open_positions': [],
        'realized_pnl': 0.0,
        'mtm': 0.0,
        'last_update': None
    }

def save_shadow_state(state, file_path):
    state['last_update'] = datetime.now().isoformat()
    with open(file_path, 'w') as f:
        json.dump(state, f, indent=2)

def bars(sym):
    f = os.path.join(UP, 'Intraday', sym + '.csv')
    if os.path.exists(f):
        df = pd.read_csv(f)
        df['Date'] = pd.to_datetime(df['Date'])
        return df.sort_values('Date').drop_duplicates('Date').reset_index(drop=True)
    return pd.DataFrame(columns=['Date', 'Open', 'High', 'Low', 'Close', 'Volume'])

def process_exits(state, is_candidate):
    new_open_positions = []
    
    for pos in state['open_positions']:
        sym = pos['symbol']
        entry_date = pos['entry_date']
        df = bars(sym)
        
        path = df[df.Date >= pd.Timestamp(entry_date)]
        if path.empty:
            new_open_positions.append(pos)
            continue
            
        entry_px = pos['entry_price']
        tgt = entry_px * 1.03
        exited = False
        
        unique_days = path['Date'].dt.normalize().unique()
        t2_day = unique_days[2] if len(unique_days) >= 3 else None
        
        for _, b in path.iterrows():
            if b.High > tgt:
                exit_px = max(b.Open, tgt) if b.Open > tgt else tgt
                turnover = pos['qty'] * pos['entry_price'] + pos['qty'] * exit_px
                charges = turnover * 0.0038 / 2
                pnl = (exit_px - pos['entry_price']) * pos['qty'] - charges
                
                state['cash'] += pos['qty'] * exit_px - charges
                state['realized_pnl'] += pnl
                strat_name = "CANDIDATE" if is_candidate else "BASELINE"
                print(f"[SHADOW EXIT - {strat_name}] {sym} hit target at {exit_px:.2f} (PnL: {pnl:.2f})")
                exited = True
                break
                
            if is_candidate and t2_day is not None and b.Date.normalize() == t2_day:
                # If we are on the last bar of T+2 (close), exit. We approximate by taking the last bar of that day.
                # Since we iterate, we can check if it's the last bar of T+2.
                pass
                
        if not exited:
            if is_candidate and t2_day is not None:
                path_t2 = path[path['Date'].dt.normalize() == t2_day]
                if not path_t2.empty:
                    exit_bar = path_t2.iloc[-1]
                    exit_px = exit_bar.Close
                    turnover = pos['qty'] * pos['entry_price'] + pos['qty'] * exit_px
                    charges = turnover * 0.0038 / 2
                    pnl = (exit_px - pos['entry_price']) * pos['qty'] - charges
                    
                    state['cash'] += pos['qty'] * exit_px - charges
                    state['realized_pnl'] += pnl
                    print(f"[SHADOW EXIT - CANDIDATE] {sym} T+2 expired at {exit_px:.2f} (PnL: {pnl:.2f})")
                    exited = True
                    
        if not exited:
            new_open_positions.append(pos)
            
    state['open_positions'] = new_open_positions

def process_entries(state, live_data, today_str, is_candidate):
    if not live_data: return
    valid_sigs = [r for r in live_data if r.get('score', 0) >= 1.6 and r.get('price')]
    valid_sigs.sort(key=lambda x: x['score'], reverse=True)
    
    equity = state['cash'] + sum(p['qty'] * p['entry_price'] for p in state['open_positions'])
    
    for sig in valid_sigs:
        sym = sig['symbol']
        px = sig['price']
        
        fill_px = px * 1.001
        
        amt = min(state['cash'], equity / 5)
        if amt >= 5000:
            qty = int(amt / fill_px)
            if qty > 0:
                cost = qty * fill_px
                state['cash'] -= cost
                state['open_positions'].append({
                    'symbol': sym,
                    'qty': qty,
                    'entry_price': fill_px,
                    'entry_date': today_str
                })
                strat_name = "CANDIDATE" if is_candidate else "BASELINE"
                print(f"[SHADOW ENTRY - {strat_name}] {sym} entered at {fill_px:.2f} (Qty: {qty})")

def mark_to_market(state):
    mtm_val = 0
    for pos in state['open_positions']:
        df = bars(pos['symbol'])
        if not df.empty:
            last_px = df.iloc[-1].Close
            mtm_val += pos['qty'] * last_px
    state['mtm'] = mtm_val

def evaluate_shadow_signals(live_data):
    """
    Dynamic state engine tracking simulated fills, slippage, cash, and MTM.
    """
    state_base = load_shadow_state(SHADOW_STATE_FILE_BASE)
    state_cand = load_shadow_state(SHADOW_STATE_FILE_CAND)
    today_str = datetime.now().strftime('%Y-%m-%d')
    
    process_exits(state_base, False)
    process_exits(state_cand, True)
    
    process_entries(state_base, live_data, today_str, False)
    process_entries(state_cand, live_data, today_str, True)
    
    mark_to_market(state_base)
    mark_to_market(state_cand)
    
    save_shadow_state(state_base, SHADOW_STATE_FILE_BASE)
    save_shadow_state(state_cand, SHADOW_STATE_FILE_CAND)
    
    print(f"Shadow Base Updated: Equity = {state_base['cash'] + state_base['mtm']:.2f}, Realized = {state_base['realized_pnl']:.2f}")
    print(f"Shadow Cand Updated: Equity = {state_cand['cash'] + state_cand['mtm']:.2f}, Realized = {state_cand['realized_pnl']:.2f}")

if __name__ == '__main__':
    if os.path.exists('Scanner Uploads/btst_target_model.json'):
        with open('Scanner Uploads/btst_target_model.json', 'r') as f:
            data = json.load(f)
            live_data = data.get('records', [])
            if live_data:
                latest_day = max(row.get('day', '') for row in live_data)
                current_signals = [r for r in live_data if r.get('day') == latest_day]
                evaluate_shadow_signals(current_signals)
    else:
        print("No live data found to shadow log.")
