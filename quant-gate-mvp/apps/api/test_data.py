from app.services.market_data import get_ohlcv
from app.strategy.turtle import prepare_signals

df, meta = get_ohlcv('BTC_USDT', '5m', source='gate')
print(f'Data rows: {len(df)}')
print(f'Columns: {list(df.columns)}')
print(f'Last close: {df.iloc[-1]["close"]}')
print(f'Date range: {df.iloc[0]["timestamp"]} to {df.iloc[-1]["timestamp"]}')

# Check turtle signals
data = prepare_signals(df, {"turtle_entry_period": 20, "turtle_exit_period": 10, "turtle_atr_period": 14, "turtle_atr_filter": 0})
signals = data[data['signal'].notna()]
print(f'\nTurtle signals (non-null): {len(signals)}')
if len(signals) > 0:
    for s in signals['signal'].value_counts().items():
        print(f'  {s[0]}: {s[1]}')
