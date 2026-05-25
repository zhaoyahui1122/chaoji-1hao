import requests
import json
import itertools

BASE_URL = "http://127.0.0.1:8012/backtest"

# Grid search parameters
sl_values = [0.003, 0.005, 0.008, 0.01, 0.015, 0.02]
tp_values = [0.005, 0.01, 0.015, 0.02, 0.03, 0.05]

base_config = {
    "strategy_type": "turtle",
    "symbol": "BTC_USDT",
    "timeframe": "5m",
    "data_source": "gate",
    "leverage": 50,
    "initial_balance": 10000,
    "allocated_margin": 1000,
    "turtle_entry_period": 30,
    "turtle_exit_period": 5,
    "turtle_atr_period": 10,
    "turtle_atr_filter": 0.0,
    "turtle_adx_period": 14,
    "turtle_adx_threshold": 25.0,
    "turtle_rsi_period": 14,
    "turtle_rsi_oversold": 35,
    "turtle_rsi_overbought": 70,
    "turtle_bb_period": 20,
    "turtle_bb_std": 2.0,
    "risk_per_trade_pct": 0.01,
    "fee_rate": 0.0005,
    "slippage_rate": 0.0002,
}

results = []
total = len(sl_values) * len(tp_values)
done = 0

for sl, tp in itertools.product(sl_values, tp_values):
    done += 1
    config = {**base_config, "stop_loss_pct": sl, "take_profit_pct": tp}
    try:
        resp = requests.post(BASE_URL, json=config, timeout=60)
        data = resp.json()
        summary = data.get("summary", {})
        trades = data.get("trades", [])
        
        wins = sum(1 for t in trades if t.get("pnl", 0) > 0)
        total_pnl = sum(t.get("pnl", 0) for t in trades)
        
        results.append({
            "sl": sl,
            "tp": tp,
            "trades": summary.get("trades", 0),
            "win_rate": summary.get("win_rate_pct", 0),
            "net_pnl": summary.get("total_net_pnl", 0),
            "max_dd": summary.get("max_drawdown_pct", 0),
            "fees": summary.get("total_fees", 0),
            "wins": wins,
            "total_pnl": total_pnl,
        })
        print(f"  [{done}/{total}] SL={sl*100:.1f}% TP={tp*100:.1f}% | trades={summary.get('trades',0)} WR={summary.get('win_rate_pct',0):.0f}% PnL={summary.get('total_net_pnl',0):.0f}")
    except Exception as e:
        print(f"  [{done}/{total}] SL={sl*100:.1f}% TP={tp*100:.1f}% | ERROR: {e}")
        results.append({"sl": sl, "tp": tp, "trades": 0, "win_rate": 0, "net_pnl": -9999, "max_dd": 0, "fees": 0, "wins": 0, "total_pnl": 0})

# Sort by net PnL
results.sort(key=lambda x: x["net_pnl"], reverse=True)

print("\n" + "=" * 80)
print(f"{'排名':>4} | {'止损':>6} | {'止盈':>6} | {'交易':>5} | {'胜率':>6} | {'净盈亏':>10} | {'手续费':>8} | {'回撤':>6}")
print("-" * 80)
for i, r in enumerate(results[:15], 1):
    sl_pct = f"{r['sl']*100:.1f}%"
    tp_pct = f"{r['tp']*100:.1f}%"
    print(f"{i:>4} | {sl_pct:>6} | {tp_pct:>6} | {r['trades']:>5} | {r['win_rate']:>5.0f}% | {r['net_pnl']:>+10.0f} | {r['fees']:>8.0f} | {r['max_dd']:>5.1f}%")

print("\n" + "=" * 80)
print("TOP 3:")
for i, r in enumerate(results[:3], 1):
    print(f"  #{i}: SL={r['sl']*100:.1f}% TP={r['tp']*100:.1f}% | {r['trades']}笔 {r['win_rate']:.0f}%胜率 PnL={r['net_pnl']:+.0f} 回撤={r['max_dd']:.1f}%")
