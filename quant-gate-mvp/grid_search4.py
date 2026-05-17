import requests
import itertools

BASE_URL = "http://127.0.0.1:8012/backtest"

# Focused search around sweet spot
entry_periods = [40, 50, 60, 70, 80]
exit_periods = [15, 20, 25, 30, 40]
sl_values = [0.01, 0.015, 0.02, 0.025, 0.03]
tp_values = [0.015, 0.02, 0.03, 0.05, 0.08]

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
    except:
        pass
    if done % 50 == 0:
        print(f"  进度: {done}/{total} (有交易的组合: {len(results)})")

results.sort(key=lambda x: x["pnl"], reverse=True)

print(f"\n共 {len(results)} 个有效组合 (有交易)")
print("=" * 105)
print(f"{'排名':>4} | {'入场':>4} | {'出场':>4} | {'止损':>6} | {'止盈':>6} | {'交易':>5} | {'胜率':>6} | {'赢':>3} | {'净盈亏':>10} | {'手续费':>8} | {'回撤':>6}")
print("-" * 105)
for i, r in enumerate(results[:25], 1):
    marker = " ★" if r["pnl"] > 0 else ""
    print(f"{i:>4} | {r['ep']:>4} | {r['xp']:>4} | {r['sl']*100:>5.1f}% | {r['tp']*100:>5.1f}% | {r['trades']:>5} | {r['wr']:>5.0f}% | {r['wins']:>3} | {r['pnl']:>+10.0f} | {r['fees']:>8.0f} | {r['dd']:>5.1f}%{marker}")

positive = [r for r in results if r["pnl"] > 0]
print(f"\n盈利组合数: {len(positive)}/{len(results)}")
if positive:
    print("\n盈利组合:")
    for i, r in enumerate(positive, 1):
        print(f"  #{i}: EP={r['ep']} XP={r['xp']} SL={r['sl']*100:.1f}% TP={r['tp']*100:.1f}% | {r['trades']}笔 {r['wr']:.0f}% PnL={r['pnl']:+.0f}")
