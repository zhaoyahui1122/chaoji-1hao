import requests

results = []
sls = [0.01, 0.015, 0.02, 0.025, 0.03]
tps = [0.01, 0.015, 0.02, 0.025, 0.03, 0.035, 0.04]

for sl in sls:
    for tp in tps:
        resp = requests.post("http://127.0.0.1:8012/backtest", json={
            "strategy_type": "turtle", "symbol": "BTC_USDT", "timeframe": "5m", "data_source": "gate",
            "leverage": 50, "initial_balance": 10000, "allocated_margin": 1000,
            "turtle_entry_period": 55, "turtle_exit_period": 18, "turtle_atr_period": 10,
            "turtle_atr_filter": 0.0, "turtle_adx_period": 14, "turtle_adx_threshold": 25.0,
            "turtle_rsi_period": 14, "turtle_rsi_oversold": 35, "turtle_rsi_overbought": 70,
            "turtle_bb_period": 20, "turtle_bb_std": 2.0,
            "turtle_force_mode": "mean_reversion",
            "stop_loss_pct": sl, "take_profit_pct": tp,
            "risk_per_trade_pct": 0.01, "fee_rate": 0.00015, "slippage_rate": 0.0001,
        }, timeout=120)
        r = resp.json()
        s = r["summary"]
        results.append({
            "sl": sl, "tp": tp, "trades": s["trades"],
            "wr": s["win_rate_pct"], "net": s["total_net_pnl"],
            "dd": s["max_drawdown_pct"],
        })

print("\n结果 (按净利排序):")
print(f"{'SL':>6} {'TP':>6} {'交易':>4} {'胜率':>6} {'净利':>10} {'回撤':>6}")
print("-" * 45)
for r in sorted(results, key=lambda x: x["net"], reverse=True):
    marker = " [OK]" if r["net"] > 0 else ""
    print(f"{r['sl']*100:>5.1f}% {r['tp']*100:>5.1f}% {r['trades']:>4} {r['wr']:>5.1f}% {r['net']:>+9.2f} {r['dd']:>5.2f}% {marker}")
