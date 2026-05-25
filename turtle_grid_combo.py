"""海龟策略 7天回测 - ADX + 止损组合优化"""
import requests
from datetime import datetime
import sys
import io

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

API = "http://127.0.0.1:8012"

def run_backtest(adx_threshold, sl_pct, tp_pct):
    payload = {
        "strategy_type": "turtle",
        "symbol": "BTC_USDT",
        "timeframe": "5m",
        "data_source": "gate",
        "leverage": 50,
        "initial_balance": 10000,
        "allocated_margin": 1000,
        "fee_rate": 0.00015,
        "slippage_rate": 0.0001,
        "entry_price": 80000,
        "stop_loss_price": 79200,
        "turtle_entry_period": 30,
        "turtle_exit_period": 5,
        "turtle_atr_period": 10,
        "turtle_atr_filter": 0.0,
        "turtle_adx_threshold": adx_threshold,
        "turtle_force_mode": "turtle",
        "stop_loss_pct": sl_pct,
        "take_profit_pct": tp_pct,
        "risk_per_trade_pct": 0.01,
    }
    try:
        resp = requests.post(f"{API}/backtest", json=payload, timeout=120)
        resp.raise_for_status()
        return resp.json()
    except Exception as e:
        return None

# 组合测试：ADX阈值 x 止损/止盈
adx_vals = [25, 30, 35, 40]
sl_tp_combos = [
    (0.01, 0.02, "1%/2%"),
    (0.015, 0.03, "1.5%/3%"),
    (0.02, 0.04, "2%/4%"),
    (0.02, 0.03, "2%/3%"),
]

print("=" * 70)
print("[GRID] ADX阈值 x 止损/止盈 组合测试 (7天 Gate.io BTC_USDT 5m)")
print("=" * 70)
print(f"时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
print(f"固定: Entry=30, Exit=5, ATR=10, 杠杆=50x")
print()

results = []
for adx in adx_vals:
    for sl, tp, label in sl_tp_combos:
        print(f"  ADX>{adx} SL/TP={label} ...", end=" ", flush=True)
        r = run_backtest(adx, sl, tp)
        if r:
            s = r.get("summary", {})
            t = r.get("trades", [])
            wins = len([x for x in t if x.get("pnl", 0) > 0])
            losses = len(t) - wins
            results.append({
                "adx": adx, "sl": sl, "tp": tp, "label": label,
                "win_rate": s.get("win_rate_pct", 0),
                "pnl": s.get("total_net_pnl", 0),
                "trades": s.get("trades", 0),
                "dd": s.get("max_drawdown_pct", 0),
                "wins": wins, "losses": losses,
            })
            print(f"胜率={s.get('win_rate_pct',0):.1f}% | {s.get('trades',0)}笔 | PnL=${s.get('total_net_pnl',0):.2f}")
        else:
            print("FAIL")

print()
print("=" * 70)
print("[TABLE] 结果汇总")
print("=" * 70)
print(f"{'ADX>':<5} {'SL/TP':<10} {'胜率':>7} {'交易':>5} {'净盈亏':>10} {'回撤':>7}")
print("-" * 55)
for r in results:
    print(f"{r['adx']:<5} {r['label']:<10} {r['win_rate']:>6.1f}% {r['trades']:>4}笔 ${r['pnl']:>8.2f} {r['dd']:>6.2f}%")

# 找最优
valid = [r for r in results if r["trades"] > 0]
if valid:
    best_pnl = max(valid, key=lambda x: x["pnl"])
    best_wr = max(valid, key=lambda x: x["win_rate"])
    profitable = [r for r in valid if r["pnl"] > 0]
    print()
    if profitable:
        print("[WIN] 盈利组合:")
        for p in sorted(profitable, key=lambda x: -x["pnl"]):
            print(f"  ADX>{p['adx']} SL/TP={p['label']} -> 胜率={p['win_rate']:.1f}% PnL=${p['pnl']:.2f}")
    else:
        print("[INFO] 无盈利组合，选亏损最小的:")
        print(f"  ADX>{best_pnl['adx']} SL/TP={best_pnl['label']} -> 胜率={best_pnl['win_rate']:.1f}% PnL=${best_pnl['pnl']:.2f}")
    print(f"[BEST] 最高胜率: ADX>{best_wr['adx']} SL/TP={best_wr['label']} -> {best_wr['win_rate']:.1f}%")

print()
print("=" * 70)
