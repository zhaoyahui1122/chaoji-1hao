import sys
sys.path.insert(0, r"C:\Users\14513\.openclaw\workspace\quant-gate-mvp\apps\api")
from app.services.market_data import get_ohlcv
from app.strategy.turtle import prepare_signals

config = {
    "turtle_entry_period": 30, "turtle_exit_period": 5, "turtle_atr_period": 10,
    "turtle_atr_filter": 0.0, "turtle_adx_period": 14, "turtle_adx_threshold": 25.0,
    "turtle_rsi_period": 14, "turtle_rsi_oversold": 20, "turtle_rsi_overbought": 80,
}
df, _ = get_ohlcv("BTC_USDT", "5m", source="gate")
data = prepare_signals(df, config)

mr = data[data["regime"] == "mean_reversion"]
print(f"Mean reversion candles: {len(mr)}")
print(f"  RSI range in MR mode: {mr['rsi'].min():.1f} ~ {mr['rsi'].max():.1f}")
print(f"  RSI < 20 count: {(mr['rsi'] < 20).sum()}")
print(f"  RSI > 80 count: {(mr['rsi'] > 80).sum()}")
print(f"  RSI < 25 count: {(mr['rsi'] < 25).sum()}")
print(f"  RSI > 75 count: {(mr['rsi'] > 75).sum()}")
print(f"  RSI < 30 count: {(mr['rsi'] < 30).sum()}")
print(f"  RSI > 70 count: {(mr['rsi'] > 70).sum()}")
