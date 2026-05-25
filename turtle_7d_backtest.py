"""海龟策略 7天回测 - 调用 quant-gate-mvp API"""
import requests
import json
from datetime import datetime
import sys
import io

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

API = "http://127.0.0.1:8012"

# 7天 = 7 * 24 * 12 = 2016 根 5m K线 (API max 2000, 接近7天)
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
    # 优化后的海龟参数
    "turtle_entry_period": 30,
    "turtle_exit_period": 5,
    "turtle_atr_period": 10,
    "turtle_atr_filter": 0.0,
    # 风控参数
    "stop_loss_pct": 0.01,
    "take_profit_pct": 0.02,
    "risk_per_trade_pct": 0.01,
}

print("=" * 60)
print("[TURTLE] 海龟策略 7天回测")
print("=" * 60)
print(f"时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
print(f"参数: Entry={payload['turtle_entry_period']}, Exit={payload['turtle_exit_period']}, ATR={payload['turtle_atr_period']}")
print(f"止损={payload['stop_loss_pct']*100}%, 止盈={payload['take_profit_pct']*100}%, 杠杆={payload['leverage']}x")
print(f"数据源: Gate.io BTC_USDT 真实K线 (5m)")
print()

try:
    resp = requests.post(f"{API}/backtest", json=payload, timeout=120)
    resp.raise_for_status()
    result = resp.json()
except Exception as e:
    print(f"[FAIL] 回测请求失败: {e}")
    exit(1)

summary = result.get("summary", {})
trades = result.get("trades", [])
market = result.get("market_data", {})
equity_curve = result.get("equity_curve", [])

print(f"[DATA] 数据源: {market.get('actual_source', 'unknown')}")
if market.get("warning"):
    print(f"[WARN] 警告: {market['warning']}")
print()

# 计算数据时间范围
if equity_curve:
    first_ts = equity_curve[0].get("timestamp", "?")
    last_ts = equity_curve[-1].get("timestamp", "?")
    print(f"[RANGE] 数据范围: {first_ts} -> {last_ts}")
    print(f"[BARS] K线数量: {len(equity_curve)}")
    print()

print("=" * 60)
print("[RESULT] 回测结果摘要")
print("=" * 60)
print(f"  胜率:       {summary.get('win_rate_pct', 0):.2f}%")
print(f"  收益率:     {summary.get('return_pct', 0):.4f}%")
print(f"  净盈亏:     ${summary.get('total_net_pnl', 0):.2f}")
print(f"  交易笔数:   {summary.get('trades', 0)}")
print(f"  最大回撤:   {summary.get('max_drawdown_pct', 0):.4f}%")
print(f"  期末权益:   ${summary.get('ending_equity', 0):.2f}")
print(f"  总手续费:   ${summary.get('total_fees', 0):.2f}")
print(f"  总滑点成本: ${summary.get('total_slippage_cost', 0):.4f}")
print()

if trades:
    print("=" * 60)
    print("[TRADES] 交易明细")
    print("=" * 60)
    wins = 0
    losses = 0
    for i, t in enumerate(trades, 1):
        side = t.get("side", "?").upper()
        entry_p = t.get("entry_price", 0)
        exit_p = t.get("exit_price", 0)
        pnl = t.get("pnl", 0)
        reason = t.get("reason", "?")
        entry_t = t.get("entry_time", "?")
        exit_t = t.get("exit_time", "?")
        mark = "[WIN]" if pnl > 0 else "[LOSS]"
        if pnl > 0:
            wins += 1
        else:
            losses += 1
        print(f"  #{i} {mark} {side} | 入场{entry_p:.2f} -> 出场{exit_p:.2f} | PnL: ${pnl:.2f} | 原因: {reason}")
        print(f"     入场时间: {entry_t}")
        print(f"     出场时间: {exit_t}")
    print()
    print(f"  统计: {wins}胜 {losses}负")
    if losses > 0:
        avg_win = sum(t["pnl"] for t in trades if t["pnl"] > 0) / wins if wins > 0 else 0
        avg_loss = abs(sum(t["pnl"] for t in trades if t["pnl"] <= 0)) / losses
        ratio = avg_win / avg_loss if avg_loss > 0 else float("inf")
        print(f"  平均盈利: ${avg_win:.2f} | 平均亏损: ${avg_loss:.2f} | 盈亏比: {ratio:.2f}:1")
    elif wins > 0:
        print(f"  全部盈利! 平均盈利: ${sum(t['pnl'] for t in trades) / wins:.2f}")
else:
    print("[WARN] 无交易记录 - 市场可能处于震荡区间，无突破信号")

print()
print("=" * 60)
print("[DONE] 海龟7天回测完成")
print("=" * 60)
