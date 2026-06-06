import pandas as pd

from app.core.state import PAPER_BROKER
from app.services.risk import (
    get_estimated_liquidation_buffer_pct,
    validate_stop_loss_against_liquidation,
)
from app.services.strategy_runner import run_strategy_cycle


def reset_runner_state():
    PAPER_BROKER.reset()


def allow_runner_guards(monkeypatch):
    monkeypatch.setattr('app.services.strategy_runner.evaluate_runner_guards', lambda **kwargs: {
        'allowed': True,
        'halt_reason': None,
        'consecutive_loss_count': 0,
        'daily_realized_pnl': 0.0,
        'daily_loss_ratio': 0.0,
        'total_notional': 0,
        'exposure_ratio': 0.0,
    })


def fake_market_data(*args, **kwargs):
    return pd.DataFrame([
        {'timestamp': 1, 'open': 60500.0, 'high': 60600.0, 'low': 60400.0, 'close': 60526.95, 'volume': 1}
    ]), {
        'requested_source': 'gate',
        'actual_source': 'gate',
        'fallback_used': False,
        'warning': None,
    }


def test_validate_stop_loss_against_liquidation_thresholds():
    assert get_estimated_liquidation_buffer_pct(100) == 0.005
    assert validate_stop_loss_against_liquidation(100, 0.02)['ok'] is False
    assert validate_stop_loss_against_liquidation(20, 0.02)['ok'] is True


def test_runner_rejects_entry_when_stop_loss_wider_than_liquidation_buffer(monkeypatch):
    reset_runner_state()
    allow_runner_guards(monkeypatch)
    monkeypatch.setattr('app.services.strategy_runner.get_ohlcv', fake_market_data)
    monkeypatch.setattr('app.services.strategy_runner._run_classic_signal', lambda config, df, last_row: ('long', None))

    result = run_strategy_cycle({
        'strategy_type': 'classic',
        'symbol': 'BTC_USDT',
        'timeframe': '15m',
        'data_source': 'gate',
        'leverage': 100,
        'allocated_margin': 1000,
        'stop_loss_pct': 0.02,
        'take_profit_pct': 0.04,
        'risk_per_trade_pct': 0.01,
        'fee_rate': 0.00015,
        'slippage_rate': 0.0001,
    })

    assert result['action'] == 'rejected'
    assert result['result']['ok'] is False
    assert result['result']['reason'] == 'stop_loss_after_liquidation'
    assert '会先强平后止损' in result['result']['detail']
    assert len(PAPER_BROKER.positions) == 0


def test_runner_allows_entry_when_stop_loss_is_inside_liquidation_buffer(monkeypatch):
    reset_runner_state()
    allow_runner_guards(monkeypatch)
    monkeypatch.setattr('app.services.strategy_runner.get_ohlcv', fake_market_data)
    monkeypatch.setattr('app.services.strategy_runner._run_classic_signal', lambda config, df, last_row: ('long', None))

    result = run_strategy_cycle({
        'strategy_type': 'classic',
        'symbol': 'BTC_USDT',
        'timeframe': '15m',
        'data_source': 'gate',
        'leverage': 20,
        'allocated_margin': 1000,
        'stop_loss_pct': 0.02,
        'take_profit_pct': 0.04,
        'risk_per_trade_pct': 0.01,
        'fee_rate': 0.00015,
        'slippage_rate': 0.0001,
    })

    assert result['action'] == 'open'
    assert result['result']['ok'] is True
    assert len(PAPER_BROKER.positions) == 1
