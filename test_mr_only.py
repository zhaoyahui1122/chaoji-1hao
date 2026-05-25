import requests

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
eq = r.get("equity_curve", [])

print("=" * 60)
print("纯均值回归 (屏蔽海龟) | 5分钟 | 盈亏比1:1.5 | Maker费率")
print("=" * 60)
print(f"K线数: {len(eq)}")
print(f"交易数: {s['trades']}")
print(f"胜率: {s['win_rate_pct']:.1f}%")
print(f"毛利: {s['total_gross_pnl']:.2f} U")
print(f"手续费: {s['total_fees']:.2f} U")
print(f"净利: {s['total_net_pnl']:.2f} U")
print(f"收益率: {s['return_pct']:.2f}%")
print(f"最大回撤: {s['max_drawdown_pct']:.2f}%")
print()

wins = sum(1 for t in trades if t.get("pnl", 0) > 0)
losses = sum(1 for t in trades if t.get("pnl", 0) <= 0)
avg_win = sum(t["pnl"] for t in trades if t["pnl"] > 0) / max(wins, 1)
avg_loss = sum(t["pnl"] for t in trades if t["pnl"] <= 0) / max(losses, 1)
print(f"赢: {wins} 亏: {losses}")
if avg_loss != 0:
    print(f"平均赢: +{avg_win:.2f} U | 平均亏: {avg_loss:.2f} U | 盈亏比: 1:{abs(avg_win/avg_loss):.2f}")
print()

print("交易明细:")
for i, t in enumerate(trades, 1):
    m = "+" if t.get("pnl", 0) > 0 else ""
    print(f"  #{i} {t['entry_time']} {t['side']:>5} | {t['entry_price']:.2f} -> {t['exit_price']:.2f} | {t['reason']:<14} | PnL: {m}{t['pnl']:.2f}")
