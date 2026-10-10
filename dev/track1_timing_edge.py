import os
import glob
import json
import pandas as pd
import numpy as np

# Config
LOGS_DIR = 'Scanner Uploads'
INTRADAY_DIR = os.path.join(LOGS_DIR, 'Intraday')
DAILY_STORE = 'dev/btst_daily_store.pkl'
SLIPPAGE = 0.001

def load_daily_store():
    with open(DAILY_STORE, 'rb') as f:
        import pickle
        return pickle.load(f)

def load_intraday_bars(symbol):
    path = os.path.join(INTRADAY_DIR, f"{symbol}.csv")
    if not os.path.exists(path):
        return None
    df = pd.read_csv(path)
    df['Date'] = pd.to_datetime(df['Date'])
    df = df.sort_values('Date').set_index('Date')
    return df

def main():
    log_files = sorted(glob.glob(os.path.join(LOGS_DIR, 'btst_preview_log_*.jsonl')))
    
    records = []
    
    for lf in log_files:
        date_str = lf.split('_')[-1].replace('.jsonl', '')
        
        with open(lf, 'r') as f:
            for line in f:
                try:
                    data = json.loads(line)
                except:
                    continue
                    
                as_of = data.get('asOf')
                if not as_of:
                    continue
                # asOf format: "2026-10-09 09:20:05 IST"
                timestamp = pd.to_datetime(as_of.replace(' IST', ''))
                
                signals = data.get('diagnostics', {}).get('signals', [])
                
                scores_dict = {}
                for row in data.get('ens20', []):
                    scores_dict[row[0]] = row[1]
                for row in data.get('top20', []):
                    if row[0] not in scores_dict:
                        scores_dict[row[0]] = row[1]
                
                for sig in signals:
                    sym = sig.get('symbol')
                    ohlcv = sig.get('ohlcv', {})
                    imm_px = ohlcv.get('price')
                    if not imm_px:
                        continue
                        
                    score = scores_dict.get(sym, 0.0)
                    
                    records.append({
                        'date': date_str,
                        'timestamp': timestamp,
                        'symbol': sym,
                        'score': score,
                        'imm_px': imm_px,
                    })
                    
    df = pd.DataFrame(records)
    if df.empty:
        print("No signals found.")
        return
        
    df = df[df['score'] >= 1.6]
    df = df.sort_values(['date', 'timestamp'])
    df = df.drop_duplicates(subset=['date', 'symbol'], keep='first')
    
    print(f"Found {len(df)} unique daily signals >= 1.6")
    
    daily_store = load_daily_store()
    close_prices = daily_store['Close']
    
    results = []
    
    for _, row in df.iterrows():
        sym = row['symbol']
        date = row['date']
        imm_px = row['imm_px'] * (1 + SLIPPAGE)
        
        intraday = load_intraday_bars(sym)
        delayed_px = None
        if intraday is not None:
            target_time = pd.Timestamp(f"{date} 15:15:00")
            if target_time in intraday.index:
                delayed_px = intraday.loc[target_time]['Close'] * (1 + SLIPPAGE)
            else:
                print(f"Missing 15:15 bar for {sym} on {date}, skipping delayed entry calculation.")
        else:
            print(f"No intraday data for {sym} on {date}, skipping delayed entry calculation.")
                
        t1_px = np.nan
        t2_px = np.nan
        
        if sym in close_prices.columns:
            sym_closes = close_prices[sym].dropna()
            # Ensure the index is compared properly, it might be string
            future_dates = [d for d in sym_closes.index if str(d) > str(date)]
            if len(future_dates) > 0:
                t1_px = sym_closes.loc[future_dates[0]]
            if len(future_dates) > 1:
                t2_px = sym_closes.loc[future_dates[1]]
                
        imm_edge = (delayed_px - imm_px) / imm_px if delayed_px else np.nan
        
        SELLING_COST = 0.0013 # 0.13% total delivery exit cost
        
        t1_ret_imm = ((t1_px * (1 - SELLING_COST)) - imm_px) / imm_px if not np.isnan(t1_px) else np.nan
        t1_ret_del = ((t1_px * (1 - SELLING_COST)) - delayed_px) / delayed_px if delayed_px and not np.isnan(t1_px) else np.nan
        
        t2_ret_imm = ((t2_px * (1 - SELLING_COST)) - imm_px) / imm_px if not np.isnan(t2_px) else np.nan
        t2_ret_del = ((t2_px * (1 - SELLING_COST)) - delayed_px) / delayed_px if delayed_px and not np.isnan(t2_px) else np.nan
        
        results.append({
            'date': date,
            'timestamp': row['timestamp'].strftime('%H:%M:%S'),
            'symbol': sym,
            'score': row['score'],
            'imm_px': imm_px,
            'delayed_px': delayed_px,
            'imm_edge_pct': imm_edge * 100 if not np.isnan(imm_edge) else np.nan,
            't1_ret_imm_pct': t1_ret_imm * 100,
            't1_ret_del_pct': t1_ret_del * 100,
            't2_ret_imm_pct': t2_ret_imm * 100,
            't2_ret_del_pct': t2_ret_del * 100
        })
        
    res_df = pd.DataFrame(results)
    
    print("\n" + "="*80)
    print("                 TRACK 1: TIMING & SELECTION EDGE")
    print("="*80)
    print(f"Total Signals Evaluated: {len(res_df)}")
    
    valid_edge = res_df.dropna(subset=['imm_edge_pct'])
    print(f"\nImmediate vs Delayed (15:15 EOD) Entry Edge (n={len(valid_edge)}):")
    print(f"Mean Advantage of Immediate Entry: {valid_edge['imm_edge_pct'].mean():.2f}%")
    print(f"Win Rate (Immediate is cheaper):   {(valid_edge['imm_edge_pct'] > 0).mean()*100:.1f}%")
    
    valid_t1 = res_df.dropna(subset=['t1_ret_imm_pct', 't1_ret_del_pct'])
    print(f"\nT+1 Forward Return (n={len(valid_t1)}):")
    print(f"Mean from Immediate Entry:         {valid_t1['t1_ret_imm_pct'].mean():.2f}%")
    print(f"Mean from Delayed Entry:           {valid_t1['t1_ret_del_pct'].mean():.2f}%")
    
    valid_t2 = res_df.dropna(subset=['t2_ret_imm_pct', 't2_ret_del_pct'])
    print(f"\nT+2 Forward Return (n={len(valid_t2)}):")
    print(f"Mean from Immediate Entry:         {valid_t2['t2_ret_imm_pct'].mean():.2f}%")
    print(f"Mean from Delayed Entry:           {valid_t2['t2_ret_del_pct'].mean():.2f}%")
    
    res_df.to_csv('dev/track1_timing_edge_results.csv', index=False)
    print("\nDetailed results saved to dev/track1_timing_edge_results.csv")

if __name__ == '__main__':
    main()
