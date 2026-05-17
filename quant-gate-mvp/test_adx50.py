import requests

# Test with ADX threshold 50 (should force mean reversion for most candles)
resp = requests.post("http://127.0.0.1:8012/backtest", json={
    "strategy_type": "turtle", "symbol": "BTC_USDT", "timeframe": "5m", "data_source": "gate",
    "leverage": 50, "initial_balance": 10000, "allocated_margin": 1000,
    "turtle_entry_period": 55, "turtle_exit_period": 18, "turtle_atr_period": 10,
    "turtle_atr_filter": 0.0, "turtle_adx_period": 14, "turtle_adx_threshold": 50.0,
    "turtle_rsi_period": 14, "turtle_rsi_oversold": 35, "turtle_rsi_overbought": 70,
    "turtle_bb_period": 20, "turtle_bb_std": 2.0,
    "stop_loss_pct": 0.025, "take_profit_pct": 0.0375,
    "risk_per_trade_pct": 0.01, "fee_rate": 0.00015, "slippage_rate": 0.0001,
}, timeout=120)

r = resp.json()
s = r["summary"]
trades = r["trades"]

wins = sum(1 for t in trades if t.get("pnl", 0) > 0)
losses = sum(1 for t in trades if t.get("pnl", 0) <= 0)

print("=" * 60)
print("ADX=50 (无force_mode) | SL=2.5% TP=3.75% | Maker费率")
print("=" * 60)
print(f"交易: {s['trades']}笔 | 胜率: {s['win_rate_pct']:.1f}% | 赢{wins}/亏{losses}")
print(f"净利: {s['total_net_pnl']:.2f} U | 回撤: {s['max_drawdown_pct']:.2f}%")

reasons = {}
for t in trades:
    r = t.get("reason", "unknown")
    if r not in reasons:
        reasons[r] = {"count": 0, "pnl": 0}
    reasons[r]["count"] += 1
    reasons[r]["pnl"] += t.get("pnl", 0)
print("出场统计:")
for r, d in sorted(reasons.items(), key=lambda x: -x[1]["count"]):
    print(f"  {r:<15} {d['count']:>3}笔 | {d['pnl']:>+8.2f} U")
