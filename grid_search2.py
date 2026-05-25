import requests
import json
import itertools

BASE_URL = "http://127.0.0.1:8012/backtest"

# Test entry/exit period combinations with best SL from previous search
entry_periods = [20, 30, 40, 60]
exit_periods = [5, 10, 15, 20, 30]

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
    "stop_loss_pct": 0.02,
    "take_profit_pct": 0.03,
    "risk_per_trade_pct": 0.01,
    "fee_rate": 0.0005,
    "slippage_rate": 0.0002,
}

results = []
total = len(entry_periods) * len(exit_periods)
done = 0

for ep, xp in itertools.product(entry_periods, exit_periods):
    done += 1
    config = {**base_config, "turtle_entry_period": ep, "turtle_exit_period": xp}
    try:
        resp = requests.post(BASE_URL, json=config, timeout=60)
        data = resp.json()
        s = data.get("summary", {})
        trades = data.get("trades", [])
        wins = sum(1 for t in trades if t.get("pnl", 0) > 0)
        
        results.append({
            "ep": ep, "xp": xp,
            "trades": s.get("trades", 0),
            "wr": s.get("win_rate_pct", 0),
            "pnl": s.get("total_net_pnl", 0),
            "dd": s.get("max_drawdown_pct", 0),
            "fees": s.get("total_fees", 0),
            "wins": wins,
        })
        print(f"  [{done}/{total}] EP={ep} XP={xp} | trades={s.get('trades',0)} WR={s.get('win_rate_pct',0):.0f}% PnL={s.get('total_net_pnl',0):+.0f}")
    except Exception as e:
        print(f"  [{done}/{total}] EP={ep} XP={xp} | ERROR: {e}")

results.sort(key=lambda x: x["pnl"], reverse=True)

print("\n" + "=" * 85)
print(f"{'排名':>4} | {'入场':>4} | {'出场':>4} | {'交易':>5} | {'胜率':>6} | {'赢':>3} | {'净盈亏':>10} | {'手续费':>8} | {'回撤':>6}")
print("-" * 85)
for i, r in enumerate(results, 1):
    marker = " <--" if i <= 5 else ""
    print(f"{i:>4} | {r['ep']:>4} | {r['xp']:>4} | {r['trades']:>5} | {r['wr']:>5.0f}% | {r['wins']:>3} | {r['pnl']:>+10.0f} | {r['fees']:>8.0f} | {r['dd']:>5.1f}%{marker}")
