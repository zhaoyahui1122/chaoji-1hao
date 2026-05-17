"""海龟策略 15m · 30天 · 多组盈亏比对比"""
import sys, io, pandas as pd
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

sys.path.insert(0, "apps/api")
from app.backtest.engine import SimpleBacktester

# 直接用已保存的30天K线
df = pd.read_csv("state/btc_15m_30d.csv")
print(f"K线: {len(df)}根 | {df['timestamp'].iloc[0]} → {df['timestamp'].iloc[-1]}")

combos = [
    (0.01, 0.02, "SL1% TP2% (2:1)"),
    (0.01, 0.03, "SL1% TP3% (3:1)"),
    (0.01, 0.04, "SL1% TP4% (4:1)"),
    (0.015, 0.03, "SL1.5% TP3% (2:1)"),
    (0.015, 0.045, "SL1.5% TP4.5% (3:1)"),
    (0.02, 0.04, "SL2% TP4% (2:1)"),
    (0.02, 0.06, "SL2% TP6% (3:1)"),
]

base_config = {
    "strategy_type": "turtle",
    "symbol": "BTC_USDT",
    "timeframe": "15m",
    "leverage": 50,
    "fee_rate": 0.00015,
    "slippage_rate": 0.0001,
    "turtle_entry_period": 30,
    "turtle_exit_period": 5,
    "turtle_atr_period": 10,
    "turtle_atr_filter": 0.0,
    "turtle_adx_threshold": 35,
    "turtle_adx_period": 14,
    "turtle_force_mode": "turtle",
    "risk_per_trade_pct": 0.01,
    "initial_balance": 10000,
    "allocated_margin": 1000,
}

print(f"\n{'=' * 75}")
print(f"{'SL/TP':<22} {'胜率':>7} {'净盈亏':>10} {'笔数':>5} {'回撤':>7} {'盈亏比':>8} {'盈/亏':>6}")
print("-" * 75)

results = []
for sl, tp, label in combos:
    config = {**base_config, "stop_loss_pct": sl, "take_profit_pct": tp}
    engine = SimpleBacktester(initial_balance=10000)
    r = engine.run(df, config)
    s = r.summary
    trades = r.trades
    wins = [t for t in trades if t.get("pnl", 0) > 0]
    losses = [t for t in trades if t.get("pnl", 0) <= 0]
    avg_w = sum(t["pnl"] for t in wins) / len(wins) if wins else 0
    avg_l = abs(sum(t["pnl"] for t in losses)) / len(losses) if losses else 0
    ratio = avg_w / avg_l if avg_l > 0 else float('inf')
    
    pnl = s.get('total_net_pnl', s.get('net_pnl', 0))
    wr = s.get('win_rate_pct', 0)
    dd = s.get('max_drawdown_pct', 0)
    cnt = s.get('trades', 0)
    
    results.append({
        "label": label, "sl": sl, "tp": tp,
        "win_rate": wr, "pnl": pnl, "trades": cnt,
        "dd": dd, "ratio": ratio, "wins": len(wins), "losses": len(losses),
    })
    print(f"  {label:<20} {wr:>6.1f}% ${pnl:>8.2f} {cnt:>4}笔 {dd:>6.2f}% {ratio:>7.2f}:1 {len(wins)}/{len(losses)}")

# 排名
print(f"\n{'=' * 75}")
valid = [r for r in results if r["trades"] > 0]
if valid:
    best_pnl = max(valid, key=lambda x: x["pnl"])
    best_wr = max(valid, key=lambda x: x["win_rate"])
    best_ratio = max(valid, key=lambda x: x["ratio"] if x["ratio"] != float('inf') else 0)
    profitable = [r for r in valid if r["pnl"] > 0]
    
    print(f"[最高净盈亏] {best_pnl['label']} → ${best_pnl['pnl']:.2f} | 胜率{best_pnl['win_rate']:.1f}% | {best_pnl['trades']}笔")
    print(f"[最高胜率]   {best_wr['label']} → {best_wr['win_rate']:.1f}% | ${best_wr['pnl']:.2f} | {best_wr['trades']}笔")
    print(f"[最高盈亏比] {best_ratio['label']} → {best_ratio['ratio']:.2f}:1 | ${best_ratio['pnl']:.2f}")
    
    if profitable:
        print(f"\n[盈利组合] 共{len(profitable)}个:")
        for p in sorted(profitable, key=lambda x: -x["pnl"]):
            print(f"  ✅ {p['label']} → ${p['pnl']:.2f} | 胜率{p['win_rate']:.1f}% | 盈亏比{p['ratio']:.2f} | {p['trades']}笔")
    else:
        print("\n[INFO] 无盈利组合")

print(f"\n{'=' * 75}")
print("固定参数: Entry=30 Exit=5 ATR=10 ADX>35 50x 15m BTC_USDT")
print(f"{'=' * 75}")
