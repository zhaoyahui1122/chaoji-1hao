import pandas as pd

from app.backtest import engine as backtest_engine
from app.backtest.engine import SimpleBacktester


def test_classic_backtest_uses_intrabar_low_for_long_stop_loss(monkeypatch):
    calls = {"count": 0}

    def fake_signal(row, **kwargs):
        calls["count"] += 1
        return "long" if calls["count"] == 1 else None

    monkeypatch.setattr(backtest_engine, "classic_generate_signal", fake_signal)

    df = pd.DataFrame([
        {"timestamp": "2026-06-01T00:00:00Z", "open": 100, "high": 101, "low": 99.5, "close": 100},
        {"timestamp": "2026-06-01T00:15:00Z", "open": 100, "high": 100.5, "low": 98.5, "close": 100},
    ])
    config = {
        "strategy_type": "classic",
        "stop_loss_pct": 0.01,
        "take_profit_pct": 0.02,
        "risk_per_trade_pct": 0.01,
        "fee_rate": 0.0,
        "slippage_rate": 0.0,
    }

    result = SimpleBacktester(initial_balance=1000).run(df, config)

    assert len(result.trades) == 1
    assert result.trades[0]["reason"] == "stop_loss"
    assert result.trades[0]["exit_price"] == 99


def test_classic_backtest_cooldown_skips_immediate_reentry_after_close(monkeypatch):
    calls = {"count": 0}

    def fake_signal(row, **kwargs):
        calls["count"] += 1
        return "long"

    monkeypatch.setattr(backtest_engine, "classic_generate_signal", fake_signal)

    df = pd.DataFrame([
        {"timestamp": "2026-06-01T00:00:00Z", "open": 100, "high": 101, "low": 99.5, "close": 100},
        {"timestamp": "2026-06-01T00:15:00Z", "open": 100, "high": 100.5, "low": 98.5, "close": 100},
        {"timestamp": "2026-06-01T00:30:00Z", "open": 100, "high": 101, "low": 99.5, "close": 100},
        {"timestamp": "2026-06-01T00:45:00Z", "open": 100, "high": 100.5, "low": 98.5, "close": 100},
    ])
    config = {
        "strategy_type": "classic",
        "stop_loss_pct": 0.01,
        "take_profit_pct": 0.02,
        "risk_per_trade_pct": 0.01,
        "fee_rate": 0.0,
        "slippage_rate": 0.0,
        "classic_cooldown_bars": 2,
    }

    result = SimpleBacktester(initial_balance=1000).run(df, config)

    assert len(result.trades) == 1
