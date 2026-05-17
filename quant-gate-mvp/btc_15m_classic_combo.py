from __future__ import annotations

import io
import itertools
import json
import sys
from pathlib import Path

import pandas as pd

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "apps" / "api"))

from app.backtest.engine import SimpleBacktester
from app.services.market_data import get_ohlcv

RESULT_PATH = ROOT / "state" / "btc_15m_classic_combo_results.json"
TOP_PATH = ROOT / "state" / "btc_15m_classic_best.json"
TOP_N = 30

BASE_CONFIG = {
    "strategy_type": "classic",
    "symbol": "BTC_USDT",
    "timeframe": "15m",
    "data_source": "gate",
    "leverage": 50,
    "initial_balance": 10000,
    "allocated_margin": 1000,
    "fee_rate": 0.00015,
    "slippage_rate": 0.0001,
    "backtest_days": 20,
    "use_boll": True,
    "use_rsi": True,
    "use_ma": True,
    "use_macd": False,
    "use_kdj": False,
    "boll_period": 20,
    "boll_std": 2.0,
    "rsi_period": 14,
    "rsi_oversold": 30,
    "rsi_overbought": 70,
    "ma_short": 9,
    "ma_long": 21,
    "macd_fast": 12,
    "macd_slow": 26,
    "macd_signal": 9,
    "kdj_period": 9,
    "kdj_signal_period": 3,
    "kdj_overbought": 80,
    "kdj_oversold": 20,
    "stop_loss_pct": 0.015,
    "take_profit_pct": 0.03,
    "risk_per_trade_pct": 0.01,
}

COMBOS = [
    ("BB+RSI+EMA", {"use_macd": False, "use_kdj": False}),
]

PARAM_GRID = {
    "boll_period": [10, 14],
    "boll_std": [0.8, 1.0],
    "rsi_oversold": [42, 45, 48],
    "rsi_overbought": [52, 55, 58],
    "ma_short": [3, 5],
    "ma_long": [8, 10],
    "macd_signal": [5],
    "kdj_period": [5],
    "stop_loss_pct": [0.004, 0.005, 0.006],
    "take_profit_pct": [0.006, 0.008, 0.01],
    "min_signal_score": [1, 2],
}


def average_win_loss_ratio(trades: list[dict]) -> float:
    wins = [t["pnl"] for t in trades if t.get("pnl", 0) > 0]
    losses = [abs(t["pnl"]) for t in trades if t.get("pnl", 0) <= 0]
    if not wins or not losses:
        return 0.0
    return (sum(wins) / len(wins)) / (sum(losses) / len(losses))


def build_variants() -> list[tuple[str, dict]]:
    variants: list[tuple[str, dict]] = []
    keys = list(PARAM_GRID.keys())
    values = [PARAM_GRID[key] for key in keys]
    for combo_name, switches in COMBOS:
        for picked in itertools.product(*values):
            variant = dict(zip(keys, picked))
            if variant["ma_long"] <= variant["ma_short"]:
                continue
            config = {**BASE_CONFIG, **switches, **variant}
            config["macd_fast"] = 12
            config["macd_slow"] = 26
            config["kdj_signal_period"] = 3
            variants.append((combo_name, config))
    return variants


def score_result(combo_name: str, config: dict, result) -> dict:
    summary = result.summary
    trades = result.trades
    return {
        "combo": combo_name,
        "config": config,
        "summary": summary,
        "avg_win_loss_ratio": round(average_win_loss_ratio(trades), 4),
        "meets_win_rate": summary.get("win_rate_pct", 0) >= 50,
        "trade_count": summary.get("trades", 0),
    }


def main() -> None:
    timeframe_minutes = {"5m": 5, "15m": 15, "30m": 30, "1h": 60, "4h": 240}
    periods = min(max(BASE_CONFIG["backtest_days"] * int((24 * 60) / timeframe_minutes[BASE_CONFIG["timeframe"]]), 50), 2000)
    df, market_meta = get_ohlcv(BASE_CONFIG["symbol"], BASE_CONFIG["timeframe"], source=BASE_CONFIG["data_source"], periods=periods)
    if df.empty:
        raise RuntimeError("No market data returned for comparison run")

    print("=" * 90)
    print("BTC_USDT 15m classic combo comparison")
    print("=" * 90)
    print(f"candles={len(df)} source={market_meta.get('actual_source')} fallback={market_meta.get('fallback_used')}")
    print(f"range={df.iloc[0]['timestamp']} -> {df.iloc[-1]['timestamp']}")
    print()

    engine = SimpleBacktester(initial_balance=BASE_CONFIG["initial_balance"])
    variants = build_variants()
    results = []
    total = len(variants)

    for idx, (combo_name, config) in enumerate(variants, start=1):
        result = engine.run(df, config)
        scored = score_result(combo_name, config, result)
        results.append(scored)
        summary = scored["summary"]
        print(
            f"[{idx}/{total}] {combo_name:<18} WR={summary.get('win_rate_pct', 0):>5.1f}% "
            f"PnL={summary.get('total_net_pnl', 0):>9.2f} DD={summary.get('max_drawdown_pct', 0):>6.2f}% "
            f"Trades={summary.get('trades', 0):>3}"
        )

    ranked = sorted(
        results,
        key=lambda item: (
            1 if item["meets_win_rate"] else 0,
            item["summary"].get("trades", 0) >= 80,
            item["summary"].get("total_net_pnl", 0),
            -item["summary"].get("max_drawdown_pct", 0),
            item["avg_win_loss_ratio"],
        ),
        reverse=True,
    )

    top = ranked[:TOP_N]
    qualified = [item for item in ranked if item["meets_win_rate"] and item["trade_count"] >= 80]
    high_frequency = [item for item in ranked if item["trade_count"] >= 100]
    best = qualified[0] if qualified else (high_frequency[0] if high_frequency else ranked[0])
    stable = sorted(
        qualified or high_frequency or ranked,
        key=lambda item: (
            item["summary"].get("trades", 0) >= 80,
            item["summary"].get("win_rate_pct", 0) >= 50,
            item["summary"].get("total_net_pnl", 0),
            -item["summary"].get("max_drawdown_pct", 0),
            item["summary"].get("win_rate_pct", 0),
        ),
        reverse=True,
    )[0]

    RESULT_PATH.write_text(json.dumps({
        "market_data": market_meta,
        "top": top,
        "best": best,
        "stable": stable,
        "tested": len(results),
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    TOP_PATH.write_text(json.dumps(best, ensure_ascii=False, indent=2), encoding="utf-8")

    print()
    print("-" * 90)
    print("Top 10")
    print("-" * 90)
    for i, item in enumerate(top, start=1):
        summary = item["summary"]
        print(
            f"#{i:02d} {item['combo']:<18} WR={summary.get('win_rate_pct', 0):>5.1f}% "
            f"PnL={summary.get('total_net_pnl', 0):>9.2f} DD={summary.get('max_drawdown_pct', 0):>6.2f}% "
            f"Trades={summary.get('trades', 0):>3} R={item['avg_win_loss_ratio']:.2f}"
        )

    print()
    print("[BEST]")
    print(json.dumps(best, ensure_ascii=False, indent=2))
    print()
    print("[STABLE]")
    print(json.dumps(stable, ensure_ascii=False, indent=2))
    print()
    print(f"Saved results to: {RESULT_PATH}")
    print(f"Saved best config to: {TOP_PATH}")


if __name__ == "__main__":
    main()
