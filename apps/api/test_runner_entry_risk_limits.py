from dataclasses import dataclass

from app.services.runner_risk_controls import apply_entry_risk_limits, evaluate_runner_guards
from app.services.risk import build_risk_sized_order


@dataclass
class FakePosition:
    symbol: str
    qty: float
    entry_price: float
    mark_price: float


class FakeBroker:
    def __init__(self, equity=1000, positions=None):
        self.equity = equity
        self.initial_balance = equity
        self.positions = positions or []
        self.peak_equity = equity


def test_entry_risk_limits_cap_single_margin_by_equity(monkeypatch):
    monkeypatch.setenv("MAX_SINGLE_MARGIN_RATIO", "0.10")
    monkeypatch.setenv("MAX_TOTAL_EXPOSURE_RATIO", "2.0")
    monkeypatch.setenv("MAX_OPEN_POSITIONS", "2")
    broker = FakeBroker(equity=1000)

    result = apply_entry_risk_limits(
        broker=broker,
        symbol="BTC_USDT",
        leverage=50,
        requested_margin=500,
        entry_price=100000,
    )

    assert result["allowed"] is True
    assert result["adjusted_margin"] == 40
    assert result["single_margin_cap"] == 100


def test_entry_risk_limits_reject_when_max_positions_reached(monkeypatch):
    monkeypatch.setenv("MAX_OPEN_POSITIONS", "1")
    broker = FakeBroker(
        positions=[FakePosition(symbol="BTC_USDT", qty=1, entry_price=100000, mark_price=100000)]
    )

    result = apply_entry_risk_limits(
        broker=broker,
        symbol="ETH_USDT",
        leverage=20,
        requested_margin=10,
        entry_price=5000,
    )

    assert result["allowed"] is False
    assert result["reason"] == "max_open_positions_reached"


def test_entry_risk_limits_reduce_margin_by_total_exposure(monkeypatch):
    monkeypatch.setenv("MAX_SINGLE_MARGIN_RATIO", "1.0")
    monkeypatch.setenv("MAX_TOTAL_EXPOSURE_RATIO", "2.0")
    broker = FakeBroker(
        equity=1000,
        positions=[FakePosition(symbol="BTC_USDT", qty=0.015, entry_price=100000, mark_price=100000)],
    )

    result = apply_entry_risk_limits(
        broker=broker,
        symbol="ETH_USDT",
        leverage=50,
        requested_margin=100,
        entry_price=5000,
    )

    assert result["allowed"] is True
    assert result["adjusted_margin"] == 10
    assert result["remaining_notional_capacity"] == 500


def test_evaluate_runner_guards_counts_live_qty_exposure(monkeypatch):
    from app.services import runner_risk_controls as controls

    broker = FakeBroker(
        equity=1000,
        positions=[FakePosition(symbol="BTC_USDT", qty=0.02, entry_price=100000, mark_price=100000)],
    )
    monkeypatch.setattr(controls, "LIVE_BROKER", broker)
    monkeypatch.setattr(controls, "load_logs", lambda limit=500: [])
    monkeypatch.setenv("MAX_TOTAL_EXPOSURE_RATIO", "2.0")

    guard = evaluate_runner_guards(trade_mode="live")

    assert guard["total_notional"] == 2000
    assert guard["exposure_ratio"] == 2.0
    assert guard["allowed"] is False


def test_risk_sized_order_qty_respects_allocated_margin_cap():
    result = build_risk_sized_order(
        side="long",
        account_equity=1000,
        entry_price=100,
        leverage=10,
        risk_per_trade_pct=0.10,
        stop_loss_pct=0.10,
        take_profit_pct=0.20,
        allocated_margin_cap=10,
    )

    assert result["effective_allocated_margin"] == 10
    assert result["qty"] == 1
