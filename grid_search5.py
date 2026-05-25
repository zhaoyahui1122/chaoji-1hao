import requests
import itertools
import sys

BASE_URL = "http://127.0.0.1:8012/backtest"

# Fine-grained search around best combo
entry_periods = [50, 55, 60, 65, 70]
exit_periods = [15, 18, 20, 22, 25]
sl_values = [0.015, 0.018, 0.02, 0.022, 0.025]
tp_values = [0.02, 0.025, 0.03, 0.04, 0.05]

base_config = {
    "strategy_type": "turtle",
    "symbol": "BTC_USDT",
    "timeframe": "5m",
    "data_source": "gate",
    "leverage": 50,
    "initial_balance": 10000,
    "allocated_margin": 1000,
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
combos = list(itertools.product(entry_periods, exit_periods, sl_values, tp_values))
total = len(combos)
done = 0

for ep, xp, sl, tp in combos:
    done += 1
    config = {**base_config, "turtle_entry_period": ep, "turtle_exit_period": xp, "stop_loss_pct": sl, "take_profit_pct": tp}
    try:
        resp = requests.post(BASE_URL, json=config, timeout=60)
        data = resp.json()
        s = data.get("summary", {})
        trades = data.get("trades", [])
        wins = sum(1 for t in trades if t.get("pnl", 0) > 0)
        t_count = s.get("trades", 0)
        if t_count > 0:
            results.append({
                "ep": ep, "xp": xp, "sl": sl, "tp": tp,
                "trades": t_count, "wr": s.get("win_rate_pct", 0),
                "pnl": s.get("total_net_pnl", 0), "dd": s.get("max_drawdown_pct", 0),
                "fees": s.get("total_fees", 0), "wins": wins,
            })
        if done % 20 == 0:
            print(f"进度: {done}/{total} 有效:{len(results)}", flush=True)
    except Exception as e:
        print(f"  ERROR [{done}]: {e}", flush=True)

results.sort(key=lambda x: x["pnl"], reverse=True)

print(f"\n共 {len(results)} 个有效组合", flush=True)
print("=" * 105, flush=True)
print(f"{'排名':>4} | {'入场':>4} | {'出场':>4} | {'止损':>6} | {'止盈':>6} | {'交易':>5} | {'胜率':>6} | {'赢':>3} | {'净盈亏':>10} | {'手续费':>8} | {'回撤':>6}", flush=True)
print("-" * 105, flush=True)
for i, r in enumerate(results[:20], 1):
    marker = " ★" if r["pnl"] > 0 else ""
    print(f"{i:>4} | {r['ep']:>4} | {r['xp']:>4} | {r['sl']*100:>5.1f}% | {r['tp']*100:>5.1f}% | {r['trades']:>5} | {r['wr']:>5.0f}% | {r['wins']:>3} | {r['pnl']:>+10.0f} | {r['fees']:>8.0f} | {r['dd']:>5.1f}%{marker}", flush=True)

positive = [r for r in results if r["pnl"] > 0]
print(f"\n盈利组合: {len(positive)}/{len(results)}", flush=True)
