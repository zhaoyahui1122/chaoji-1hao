from __future__ import annotations

import importlib
import sys
from datetime import UTC, datetime
from types import SimpleNamespace

import pandas as pd
from fastapi.testclient import TestClient



class FixedDateTime(datetime):
    @classmethod
    def now(cls, tz=None):
        current = cls(2026, 6, 4, 12, 0, 0, tzinfo=UTC)
        if tz is None:
            return current.replace(tzinfo=None)
        return current.astimezone(tz)


def _reload_main_module():
    for module_name in (
        'app.api.routes_backtest',
        'app.api.routes',
        'app.services.auth_service',
        'app.main',
    ):
        sys.modules.pop(module_name, None)
    return importlib.import_module('app.main')


def _build_client(monkeypatch):
    monkeypatch.setenv('ADMIN_USERNAME', 'admin')
    monkeypatch.setenv('ADMIN_PASSWORD_HASH', 'fcf730b6d95236ecd3c9fc2d92d7b6b2bb061514961aec041d6c7a7192f592e4')
    monkeypatch.setenv('SESSION_SECRET', 'test-session-secret')

    main_module = _reload_main_module()
    routes_backtest = importlib.import_module('app.api.routes_backtest')

    calls: list[dict[str, object]] = []

    def fake_get_ohlcv(symbol, timeframe, source, periods, start_time, end_time):
            calls.append({
                'symbol': symbol,
                'timeframe': timeframe,
                'source': source,
                'periods': periods,
                'start_time': start_time,
                'end_time': end_time,
            })
            frame = pd.DataFrame([
                {
                    'timestamp': datetime(2026, 6, 1, tzinfo=UTC),
                    'open': 100.0,
                    'high': 101.0,
                    'low': 99.0,
                    'close': 100.5,
                    'volume': 1.0,
                }
            ])
            return frame, {
                'requested_source': source,
                'actual_source': source,
                'fallback_used': False,
                'warning': None,
                'candles': 1,
                'actual_window_start': '2026-06-01T00:00:00+00:00',
                'actual_window_end': '2026-06-01T00:00:00+00:00',
            }

    class FakeBacktester:
            def __init__(self, initial_balance):
                self.initial_balance = initial_balance

            def run(self, data, payload, df_4h=None, df_1h=None):
                return SimpleNamespace(
                    summary={
                        'return_pct': 1.23,
                        'max_drawdown_pct': 0.45,
                        'win_rate_pct': 50.0,
                        'trades': 1,
                        'ending_equity': 10123.0,
                        'gross_pnl': 150.0,
                        'fees': 10.0,
                        'slippage_cost': 5.0,
                        'net_pnl': 135.0,
                        'total_gross_pnl': 150.0,
                        'total_fees': 10.0,
                        'total_slippage_cost': 5.0,
                        'total_net_pnl': 135.0,
                    },
                    equity_curve=[{'timestamp': '2026-06-01T00:00:00Z', 'equity': 10123.0}],
                    trades=[],
                )

    monkeypatch.setattr(routes_backtest, 'get_ohlcv', fake_get_ohlcv)
    monkeypatch.setattr(routes_backtest, 'SimpleBacktester', FakeBacktester)
    monkeypatch.setattr(routes_backtest, 'datetime', FixedDateTime)

    main_module.app.state.limiter.enabled = False
    client = TestClient(main_module.app)
    login_response = client.post('/auth/login', json={'username': 'admin', 'password': 'secret123'})
    assert login_response.status_code == 200
    return client, calls


def test_backtest_accepts_custom_date_range(monkeypatch):
    client, calls = _build_client(monkeypatch)

    response = client.post(
        '/backtest',
        json={
            'strategy_type': 'classic',
            'symbol': 'BTC_USDT',
            'timeframe': '15m',
            'data_source': 'mock',
            'start_date': '2026-06-01',
            'end_date': '2026-06-30',
            'backtest_days': 7,
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body['input']['start_date'] == '2026-06-01'
    assert body['input']['end_date'] == '2026-06-30'
    assert body['market_data']['actual_window_start'] == '2026-06-01T00:00:00+00:00'
    assert body['market_data']['actual_window_end'] == '2026-06-01T00:00:00+00:00'
    assert calls[0]['start_time'] == datetime(2026, 6, 1, 0, 0, tzinfo=UTC)
    assert calls[0]['end_time'] == datetime(2026, 7, 1, 0, 0, tzinfo=UTC)


def test_backtest_rejects_start_date_after_end_date(monkeypatch):
    client, _ = _build_client(monkeypatch)

    response = client.post(
        '/backtest',
        json={
            'start_date': '2026-06-30',
            'end_date': '2026-06-01',
        },
    )

    assert response.status_code == 422
    assert 'start_date' in response.json()['detail']


def test_backtest_rejects_date_range_over_365_days(monkeypatch):
    client, _ = _build_client(monkeypatch)

    response = client.post(
        '/backtest',
        json={
            'start_date': '2025-01-01',
            'end_date': '2026-01-02',
        },
    )

    assert response.status_code == 422
    assert '365' in response.json()['detail']


def test_backtest_keeps_backtest_days_when_custom_dates_missing(monkeypatch):
    client, calls = _build_client(monkeypatch)

    response = client.post(
        '/backtest',
        json={
            'backtest_days': 30,
            'symbol': 'BTC_USDT',
            'timeframe': '15m',
        },
    )

    assert response.status_code == 200
    assert response.json()['input']['backtest_days'] == 30
    assert calls[0]['start_time'] == datetime(2026, 5, 5, 12, 0, tzinfo=UTC)
    assert calls[0]['end_time'] == datetime(2026, 6, 4, 12, 0, tzinfo=UTC)
