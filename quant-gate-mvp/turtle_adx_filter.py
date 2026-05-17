"""海龟策略 7天回测 - ADX趋势过滤版"""
import requests
import json
from datetime import datetime
import sys
import io

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

API = "http://127.0.0.1:8012"

def run_backtest(adx_threshold, label=""):
    """跑一轮回测，返回结果"""
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
        "turtle_force_mode": "turtle",  # 纯海龟模式，用ADX过滤开仓
        "stop_loss_pct": 0.01,
        "take_profit_pct": 0.02,
        "risk_per_trade_pct": 0.01,
    }

    try:
        resp = requests.post(f"{API}/backtest", json=payload, timeout=120)
        resp.raise_for_status()
        return resp.json()
    except Exception as e:
        print(f"[FAIL] ADX={adx_threshold}: {e}")
        return None

# 测试不同ADX阈值
adx_values = [20, 25, 30, 35, 40]
results = []

print("=" * 70)
print("[TEST] 海龟策略 ADX趋势过滤测试 (7天 Gate.io BTC_USDT 5m)")
print("=" * 70)
print(f"时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
print(f"固定参数: Entry=30, Exit=5, ATR=10, SL=1%, TP=2%, 杠杆=50x")
print(f"变量: ADX阈值 (只在ADX>阈值时开仓)")
print()

for adx in adx_values:
    print(f"  测试 ADX > {adx} ...", end=" ", flush=True)
    result = run_backtest(adx)
    if result:
        s = result.get("summary", {})
        t = result.get("trades", [])
        wins = len([x for x in t if x.get("pnl", 0) > 0])
        losses = len(t) - wins
        avg_win = sum(x["pnl"] for x in t if x["pnl"] > 0) / wins if wins > 0 else 0
        avg_loss = abs(sum(x["pnl"] for x in t if x["pnl"] <= 0)) / losses if losses > 0 else 0
        ratio = avg_win / avg_loss if avg_loss > 0 else float("inf")
        results.append({
            "adx": adx,
            "win_rate": s.get("win_rate_pct", 0),
            "return_pct": s.get("return_pct", 0),
            "net_pnl": s.get("total_net_pnl", 0),
            "trades": s.get("trades", 0),
            "max_dd": s.get("max_drawdown_pct", 0),
            "wins": wins,
            "losses": losses,
            "ratio": ratio,
        })
        print(f"胜率={s.get('win_rate_pct',0):.1f}% | 交易={s.get('trades',0)}笔 | PnL=${s.get('total_net_pnl',0):.2f} | 回撤={s.get('max_drawdown_pct',0):.2f}%")
    else:
        results.append(None)

print()
print("=" * 70)
print("[COMPARE] ADX阈值对比")
print("=" * 70)
print(f"{'ADX>':<6} {'胜率':>8} {'交易':>6} {'净盈亏':>10} {'回撤':>8} {'盈亏比':>8}")
print("-" * 50)
for r in results:
    if r:
        print(f"{r['adx']:<6} {r['win_rate']:>7.1f}% {r['trades']:>5}笔 ${r['net_pnl']:>8.2f} {r['max_dd']:>7.2f}% {r['ratio']:>7.2f}:1")

# 找最优
valid = [r for r in results if r and r["trades"] > 0]
if valid:
    best_pnl = max(valid, key=lambda x: x["net_pnl"])
    best_wr = max(valid, key=lambda x: x["win_rate"])
    print()
    print(f"[BEST] 最高收益: ADX>{best_pnl['adx']} -> PnL=${best_pnl['net_pnl']:.2f}, 胜率={best_pnl['win_rate']:.1f}%")
    print(f"[BEST] 最高胜率: ADX>{best_wr['adx']} -> 胜率={best_wr['win_rate']:.1f}%, PnL=${best_wr['net_pnl']:.2f}")

print()
print("=" * 70)
print("[DONE]")
print("=" * 70)
