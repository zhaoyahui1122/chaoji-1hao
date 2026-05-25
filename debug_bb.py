import sys
sys.path.insert(0, r"C:\Users\14513\.openclaw\workspace\quant-gate-mvp\apps\api")
from app.services.market_data import get_ohlcv
from app.strategy.turtle import prepare_signals

config = {
    "turtle_entry_period": 30, "turtle_exit_period": 5, "turtle_atr_period": 10,
    "turtle_atr_filter": 0.0, "turtle_adx_period": 14, "turtle_adx_threshold": 25.0,
    "turtle_rsi_period": 14, "turtle_rsi_oversold": 35, "turtle_rsi_overbought": 70,
    "turtle_bb_period": 20, "turtle_bb_std": 2.0,
}
df, _ = get_ohlcv("BTC_USDT", "5m", source="gate")
data = prepare_signals(df, config)

mr = data[data["regime"] == "mean_reversion"]
print(f"Total candles: {len(data)}")
print(f"Turtle candles: {(data['regime'] == 'turtle').sum()}")
print(f"Mean reversion candles: {len(mr)}")
print(f"\nMR RSI range: {mr['rsi'].min():.1f} ~ {mr['rsi'].max():.1f}")
print(f"MR close range: {mr['close'].min():.2f} ~ {mr['close'].max():.2f}")

# Check BB touch conditions in MR mode
mr_with_bb = mr.copy()
mr_with_bb["touch_lower"] = mr_with_bb["close"] <= mr_with_bb["bb_lower"]
mr_with_bb["touch_upper"] = mr_with_bb["close"] >= mr_with_bb["bb_upper"]
print(f"\nMR candles touching BB lower: {mr_with_bb['touch_lower'].sum()}")
print(f"MR candles touching BB upper: {mr_with_bb['touch_upper'].sum()}")

# Check dual confirmation
mr_dual_long = mr_with_bb[(mr_with_bb["touch_lower"]) & (mr_with_bb["rsi"] < 35)]
mr_dual_short = mr_with_bb[(mr_with_bb["touch_upper"]) & (mr_with_bb["rsi"] > 70)]
print(f"\nDual confirm LONG (BB lower + RSI<35): {len(mr_dual_long)}")
for _, r in mr_dual_long.iterrows():
    print(f"  close={r['close']:.2f} bb_lower={r['bb_lower']:.2f} RSI={r['rsi']:.1f}")
print(f"Dual confirm SHORT (BB upper + RSI>70): {len(mr_dual_short)}")
for _, r in mr_dual_short.iterrows():
    print(f"  close={r['close']:.2f} bb_upper={r['bb_upper']:.2f} RSI={r['rsi']:.1f}")

# All entry signals
entries = data[data["signal"].isin(["long", "short"])]
print(f"\nAll entry signals ({len(entries)}):")
for _, r in entries.iterrows():
    print(f"  ADX={r['adx']:.1f} RSI={r['rsi']:.1f} regime={r['regime']} signal={r['signal']} close={r['close']:.2f}")
