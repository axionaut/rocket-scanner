"""
Full-History Tradebook & Stretched-Entry Analysis
==================================================
Performs:
1. Daily FIFO aggregation across all 6,388 fills (5,377 round trips).
2. Quantifies all sessions with >= Rs 5,000 net profit (capital rotation, sizing, win rate, duration).
3. Connects entry dates to historical daily bars (btst_daily_store.pkl):
   - Computes 20-day SMA distance, 5-day return, and 20-day return at entry.
   - Evaluates correlation between technical extension and trade outcome (win vs severe drawdown).
"""

import sys
import os
import pickle
from collections import deque
import pandas as pd
import numpy as np

TRADEBOOK_PATH = "Scanner Uploads/tradebook.csv"
STORE_PATH = "dev/btst_daily_store.pkl"

def load_data():
    df = pd.read_csv(TRADEBOOK_PATH)
    df['quantity'] = pd.to_numeric(df['quantity'], errors='coerce')
    df['price'] = pd.to_numeric(df['price'], errors='coerce')
    df['trade_type'] = df['trade_type'].str.strip().str.lower()
    df['exec_time'] = pd.to_datetime(df['order_execution_time'])
    df = df.sort_values(by=['exec_time', 'trade_id']).reset_index(drop=True)
    
    with open(STORE_PATH, 'rb') as f:
        store = pickle.load(f)
    return df, store

def match_fifo(df):
    completed_trades = []
    open_positions = {}
    unreconciled_opening_sells = []

    for symbol, group in df.groupby('symbol', sort=False):
        long_inventory = deque()

        for _, row in group.iterrows():
            ttype = row['trade_type']
            qty = float(row['quantity'])
            price = float(row['price'])
            tdate = str(row['trade_date'])
            etime = row['exec_time']
            order_id = row['order_id']
            trade_id = row['trade_id']

            if qty <= 0:
                continue

            if ttype == 'buy':
                long_inventory.append({
                    'qty': qty,
                    'price': price,
                    'date': tdate,
                    'time': etime,
                    'order_id': order_id,
                    'trade_id': trade_id
                })

            elif ttype == 'sell':
                rem_qty = qty
                while rem_qty > 1e-6 and long_inventory:
                    long_lot = long_inventory[0]
                    matched_qty = min(rem_qty, long_lot['qty'])
                    
                    entry_val = matched_qty * long_lot['price']
                    exit_val = matched_qty * price
                    turnover = entry_val + exit_val
                    charges = turnover * 0.001 + turnover * 0.0000325 + entry_val * 0.00015 + turnover * 0.000001 + 15.93
                    charges += (turnover * 0.0000325 + turnover * 0.000001 + 15.93) * 0.18
                    
                    pnl = exit_val - entry_val - charges
                    pnl_pct = (pnl / entry_val) * 100.0
                    
                    completed_trades.append({
                        'symbol': symbol,
                        'side': 'LONG',
                        'entry_date': long_lot['date'],
                        'entry_time': long_lot['time'],
                        'entry_price': long_lot['price'],
                        'exit_date': tdate,
                        'exit_time': etime,
                        'exit_price': price,
                        'quantity': matched_qty,
                        'entry_value': entry_val,
                        'exit_value': exit_val,
                        'pnl': pnl,
                        'pnl_pct': pnl_pct,
                    })
                    long_lot['qty'] -= matched_qty
                    rem_qty -= matched_qty
                    if long_lot['qty'] < 1e-6:
                        long_inventory.popleft()
                        
                if rem_qty > 1e-6:
                    unreconciled_opening_sells.append({
                        'symbol': symbol,
                        'date': tdate,
                        'time': etime,
                        'price': price,
                        'unmatched_qty': rem_qty,
                        'order_id': order_id,
                        'trade_id': trade_id
                    })

        rem_long = sum(x['qty'] for x in long_inventory)
        if rem_long > 1e-6:
            open_positions[symbol] = [{'qty': x['qty'], 'price': x['price'], 'date': x['date']} for x in long_inventory]

    trades_df = pd.DataFrame(completed_trades)
    unreconciled_df = pd.DataFrame(unreconciled_opening_sells)
    return trades_df, open_positions, unreconciled_df

def analyze_daily(trades_df):
    trades_df['entry_dt'] = pd.to_datetime(trades_df['entry_date'])
    trades_df['exit_dt'] = pd.to_datetime(trades_df['exit_date'])
    trades_df['hold_days'] = np.busday_count(trades_df['entry_dt'].values.astype('datetime64[D]'), 
                                             trades_df['exit_dt'].values.astype('datetime64[D]'))

    # Group by exit_date for realized P&L
    daily_records = []
    for exit_date, grp in trades_df.groupby('exit_date'):
        wins = grp[grp['pnl'] > 0]
        losses = grp[grp['pnl'] < 0]
        tot_trades = len(grp)
        n_wins = len(wins)
        n_losses = len(losses)
        net_pnl = grp['pnl'].sum()
        gross_profit = wins['pnl'].sum()
        gross_loss = losses['pnl'].sum()
        win_rate = (n_wins / tot_trades * 100.0) if tot_trades > 0 else 0
        total_entry_val = grp['entry_value'].sum()
        avg_pos_size = grp['entry_value'].mean()
        avg_hold_days = grp['hold_days'].mean()
        same_day_pct = (grp['hold_days'] == 0).sum() / tot_trades * 100.0
        one_day_pct = (grp['hold_days'] == 1).sum() / tot_trades * 100.0
        
        daily_records.append({
            'date': exit_date,
            'net_pnl': net_pnl,
            'trades': tot_trades,
            'wins': n_wins,
            'losses': n_losses,
            'win_rate': win_rate,
            'gross_profit': gross_profit,
            'gross_loss': gross_loss,
            'capital_rotated': total_entry_val,
            'avg_pos_size': avg_pos_size,
            'avg_hold_days': avg_hold_days,
            'same_day_pct': same_day_pct,
            'one_day_pct': one_day_pct,
        })
    daily_df = pd.DataFrame(daily_records).sort_values(by='date').reset_index(drop=True)
    return daily_df, trades_df

def correlate_extension(trades_df, store):
    close = store['Close']
    
    # Compute technical indicators across daily bars
    sma20 = close.rolling(20).mean()
    ret5 = (close / close.shift(5) - 1.0) * 100.0
    ret20 = (close / close.shift(20) - 1.0) * 100.0
    
    records = []
    missing_cnt = 0
    
    for idx, row in trades_df.iterrows():
        sym = row['symbol']
        edate = row['entry_date']
        
        if sym not in close.columns:
            missing_cnt += 1
            continue
            
        sym_close = close[sym].dropna()
        # Find latest available bar on or before entry_date
        past_dates = sym_close.index[sym_close.index <= edate]
        if len(past_dates) < 20:
            missing_cnt += 1
            continue
            
        prev_date = past_dates[-1] if past_dates[-1] < edate else (past_dates[-2] if len(past_dates) >= 2 else past_dates[-1])
        
        c_val = sym_close.loc[prev_date]
        sma_val = sma20[sym].loc[prev_date]
        r5_val = ret5[sym].loc[prev_date]
        r20_val = ret20[sym].loc[prev_date]
        
        if pd.isna(sma_val) or sma_val <= 0:
            missing_cnt += 1
            continue
            
        entry_px = row['entry_price']
        dist_sma20 = (entry_px - sma_val) / sma_val * 100.0
        
        # Calculate max drawdown during holding period
        hold_window = store['Low'][sym].loc[edate:row['exit_date']]
        min_px = hold_window.min() if not hold_window.empty else entry_px
        max_drawdown = (min_px - entry_px) / entry_px * 100.0
        
        is_win = row['pnl'] > 0
        is_target = row['pnl_pct'] >= 2.5
        is_severe_loss = max_drawdown <= -5.0
        is_drawdown_loss = max_drawdown <= -3.0
        
        records.append({
            'symbol': sym,
            'entry_date': edate,
            'pnl': row['pnl'],
            'pnl_pct': row['pnl_pct'],
            'entry_val': row['entry_value'],
            'hold_days': row['hold_days'],
            'dist_sma20': dist_sma20,
            'ret5': r5_val,
            'ret20': r20_val,
            'max_drawdown': max_drawdown,
            'is_win': is_win,
            'is_target': is_target,
            'is_severe_loss': is_severe_loss,
            'is_drawdown_loss': is_drawdown_loss
        })
        
    ext_df = pd.DataFrame(records)
    return ext_df, missing_cnt

def main():
    print("Loading Tradebook and Daily Bars...")
    df, store = load_data()
    trades_df, open_pos, unreconciled_df = match_fifo(df)
    
    print(f"Found {len(unreconciled_df)} unreconciled opening sells (inherited inventory sold).")
    
    daily_df, trades_df = analyze_daily(trades_df)
    
    # Calculate open positions summary
    open_unrealized_pnl = 0
    open_cost = 0
    open_count = 0
    close_prices = store['Close'].iloc[-1]
    
    for sym, lots in open_pos.items():
        if sym in close_prices.index:
            cmp = close_prices[sym]
        else:
            cmp = lots[0]['price']
        for lot in lots:
            val = lot['qty'] * lot['price']
            cur_val = lot['qty'] * cmp
            turnover = val + cur_val
            charges = turnover * 0.001 + turnover * 0.0000325 + cur_val * 0.00015 + turnover * 0.000001 + 15.93
            charges += (turnover * 0.0000325 + turnover * 0.000001 + 15.93) * 0.18
            
            open_cost += val
            open_unrealized_pnl += (cur_val - val - charges)
            open_count += 1

    print("\n" + "="*80)
    print("                    1. ALL DAYS ACHIEVING >= Rs 5,000 NET PROFIT")
    print("="*80)
    top_days = daily_df[daily_df['net_pnl'] >= 5000].sort_values(by='net_pnl', ascending=False)
    print(f"Total days with >= Rs 5,000 net profit: {len(top_days)} out of {len(daily_df)} active days ({len(top_days)/len(daily_df)*100:.1f}%)")
    print("\nDate        Net P&L (Rs)  Trades  Win Rate   Gross Profit   Gross Loss   Rotated Cap (Rs)  Avg Size (Rs)  Avg Hold (d)")
    print("-" * 105)
    for _, r in top_days.iterrows():
        print(f"{r['date']}  {r['net_pnl']:11.2f}  {r['trades']:6d}   {r['win_rate']:6.1f}%   {r['gross_profit']:12.2f} {r['gross_loss']:12.2f}   {r['capital_rotated']:14.2f}  {r['avg_pos_size']:11.2f}  {r['avg_hold_days']:8.1f}")
        
    print("\n" + "="*80)
    print("      SUMMARY OF >= Rs 5,000 DAYS vs ALL PROFITABLE DAYS vs ALL DAYS")
    print("="*80)
    all_profitable = daily_df[daily_df['net_pnl'] > 0]
    all_loss = daily_df[daily_df['net_pnl'] < 0]
    print(f"Total active days:       {len(daily_df)}")
    print(f"Profitable days:         {len(all_profitable)} ({len(all_profitable)/len(daily_df)*100:.1f}%)")
    print(f"Losing days:             {len(all_loss)} ({len(all_loss)/len(daily_df)*100:.1f}%)")
    print(f"Mean Daily Net P&L:      Rs {daily_df['net_pnl'].mean():.2f}")
    print(f"Median Daily Net P&L:    Rs {daily_df['net_pnl'].median():.2f}")
    print(f"Open Positions:          {open_count} trades (Cost: Rs {open_cost:,.2f})")
    print(f"Open Unrealized P&L:     Rs {open_unrealized_pnl:,.2f}")
    
    print("\nMetric                    >= Rs 5,000 Days (n={})   Profitable Days (n={})   All Days (n={})".format(
        len(top_days), len(all_profitable), len(daily_df)))
    print("-" * 80)
    print(f"Mean Net P&L (Rs):        {top_days['net_pnl'].mean():15.2f}   {all_profitable['net_pnl'].mean():18.2f}   {daily_df['net_pnl'].mean():12.2f}")
    print(f"Mean Win Rate:            {top_days['win_rate'].mean():14.1f}%  {all_profitable['win_rate'].mean():17.1f}%  {daily_df['win_rate'].mean():11.1f}%")
    print(f"Mean Trades / Day:        {top_days['trades'].mean():15.1f}   {all_profitable['trades'].mean():18.1f}   {daily_df['trades'].mean():12.1f}")
    print(f"Mean Capital Rotated (Rs):{top_days['capital_rotated'].mean():15.2f}   {all_profitable['capital_rotated'].mean():18.2f}   {daily_df['capital_rotated'].mean():12.2f}")
    print(f"Mean Position Size (Rs):  {top_days['avg_pos_size'].mean():15.2f}   {all_profitable['avg_pos_size'].mean():18.2f}   {daily_df['avg_pos_size'].mean():12.2f}")
    print(f"Mean Hold Duration (days):{top_days['avg_hold_days'].mean():15.1f}   {all_profitable['avg_hold_days'].mean():18.1f}   {daily_df['avg_hold_days'].mean():12.1f}")
    print(f"Same-day Exit Share:      {top_days['same_day_pct'].mean():14.1f}%  {all_profitable['same_day_pct'].mean():17.1f}%  {daily_df['same_day_pct'].mean():11.1f}%")

    print("\n" + "="*80)
    print("         2. HOLDING DURATION DISTRIBUTION (ALL 5,377 TRADES)")
    print("="*80)
    same_day = trades_df[trades_df['hold_days'] == 0]
    d1 = trades_df[trades_df['hold_days'] == 1]
    d2_3 = trades_df[(trades_df['hold_days'] >= 2) & (trades_df['hold_days'] <= 3)]
    d4_plus = trades_df[trades_df['hold_days'] > 3]
    
    print(f"Same Day (0 days):   {len(same_day):5d} trades ({len(same_day)/len(trades_df)*100:5.1f}%) | Win Rate: {(same_day['pnl']>0).sum()/len(same_day)*100:5.1f}% | Total Net P&L: Rs {same_day['pnl'].sum():10.2f}")
    print(f"Next Day (1 day):    {len(d1):5d} trades ({len(d1)/len(trades_df)*100:5.1f}%) | Win Rate: {(d1['pnl']>0).sum()/len(d1)*100:5.1f}% | Total Net P&L: Rs {d1['pnl'].sum():10.2f}")
    print(f"2-3 Days:            {len(d2_3):5d} trades ({len(d2_3)/len(trades_df)*100:5.1f}%) | Win Rate: {(d2_3['pnl']>0).sum()/len(d2_3)*100:5.1f}% | Total Net P&L: Rs {d2_3['pnl'].sum():10.2f}")
    print(f"> 3 Days:            {len(d4_plus):5d} trades ({len(d4_plus)/len(trades_df)*100:5.1f}%) | Win Rate: {(d4_plus['pnl']>0).sum()/len(d4_plus)*100:5.1f}% | Total Net P&L: Rs {d4_plus['pnl'].sum():10.2f}")

    print("\n" + "="*80)
    print("     3. STRETCHED-ENTRY vs DRAWDOWN ANALYSIS (CORRELATING EXTENSION)")
    print("="*80)
    ext_df, missing = correlate_extension(trades_df, store)
    print(f"Successfully matched {len(ext_df)} trades with technical bars ({missing} missing / insufficient history).")
    
    # Bucket by dist_sma20
    ext_df['dist_sma20_bin'] = pd.cut(ext_df['dist_sma20'], 
                                      bins=[-np.inf, 0, 5, 10, 15, 20, np.inf],
                                      labels=['< 0%', '0% to +5%', '+5% to +10%', '+10% to +15%', '+15% to +20%', '> +20%'])
    
    print("\nExtension from 20-day SMA Breakdown:")
    print("Bin               Trades   Win %   Target % (>=+2.5%)   Loss > 5%   Loss > 3%   Net P&L (Rs)   Avg P&L %")
    print("-" * 90)
    for b_name, grp in ext_df.groupby('dist_sma20_bin', observed=False):
        n = len(grp)
        if n == 0:
            continue
        win_pct = grp['is_win'].sum() / n * 100.0
        tgt_pct = grp['is_target'].sum() / n * 100.0
        sev_loss_pct = grp['is_severe_loss'].sum() / n * 100.0
        dd_loss_pct = grp['is_drawdown_loss'].sum() / n * 100.0
        tot_pnl = grp['pnl'].sum()
        avg_pct = grp['pnl_pct'].mean()
        print(f"{b_name:15s}  {n:6d}   {win_pct:5.1f}%        {tgt_pct:5.1f}%          {sev_loss_pct:5.1f}%      {dd_loss_pct:5.1f}%   {tot_pnl:11.2f}    {avg_pct:5.2f}%")

    # Bucket by 5-day return
    ext_df['ret5_bin'] = pd.cut(ext_df['ret5'], 
                                bins=[-np.inf, 0, 5, 10, 15, 25, np.inf],
                                labels=['< 0%', '0% to +5%', '+5% to +10%', '+10% to +15%', '+15% to +25%', '> +25%'])
    print("\nPrior 5-Day Return Breakdown:")
    print("Bin               Trades   Win %   Target % (>=+2.5%)   Loss > 5%   Loss > 3%   Net P&L (Rs)   Avg P&L %")
    print("-" * 90)
    for b_name, grp in ext_df.groupby('ret5_bin', observed=False):
        n = len(grp)
        if n == 0:
            continue
        win_pct = grp['is_win'].sum() / n * 100.0
        tgt_pct = grp['is_target'].sum() / n * 100.0
        sev_loss_pct = grp['is_severe_loss'].sum() / n * 100.0
        dd_loss_pct = grp['is_drawdown_loss'].sum() / n * 100.0
        tot_pnl = grp['pnl'].sum()
        avg_pct = grp['pnl_pct'].mean()
        print(f"{b_name:15s}  {n:6d}   {win_pct:5.1f}%        {tgt_pct:5.1f}%          {sev_loss_pct:5.1f}%      {dd_loss_pct:5.1f}%   {tot_pnl:11.2f}    {avg_pct:5.2f}%")

    # Bucket by 20-day return
    ext_df['ret20_bin'] = pd.cut(ext_df['ret20'], 
                                 bins=[-np.inf, 0, 10, 20, 30, 50, np.inf],
                                 labels=['< 0%', '0% to +10%', '+10% to +20%', '+20% to +30%', '+30% to +50%', '> +50%'])
    print("\nPrior 20-Day Return Breakdown:")
    print("Bin               Trades   Win %   Target % (>=+2.5%)   Loss > 5%   Loss > 3%   Net P&L (Rs)   Avg P&L %")
    print("-" * 90)
    for b_name, grp in ext_df.groupby('ret20_bin', observed=False):
        n = len(grp)
        if n == 0:
            continue
        win_pct = grp['is_win'].sum() / n * 100.0
        tgt_pct = grp['is_target'].sum() / n * 100.0
        sev_loss_pct = grp['is_severe_loss'].sum() / n * 100.0
        dd_loss_pct = grp['is_drawdown_loss'].sum() / n * 100.0
        tot_pnl = grp['pnl'].sum()
        avg_pct = grp['pnl_pct'].mean()
        print(f"{b_name:15s}  {n:6d}   {win_pct:5.1f}%        {tgt_pct:5.1f}%          {sev_loss_pct:5.1f}%      {dd_loss_pct:5.1f}%   {tot_pnl:11.2f}    {avg_pct:5.2f}%")

if __name__ == '__main__':
    main()
