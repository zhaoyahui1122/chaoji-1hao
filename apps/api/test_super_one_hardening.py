from hashlib import sha256

import pandas as pd
from fastapi.testclient import TestClient

from app.backtest import engine as backtest_engine
from app.backtest.engine import SimpleBacktester
from app.core.state import PAPER_BROKER
from app.main import app
from app.services.auth_service import create_password_hash, verify_password
from app.services.runner_risk_controls import apply_entry_risk_limits
from app.services.runner_state_store import DEFAULT_RUNNER_STATE, load_runner_state, save_runner_state
from app.services.strategy_runner import run_strategy_cycle


def test_pbkdf2_password_hash_supported_and_legacy_sha256_still_works():
    hashed = create_password_hash("secret123", salt="testsalt", iterations=10_000)
    assert verify_password("secret123", hashed) is True
    assert verify_password("wrong", hashed) is False
    assert verify_password("secret123", sha256("secret123".encode()).hexdigest()) is True


def test_logout_revokes_server_side_session(monkeypatch):
    monkeypatch.setenv("ADMIN_USERNAME", "admin")
    monkeypatch.setenv("ADMIN_PASSWORD_HASH", create_password_hash("secret123", salt="testsalt2", iterations=10_000))
    monkeypatch.setenv("SESSION_SECRET", "test-session-secret-hardening")
    with TestClient(app) as client:
        assert client.post("/auth/login", json={"username": "admin", "password": "secret123"}).status_code == 200
        assert client.get("/dashboard").status_code == 200
        assert client.post("/auth/logout").status_code == 200
        assert client.get("/dashboard").status_code == 401


def test_live_runner_run_once_requires_operation_token(monkeypatch):
    monkeypatch.setenv("ADMIN_USERNAME", "admin")
    monkeypatch.setenv("ADMIN_PASSWORD_HASH", create_password_hash("secret123", salt="testsalt3", iterations=10_000))
    monkeypatch.setenv("SESSION_SECRET", "test-session-secret-hardening-2")
    with TestClient(app) as client:
        assert client.post("/auth/login", json={"username": "admin", "password": "secret123"}).status_code == 200
        response = client.post("/runner/run-once", json={
            "symbol": "BTC_USDT",
            "timeframe": "15m",
            "strategy_type": "classic",
            "data_source": "gate",
            "trade_mode": "live",
            "leverage": 20,
            "allocated_margin": 10,
        })
        assert response.status_code == 403


def test_run_once_does_not_enable_runner(monkeypatch):
    PAPER_BROKER.reset()
    save_runner_state({**DEFAULT_RUNNER_STATE, "enabled": False, "is_running": False})
    monkeypatch.setattr("app.services.strategy_runner.evaluate_runner_guards", lambda **kwargs: {
        "allowed": True,
        "halt_reason": None,
        "consecutive_loss_count": 0,
        "daily_realized_pnl": 0.0,
        "daily_loss_ratio": 0.0,
        "total_notional": 0,
        "exposure_ratio": 0.0,
    })
    monkeypatch.setattr("app.services.strategy_runner.get_ohlcv", lambda *args, **kwargs: (
        pd.DataFrame([{"timestamp": 1, "open": 100, "high": 101, "low": 99, "close": 100, "volume": 1}]),
        {"requested_source": "gate", "actual_source": "gate", "fallback_used": False},
    ))
    monkeypatch.setattr("app.services.strategy_runner._run_classic_signal", lambda config, df, last_row: (None, None))

    result = run_strategy_cycle({
        "strategy_type": "classic",
        "symbol": "BTC_USDT",
        "timeframe": "15m",
        "data_source": "gate",
        "trade_mode": "paper",
    })

    assert result["action"] == "idle"
    assert load_runner_state()["enabled"] is False


def test_live_exposure_uses_quanto_multiplier():
    class Broker:
        equity = 1000
        initial_balance = 1000
        peak_equity = 1000
        positions = [
            type("Pos", (), {"symbol": "BTC_USDT", "qty": 10, "mark_price": 100_000, "quanto_multiplier": 0.0001})()
        ]

    result = apply_entry_risk_limits(
        broker=Broker(),
        symbol="ETH_USDT",
        leverage=10,
        requested_margin=10,
        entry_price=5000,
    )
    assert result["total_notional"] == 100.0


def test_classic_backtest_can_liquidate_before_stop_loss(monkeypatch):
    calls = {"count": 0}

    def fake_signal(row, **kwargs):
        calls["count"] += 1
        return "long" if calls["count"] == 1 else None

    monkeypatch.setattr(backtest_engine, "classic_generate_signal", fake_signal)
    df = pd.DataFrame([
        {"timestamp": "2026-06-01T00:00:00Z", "open": 100, "high": 101, "low": 99.5, "close": 100},
        {"timestamp": "2026-06-01T00:15:00Z", "open": 100, "high": 101, "low": 97.5, "close": 99},
    ])
    result = SimpleBacktester(initial_balance=1000).run(df, {
        "strategy_type": "classic",
        "leverage": 50,
        "stop_loss_pct": 0.05,
        "take_profit_pct": 0.02,
        "risk_per_trade_pct": 0.01,
        "fee_rate": 0.0,
        "slippage_rate": 0.0,
    })
    assert result.trades[0]["reason"] == "liquidation"
