import pandas as pd
from datetime import datetime, timedelta

from app.core.state import PAPER_BROKER
from app.services.strategy_runner import run_strategy_cycle, _classic_entry_cooldown_guard


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


def test_runner_blocks_short_signal_in_long_only_mode(monkeypatch):
    reset_runner_state()
    allow_runner_guards(monkeypatch)
    monkeypatch.setattr('app.services.strategy_runner.get_ohlcv', fake_market_data)
    monkeypatch.setattr('app.services.strategy_runner._run_classic_signal', lambda config, df, last_row: ('short', None))

    result = run_strategy_cycle({
        'strategy_type': 'classic',
        'symbol': 'BTC_USDT',
        'timeframe': '15m',
        'data_source': 'gate',
        'direction_mode': 'long_only',
        'leverage': 20,
        'allocated_margin': 1000,
        'stop_loss_pct': 0.02,
        'take_profit_pct': 0.04,
        'risk_per_trade_pct': 0.01,
        'fee_rate': 0.00015,
        'slippage_rate': 0.0001,
    })

    assert result['action'] == 'skip_direction_mode'
    assert result['direction_guard']['blocked_signal'] == 'short'
    assert len(PAPER_BROKER.positions) == 0


def test_runner_allows_long_signal_in_long_only_mode(monkeypatch):
    reset_runner_state()
    allow_runner_guards(monkeypatch)
    monkeypatch.setattr('app.services.strategy_runner.get_ohlcv', fake_market_data)
    monkeypatch.setattr('app.services.strategy_runner._run_classic_signal', lambda config, df, last_row: ('long', None))

    result = run_strategy_cycle({
        'strategy_type': 'classic',
        'symbol': 'BTC_USDT',
        'timeframe': '15m',
        'data_source': 'gate',
        'direction_mode': 'long_only',
        'leverage': 20,
        'allocated_margin': 1000,
        'stop_loss_pct': 0.02,
        'take_profit_pct': 0.04,
        'risk_per_trade_pct': 0.01,
        'fee_rate': 0.00015,
        'slippage_rate': 0.0001,
    })

    assert result['action'] == 'open'
    assert len(PAPER_BROKER.positions) == 1


def test_classic_cooldown_uses_latest_close_log(monkeypatch):
    now = datetime.utcnow()
    monkeypatch.setattr('app.services.strategy_runner.load_logs', lambda limit=100: [
        {
            'ts': (now - timedelta(hours=2)).isoformat(),
            'result': {'symbol': 'BTC_USDT', 'action': 'close'},
        },
        {
            'ts': (now - timedelta(minutes=5)).isoformat(),
            'result': {'symbol': 'BTC_USDT', 'action': 'close'},
        },
    ])

    guard = _classic_entry_cooldown_guard(
        {'classic_cooldown_bars': 2},
        'BTC_USDT',
        '15m',
    )

    assert guard is not None
    assert guard['reason'] == 'classic_entry_cooldown'
