import json
import os
from datetime import datetime
import pandas as pd

SHADOW_STATE_FILE = 'Scanner Uploads/prospective_shadow_state.json'
UP = os.path.join(os.path.dirname(__file__), '..', 'Scanner Uploads')

def load_shadow_state():
    if os.path.exists(SHADOW_STATE_FILE):
        with open(SHADOW_STATE_FILE, 'r') as f:
            return json.load(f)
    return {
        'cash': 1000000.0,
        'open_positions': [],
        'realized_pnl': 0.0,
        'mtm': 0.0,
        'last_update': None
    }

def save_shadow_state(state):
    state['last_update'] = datetime.now().isoformat()
    with open(SHADOW_STATE_FILE, 'w') as f:
        json.dump(state, f, indent=2)

def bars(sym):
    f = os.path.join(UP, 'Intraday', sym + '.csv')
    if os.path.exists(f):
        df = pd.read_csv(f)
        df['Date'] = pd.to_datetime(df['Date'])
        return df.sort_values('Date').drop_duplicates('Date').reset_index(drop=True)
    return pd.DataFrame(columns=['Date', 'Open', 'High', 'Low', 'Close', 'Volume'])

def evaluate_shadow_signals(live_data):
    """
    Dynamic state engine tracking simulated fills, slippage, cash, and MTM.
    Implements Candidate rule: T+2 session close expiry.
    """
    state = load_shadow_state()
    today_str = datetime.now().strftime('%Y-%m-%d')
    
    # Process Exits (T+2 Expiry)
    new_open_positions = []
    
    for pos in state['open_positions']:
        sym = pos['symbol']
        entry_date = pos['entry_date']
        df = bars(sym)
        
        # Count sessions since entry
        path = df[df.Date >= pd.Timestamp(entry_date)]
        
        # If we have 3 bars (Entry day = 0, T+1 = 1, T+2 = 2)
        if len(path) >= 3:
            exit_bar = path.iloc[2]
            exit_px = exit_bar.Close
            # Calculate PnL (including 0.38% cost)
            turnover = pos['qty'] * pos['entry_price'] + pos['qty'] * exit_px
            charges = turnover * 0.0038 / 2 # Approx cost
            pnl = (exit_px - pos['entry_price']) * pos['qty'] - charges
            
            state['cash'] += pos['qty'] * exit_px - charges
            state['realized_pnl'] += pnl
            print(f"[SHADOW EXIT] {sym} exited at {exit_px:.2f} (PnL: {pnl:.2f})")
        else:
            # Still open
            new_open_positions.append(pos)
            
    state['open_positions'] = new_open_positions
    
    # Process New Entries
    if live_data:
        # Sort by score and take valid ones
        valid_sigs = [r for r in live_data if r.get('score', 0) >= 1.6 and r.get('price')]
        valid_sigs.sort(key=lambda x: x['score'], reverse=True)
        
        equity = state['cash'] + sum(p['qty'] * p['entry_price'] for p in state['open_positions'])
        
        for sig in valid_sigs:
            sym = sig['symbol']
            px = sig['price']
            
            # Simulated slippage of 0.1% on entry
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
                    print(f"[SHADOW ENTRY] {sym} entered at {fill_px:.2f} (Qty: {qty})")

    # Mark to Market
    mtm_val = 0
    for pos in state['open_positions']:
        df = bars(pos['symbol'])
        if not df.empty:
            last_px = df.iloc[-1].Close
            mtm_val += pos['qty'] * last_px
            
    state['mtm'] = mtm_val
    save_shadow_state(state)
    print(f"Shadow State Updated: Equity = {state['cash'] + state['mtm']:.2f}, Realized = {state['realized_pnl']:.2f}")

if __name__ == '__main__':
    # Load current target model data as a proxy for live data
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
