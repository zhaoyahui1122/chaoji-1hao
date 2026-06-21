import pandas as pd

from app.api.routes_strategy import StrategyConfig
from app.core.state import PAPER_BROKER
from app.services.strategy_runner import run_strategy_cycle
from app.services.strategy_store import DEFAULT_SLOTS


def test_strategy_config_accepts_ifvg_strategy_type():
    config = StrategyConfig(strategy_type="ifvg")

    assert config.strategy_type == "ifvg"
    assert config.ifvg_risk_reward == 1.5
    assert config.ifvg_one_shot_per_session is True


def test_default_slots_include_ifvg_preset():
    ifvg_slot = next((slot for slot in DEFAULT_SLOTS if slot["config"]["strategy_type"] == "ifvg"), None)

    assert ifvg_slot is not None
    assert "IFVG" in ifvg_slot["name"]
    assert ifvg_slot["config"]["ifvg_risk_reward"] == 1.5


def test_runner_routes_ifvg_to_ifvg_signal(monkeypatch):
    PAPER_BROKER.reset()
    monkeypatch.setattr("app.services.strategy_runner.evaluate_runner_guards", lambda **kwargs: {
        "allowed": True,
        "halt_reason": None,
        "consecutive_loss_count": 0,
        "daily_realized_pnl": 0.0,
        "daily_loss_ratio": 0.0,
        "total_notional": 0.0,
        "exposure_ratio": 0.0,
    })
    monkeypatch.setattr("app.services.strategy_runner.get_ohlcv", lambda *args, **kwargs: (
        pd.DataFrame([
            {"timestamp": 1, "open": 100.0, "high": 101.0, "low": 99.0, "close": 100.0, "volume": 1.0},
            {"timestamp": 2, "open": 100.0, "high": 102.0, "low": 99.5, "close": 101.0, "volume": 1.0},
            {"timestamp": 3, "open": 101.0, "high": 103.0, "low": 100.5, "close": 102.0, "volume": 1.0},
        ]),
        {"requested_source": "gate", "actual_source": "gate", "fallback_used": False, "warning": None},
    ))
    called = {"ifvg": False}

    def fake_ifvg_signal(config, df, last_row):
        called["ifvg"] = True
        return None, {
            "ifvg_signal": None,
            "ifvg_status": "waiting_for_key_level_rejection",
        }

    monkeypatch.setattr("app.services.strategy_runner._run_ifvg_signal", fake_ifvg_signal)

    result = run_strategy_cycle({
        "strategy_type": "ifvg",
        "symbol": "BTC_USDT",
        "timeframe": "15m",
        "data_source": "gate",
        "leverage": 20,
        "allocated_margin": 1000,
        "stop_loss_pct": 0.01,
        "take_profit_pct": 0.015,
        "risk_per_trade_pct": 0.01,
        "fee_rate": 0.00015,
        "slippage_rate": 0.0001,
        "dry_run": True,
    })

    assert called["ifvg"] is True
    assert result["action"] == "idle"
    assert result["signal"] is None
