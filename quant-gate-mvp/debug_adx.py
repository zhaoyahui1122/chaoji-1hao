import sys
sys.path.insert(0, r"C:\Users\14513\.openclaw\workspace\quant-gate-mvp\apps\api")
from app.services.market_data import get_ohlcv
from app.strategy.turtle import prepare_signals

config = {
    "strategy_type": "turtle", "symbol": "BTC_USDT", "timeframe": "5m", "data_source": "gate",
    "turtle_entry_period": 30, "turtle_exit_period": 5, "turtle_atr_period": 10,
    "turtle_atr_filter": 0.0, "turtle_adx_period": 14, "turtle_adx_threshold": 25.0,
    "turtle_rsi_period": 14, "turtle_rsi_oversold": 20, "turtle_rsi_overbought": 80,
}
df, meta = get_ohlcv("BTC_USDT", "5m", source="gate")
data = prepare_signals(df, config)

print(f"Total candles: {len(data)}")
print(f"ADX range: {data['adx'].min():.1f} ~ {data['adx'].max():.1f}")
print(f"RSI range: {data['rsi'].min():.1f} ~ {data['rsi'].max():.1f}")

regime_counts = data['regime'].value_counts()
print(f"\nRegime distribution (ALL):")
for k, v in regime_counts.items():
    print(f"  {k}: {v} candles")

last50 = data.tail(50)
print(f"\nLast 50 candles ADX range: {last50['adx'].min():.1f} ~ {last50['adx'].max():.1f}")
print(f"Last 50 candles RSI range: {last50['rsi'].min():.1f} ~ {last50['rsi'].max():.1f}")
regime_counts50 = last50['regime'].value_counts()
print(f"Regime distribution (last 50): {dict(regime_counts50)}")

signals = data[data['signal'].notna()]
print(f"\nAll signals ({len(signals)} total):")
for _, r in signals.iterrows():
    print(f"  ADX={r['adx']:.1f} RSI={r['rsi']:.1f} regime={r['regime']} signal={r['signal']}")
