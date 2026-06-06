import os
import requests


API_BASE = os.environ.get("API_BASE_URL", "http://127.0.0.1:8001")


def run_backtest(payload: dict) -> dict:
    response = requests.post(f"{API_BASE}/backtest", json=payload, timeout=60)
    response.raise_for_status()
    return response.json()


def print_summary(title: str, result: dict) -> None:
    summary = result["summary"]
    trades = summary["trades"]
    long_trades = [trade for trade in result["trades"] if trade["side"] == "long"]
    short_trades = [trade for trade in result["trades"] if trade["side"] == "short"]

    print(f"{title}: {trades} 笔")
    print(f"  做多: {len(long_trades)} 笔 | 做空: {len(short_trades)} 笔")
    print(f"  胜率: {summary['win_rate_pct']}% | 收益: {summary['return_pct']}%")


def main() -> None:
    turtle_result = run_backtest({
        "strategy_type": "turtle",
        "symbol": "BTC_USDT",
        "timeframe": "5m",
        "data_source": "gate",
        "initial_balance": 10000,
        "leverage": 50,
        "turtle_entry_period": 20,
        "turtle_exit_period": 10,
        "turtle_atr_period": 14,
        "risk_per_trade_pct": 0.01,
        "stop_loss_pct": 0.02,
        "take_profit_pct": 0.04,
        "fee_rate": 0.0005,
        "slippage_rate": 0.0002,
    })
    print_summary("海龟回测", turtle_result)

    classic_result = run_backtest({
        "strategy_type": "classic",
        "symbol": "BTC_USDT",
        "timeframe": "5m",
        "data_source": "gate",
        "initial_balance": 10000,
        "leverage": 50,
        "boll_period": 20,
        "boll_std": 2.0,
        "rsi_period": 14,
        "ma_short": 9,
        "ma_long": 21,
        "rsi_oversold": 30,
        "rsi_overbought": 70,
        "use_boll": True,
        "use_rsi": True,
        "use_ma": True,
        "risk_per_trade_pct": 0.01,
        "stop_loss_pct": 0.02,
        "take_profit_pct": 0.04,
        "fee_rate": 0.0005,
        "slippage_rate": 0.0002,
    })
    print()
    print_summary("经典回测", classic_result)


if __name__ == "__main__":
    main()
