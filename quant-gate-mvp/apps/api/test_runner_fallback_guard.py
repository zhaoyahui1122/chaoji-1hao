from app.services.strategy_runner import run_strategy_cycle
from app.core.state import PAPER_BROKER
import pandas as pd


def reset_runner_state():
    PAPER_BROKER.reset()


def allow_runner_guards(monkeypatch):
    monkeypatch.setattr('app.services.strategy_runner.evaluate_runner_guards', lambda: {
        'allowed': True,
        'halt_reason': None,
        'consecutive_loss_count': 0,
        'daily_realized_pnl': 0.0,
        'daily_loss_ratio': 0.0,
        'total_notional': 0,
        'exposure_ratio': 0.0,
    })


def test_runner_skips_mock_fallback_when_open_position(monkeypatch):
    reset_runner_state()
    allow_runner_guards(monkeypatch)
    PAPER_BROKER.place_order(
        symbol='BTC_USDT',
        side='long',
        price=81000,
        leverage=5,
        allocated_margin=1000,
        stop_loss_price=79380,
        source='runner',
    )
    initial_order_count = len(PAPER_BROKER.orders)

    def fake_get_ohlcv(symbol, timeframe, source='mock', periods=2000):
        return pd.DataFrame([
            {'timestamp': 1, 'open': 63590.12, 'high': 63590.12, 'low': 63590.12, 'close': 63590.12, 'volume': 1}
        ]), {
            'requested_source': 'gate',
            'actual_source': 'mock',
            'fallback_used': True,
            'warning': 'gate_fetch_failed: timeout',
        }

    monkeypatch.setattr('app.services.strategy_runner.get_ohlcv', fake_get_ohlcv)
    monkeypatch.setattr('app.services.strategy_runner._run_turtle_signal', lambda config, df, last_row: (None, {'atr': 0.0, 'turtle_signal': None, 'regime': 'turtle', 'adx': 0.0, 'rsi': 0.0}))

    result = run_strategy_cycle({
        'strategy_type': 'turtle',
        'symbol': 'BTC_USDT',
        'timeframe': '15m',
        'data_source': 'gate',
        'leverage': 5,
        'allocated_margin': 1000,
        'stop_loss_pct': 0.02,
        'take_profit_pct': 0.04,
        'risk_per_trade_pct': 0.01,
        'fee_rate': 0.00015,
        'slippage_rate': 0.0001,
    })

    assert result['action'] == 'skip_fallback_market'
    assert result['reason'] == 'market_data_fallback_with_open_position'
    assert result['market_data']['actual_source'] == 'mock'
    assert len(PAPER_BROKER.positions) == 1
    assert len(PAPER_BROKER.orders) == initial_order_count
    assert PAPER_BROKER.positions[0].mark_price != 63590.12


def test_runner_closes_long_on_candle_low_stop_loss(monkeypatch):
    reset_runner_state()
    allow_runner_guards(monkeypatch)
    PAPER_BROKER.place_order(
        symbol='BTC_USDT',
        side='long',
        price=81000,
        leverage=5,
        allocated_margin=1000,
        stop_loss_price=80190,
        source='runner',
        meta={'take_profit_price': 82620},
    )

    def fake_get_ohlcv(symbol, timeframe, source='mock', periods=2000):
        return pd.DataFrame([
            {'timestamp': 1, 'open': 81000.0, 'high': 81080.0, 'low': 80150.0, 'close': 80550.0, 'volume': 1}
        ]), {
            'requested_source': 'gate',
            'actual_source': 'gate',
            'fallback_used': False,
            'warning': None,
        }

    monkeypatch.setattr('app.services.strategy_runner.get_ohlcv', fake_get_ohlcv)
    monkeypatch.setattr('app.services.strategy_runner._run_turtle_signal', lambda config, df, last_row: (None, {'atr': 0.0, 'turtle_signal': None, 'regime': 'turtle', 'adx': 0.0, 'rsi': 0.0}))

    result = run_strategy_cycle({
        'strategy_type': 'turtle',
        'symbol': 'BTC_USDT',
        'timeframe': '15m',
        'data_source': 'gate',
        'leverage': 5,
        'allocated_margin': 1000,
        'stop_loss_pct': 0.01,
        'take_profit_pct': 0.02,
        'risk_per_trade_pct': 0.01,
        'fee_rate': 0.00015,
        'slippage_rate': 0.0001,
    })

    assert result['action'] == 'close'
    assert result['close_reason'] == 'stop_loss'
    assert result['trigger_price'] == 80190
    assert len(PAPER_BROKER.positions) == 0


def test_runner_closes_long_on_candle_high_take_profit(monkeypatch):
    reset_runner_state()
    allow_runner_guards(monkeypatch)
    PAPER_BROKER.place_order(
        symbol='BTC_USDT',
        side='long',
        price=81000,
        leverage=5,
        allocated_margin=1000,
        stop_loss_price=79380,
        source='runner',
        meta={'take_profit_price': 81810},
    )

    def fake_get_ohlcv(symbol, timeframe, source='mock', periods=2000):
        return pd.DataFrame([
            {'timestamp': 1, 'open': 81000.0, 'high': 81850.0, 'low': 80920.0, 'close': 81200.0, 'volume': 1}
        ]), {
            'requested_source': 'gate',
            'actual_source': 'gate',
            'fallback_used': False,
            'warning': None,
        }

    monkeypatch.setattr('app.services.strategy_runner.get_ohlcv', fake_get_ohlcv)
    monkeypatch.setattr('app.services.strategy_runner._run_turtle_signal', lambda config, df, last_row: (None, {'atr': 0.0, 'turtle_signal': None, 'regime': 'turtle', 'adx': 0.0, 'rsi': 0.0}))

    result = run_strategy_cycle({
        'strategy_type': 'turtle',
        'symbol': 'BTC_USDT',
        'timeframe': '15m',
        'data_source': 'gate',
        'leverage': 5,
        'allocated_margin': 1000,
        'stop_loss_pct': 0.02,
        'take_profit_pct': 0.01,
        'risk_per_trade_pct': 0.01,
        'fee_rate': 0.00015,
        'slippage_rate': 0.0001,
    })

    assert result['action'] == 'close'
    assert result['close_reason'] == 'take_profit'
    assert result['trigger_price'] == 81810
    assert len(PAPER_BROKER.positions) == 0


