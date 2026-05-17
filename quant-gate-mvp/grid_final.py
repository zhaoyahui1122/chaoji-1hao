import requests
import itertools
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
# Best zone: EP ~60, XP ~20, SL 1.5-2.5%, TP test 2-5%
combos = list(itertools.product(
    [50, 55, 60, 65, 70],
    [18, 20, 22, 25],
    [0.015, 0.018, 0.02, 0.022, 0.025],
    [0.02, 0.025, 0.03, 0.04, 0.05],
))
total = len(combos)

for i, (ep, xp, sl, tp) in enumerate(combos, 1):
    config = {**base, "turtle_entry_period": ep, "turtle_exit_period": xp, "stop_loss_pct": sl, "take_profit_pct": tp}
    try:
        r = requests.post(BASE_URL, json=config, timeout=60).json()
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
    except Exception as e:
        print(f"ERR [{i}]: {e}", flush=True)
    if i % 25 == 0:
        print(f"  {i}/{total} (valid: {len(results)})", flush=True)

results.sort(key=lambda x: x["pnl"], reverse=True)

print(f"\nDone. {len(results)} valid combos", flush=True)
print()
hdr = f"{'#':>4} | {'EP':>4} | {'XP':>4} | {'SL':>6} | {'TP':>6} | {'N':>4} | {'WR':>5} | {'W':>3} | {'NetPnL':>10} | {'Fees':>8} | {'DD':>6}"
print(hdr)
print("-" * len(hdr))
for i, r in enumerate(results[:30], 1):
    m = " <--" if r["pnl"] > 0 else ""
    print(f"{i:>4} | {r['ep']:>4} | {r['xp']:>4} | {r['sl']*100:>5.1f}% | {r['tp']*100:>5.1f}% | {r['trades']:>4} | {r['wr']:>4.0f}% | {r['wins']:>3} | {r['pnl']:>+10.0f} | {r['fees']:>8.0f} | {r['dd']:>5.1f}%{m}")

pos = [r for r in results if r["pnl"] > 0]
print(f"\nProfitable: {len(pos)}/{len(results)}")
