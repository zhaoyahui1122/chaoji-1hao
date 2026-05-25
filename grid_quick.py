import requests
import sys

BASE_URL = "http://127.0.0.1:8012/backtest"
base = {
    "strategy_type": "turtle", "symbol": "BTC_USDT", "timeframe": "5m", "data_source": "gate",
    "leverage": 50, "initial_balance": 10000, "allocated_margin": 1000,
    "turtle_atr_period": 10, "turtle_atr_filter": 0.0, "turtle_adx_period": 14, "turtle_adx_threshold": 25.0,
    "turtle_rsi_period": 14, "turtle_rsi_oversold": 35, "turtle_rsi_overbought": 70,
    "turtle_bb_period": 20, "turtle_bb_std": 2.0, "risk_per_trade_pct": 0.01, "fee_rate": 0.0005, "slippage_rate": 0.0002,
}

results = []
# Top zone only: EP=50-70, XP=18-25, SL=1.5-2.5%, TP doesn't matter but include 2-5%
combos = [
    (ep, xp, sl, tp)
    for ep in [50, 55, 60, 65, 70]
    for xp in [18, 20, 22, 25]
    for sl in [0.015, 0.02, 0.025]
    for tp in [0.02, 0.03, 0.05]
]
total = len(combos)

for i, (ep, xp, sl, tp) in enumerate(combos, 1):
    config = {**base, "turtle_entry_period": ep, "turtle_exit_period": xp, "stop_loss_pct": sl, "take_profit_pct": tp}
    try:
        r = requests.post(BASE_URL, json=config, timeout=30).json()
        s = r.get("summary", {})
        trades = r.get("trades", [])
        wins = sum(1 for t in trades if t.get("pnl", 0) > 0)
        tc = s.get("trades", 0)
        if tc > 0:
            results.append({
                "ep": ep, "xp": xp, "sl": sl, "tp": tp,
                "trades": tc, "wr": s.get("win_rate_pct", 0),
                "pnl": s.get("total_net_pnl", 0), "dd": s.get("max_drawdown_pct", 0),
                "fees": s.get("total_fees", 0), "wins": wins,
            })
    except:
        pass
    if i % 30 == 0:
        print(f"{i}/{total} valid:{len(results)}", flush=True)

results.sort(key=lambda x: x["pnl"], reverse=True)

print(f"\n{len(results)} valid combos")
print()
for i, r in enumerate(results[:20], 1):
    m = " <--" if r["pnl"] > 0 else ""
    print(f"  #{i} EP={r['ep']} XP={r['xp']} SL={r['sl']*100:.1f}% TP={r['tp']*100:.1f}% | {r['trades']}笔 WR={r['wr']:.0f}% W={r['wins']} PnL={r['pnl']:+.0f} Fees={r['fees']:.0f} DD={r['dd']:.1f}%{m}")

pos = [r for r in results if r["pnl"] > 0]
print(f"\nProfitable combos: {len(pos)}/{len(results)}")
if pos:
    best = pos[0]
    print(f"BEST: EP={best['ep']} XP={best['xp']} SL={best['sl']*100:.1f}% TP={best['tp']*100:.1f}% | {best['trades']}笔 {best['wr']:.0f}% PnL={best['pnl']:+.0f}")
