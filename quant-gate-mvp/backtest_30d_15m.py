"""海龟策略 15m 回测 - 过去30天 BTC_USDT"""
import sys, io, time, requests, pandas as pd
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

GATE_URL = "https://api.gateio.ws/api/v4/futures/usdt/candlesticks"
API = "http://127.0.0.1:8012"

def fetch_candles(symbol: str, timeframe: str, limit: int, to: int = None) -> pd.DataFrame:
    """从 Gate.io 拉K线，支持分页"""
    params = {"contract": symbol, "interval": timeframe, "limit": max(1, min(limit, 2000))}
    if to:
        params["to"] = to
    resp = requests.get(GATE_URL, params=params, timeout=60)
    resp.raise_for_status()
    data = resp.json()
    rows = []
    for item in data:
        rows.append({
            "timestamp": pd.Timestamp(item["t"], unit="s").isoformat(),
            "open": float(item["o"]),
            "high": float(item["h"]),
            "low": float(item["l"]),
            "close": float(item["c"]),
            "volume": float(item["v"]),
        })
    return pd.DataFrame(rows)

def fetch_30d_candles(symbol: str, timeframe: str) -> pd.DataFrame:
    """拉取过去30天的K线（分两批）"""
    need = 30 * 24 * 4  # 15m: 2880根
    # 第一批: 最新2000根
    print(f"  [1/2] 拉取最新 2000 根 {timeframe} K线...", flush=True)
    df1 = fetch_candles(symbol, timeframe, 2000)
    print(f"  [1/2] 拿到 {len(df1)} 根", flush=True)

    if len(df1) >= need:
        return df1.tail(need)

    # 第二批: 用最早时间戳往前拉
    if not df1.empty:
        earliest = pd.Timestamp(df1["timestamp"].iloc[0])
        to_ts = int(earliest.timestamp()) - 1
        remaining = need - len(df1)
        print(f"  [2/2] 继续拉取剩余 {remaining} 根...", flush=True)
        df2 = fetch_candles(symbol, timeframe, min(remaining + 100, 2000), to=to_ts)
        print(f"  [2/2] 拿到 {len(df2)} 根", flush=True)
        df = pd.concat([df2, df1], ignore_index=True).drop_duplicates(subset="timestamp").sort_values("timestamp").reset_index(drop=True)
    else:
        df = df1

    return df.tail(need)

# ---- 主流程 ----
print("=" * 60)
print("海龟策略 15m · 过去30天回测")
print("=" * 60)

print("\n[1] 拉取 BTC_USDT 15m K线（30天 ≈ 2880根）...")
df = fetch_30d_candles("BTC_USDT", "15m")
print(f"  共 {len(df)} 根K线")
if not df.empty:
    print(f"  范围: {df['timestamp'].iloc[0]} → {df['timestamp'].iloc[-1]}")

# 保存CSV供回测引擎用
csv_path = "state/btc_15m_30d.csv"
df.to_csv(csv_path, index=False)
print(f"  已保存: {csv_path}")

# 通过API回测（用已有API，但K线数据是30天的）
# 由于API内部会重新拉数据，我们直接用引擎回测
print("\n[2] 运行海龟策略回测...")
sys.path.insert(0, "apps/api")
from app.backtest.engine import SimpleBacktester

config = {
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
    "stop_loss_pct": 0.01,
    "take_profit_pct": 0.02,
    "risk_per_trade_pct": 0.01,
    "initial_balance": 10000,
    "allocated_margin": 1000,
}

engine = SimpleBacktester(initial_balance=10000)
result = engine.run(df, config)

s = result.summary
print("\n" + "=" * 60)
print("回测结果（30天 · 15m · 海龟策略）")
print("=" * 60)
print(f"  胜率:       {s.get('win_rate_pct', 0):.1f}%")
print(f"  收益率:     {s.get('return_pct', 0):.2f}%")
print(f"  净盈亏:     ${s.get('total_net_pnl', s.get('net_pnl', 0)):.2f}")
print(f"  交易笔数:   {s.get('trades', 0)}")
print(f"  最大回撤:   {s.get('max_drawdown_pct', 0):.2f}%")
print(f"  结束权益:   ${s.get('ending_equity', 0):.2f}")
print(f"  总手续费:   ${s.get('total_fees', s.get('fees', 0)):.2f}")
print(f"  总滑点成本: ${s.get('total_slippage_cost', s.get('slippage_cost', 0)):.2f}")

# 盈亏比
trades = result.trades
wins = [t for t in trades if t.get("pnl", 0) > 0]
losses = [t for t in trades if t.get("pnl", 0) <= 0]
avg_win = sum(t["pnl"] for t in wins) / len(wins) if wins else 0
avg_loss = abs(sum(t["pnl"] for t in losses)) / len(losses) if losses else 0
ratio = avg_win / avg_loss if avg_loss > 0 else float('inf')
print(f"  盈亏比:     {ratio:.2f}:1")
print(f"  盈利笔数:   {len(wins)}")
print(f"  亏损笔数:   {len(losses)}")

# 交易明细
if trades:
    print(f"\n{'=' * 60}")
    print("交易明细")
    print("=" * 60)
    for i, t in enumerate(trades, 1):
        pnl = t.get("pnl", 0)
        marker = "✅" if pnl > 0 else "❌"
        print(f"  {marker} #{i} {t.get('side','?')} | 入:{t.get('entry_price',0):.2f} → 出:{t.get('exit_price',0):.2f} | PnL:${pnl:.2f} | {t.get('reason','')}")

print("\n" + "=" * 60)
print("参数: Entry=30 Exit=5 ATR=10 ADX>35 SL=1% TP=2% 50x")
print("=" * 60)
