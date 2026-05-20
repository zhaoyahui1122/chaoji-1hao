from app.services.strategy_runner import run_strategy_cycle
from app.services.market_data import MarketDataUnavailableError
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


def test_runner_blocks_when_gate_data_unavailable(monkeypatch):
    """Runner must not trade when gate data source fails — returns skip_data_unavailable."""
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
    initial_positions = len(PAPER_BROKER.positions)

    def fake_get_ohlcv(symbol, timeframe, source='mock', periods=2000, **kwargs):
        raise MarketDataUnavailableError("gate data unavailable: gate_fetch_failed: timeout — fallback blocked")

    monkeypatch.setattr('app.services.strategy_runner.get_ohlcv', fake_get_ohlcv)

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

    assert result['action'] == 'skip_data_unavailable'
    assert 'unavailable' in result['reason'].lower()
    assert result['market_data']['actual_source'] == 'unavailable'
    # Position must remain untouched
    assert len(PAPER_BROKER.positions) == initial_positions


def test_runner_blocks_entry_when_gate_data_unavailable(monkeypatch):
    """Runner must not open new position when gate data fails."""
    reset_runner_state()
    allow_runner_guards(monkeypatch)

    def fake_get_ohlcv(symbol, timeframe, source='mock', periods=2000, **kwargs):
        raise MarketDataUnavailableError("gate data unavailable: gate_returned_empty_dataframe — fallback blocked")

    monkeypatch.setattr('app.services.strategy_runner.get_ohlcv', fake_get_ohlcv)

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

    assert result['action'] == 'skip_data_unavailable'
    assert len(PAPER_BROKER.positions) == 0


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

    def fake_get_ohlcv(symbol, timeframe, source='mock', periods=2000, **kwargs):
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

    def fake_get_ohlcv(symbol, timeframe, source='mock', periods=2000, **kwargs):
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
