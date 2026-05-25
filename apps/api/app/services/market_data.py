from __future__ import annotations

from datetime import UTC, datetime, timedelta
import math

import pandas as pd

from app.core.log_config import get_logger
from app.services.gate_market_data import fetch_gate_futures_candles

logger = get_logger(__name__)


class MarketDataUnavailableError(Exception):
    """Raised when real market data cannot be fetched and fallback is not allowed."""


TIMEFRAME_MINUTES = {
    "5m": 5,
    "15m": 15,
    "30m": 30,
    "1h": 60,
    "4h": 240,
}


def timeframe_to_minutes(timeframe: str) -> int:
    return TIMEFRAME_MINUTES.get(timeframe, 15)


def _normalize_timestamp(value: int | float | str | pd.Timestamp) -> int:
    if isinstance(value, pd.Timestamp):
        return int(value.timestamp())
    if isinstance(value, str):
        return int(datetime.fromisoformat(value).timestamp())
    return int(value)


def _trim_ohlcv_window(df: pd.DataFrame, start_ts: int | None = None, end_ts: int | None = None) -> pd.DataFrame:
    if df.empty:
        return df
    trimmed = df.copy()
    normalized_ts = trimmed["timestamp"].map(_normalize_timestamp)
    if start_ts is not None:
        trimmed = trimmed[normalized_ts >= int(start_ts)]
        normalized_ts = normalized_ts[normalized_ts >= int(start_ts)]
    if end_ts is not None:
        trimmed = trimmed[normalized_ts <= int(end_ts)]
    return trimmed.reset_index(drop=True)


def generate_mock_ohlcv(
    symbol: str,
    timeframe: str,
    periods: int = 300,
    end_time: datetime | None = None,
) -> pd.DataFrame:
    step = timeframe_to_minutes(timeframe)
    now = end_time or datetime.now(UTC)
    base_price = 64000 if symbol == "BTC_USDT" else 3200 if symbol == "ETH_USDT" else max(1.0, abs(hash(symbol)) % 1000)
    rows = []
    for i in range(periods):
        ts = now - timedelta(minutes=step * (periods - i))
        drift = math.sin(i / 8) * (base_price * 0.01)
        wave = math.cos(i / 21) * (base_price * 0.006)
        close = base_price + drift + wave
        open_ = close * (1 - 0.001)
        high = close * 1.002
        low = close * 0.998
        volume = 100 + i
        rows.append(
            {
                "timestamp": ts.isoformat(),
                "open": open_,
                "high": high,
                "low": low,
                "close": close,
                "volume": volume,
            }
        )
    return pd.DataFrame(rows)


def get_ohlcv(
    symbol: str,
    timeframe: str,
    source: str = "mock",
    periods: int = 2000,
    start_time: datetime | None = None,
    end_time: datetime | None = None,
    allow_fallback: bool = False,
) -> tuple[pd.DataFrame, dict]:
    start_ts = int(start_time.timestamp()) if start_time is not None else None
    end_ts = int(end_time.timestamp()) if end_time is not None else None
    meta = {
        "requested_source": source,
        "actual_source": "mock",
        "fallback_used": source == "gate",
        "warning": None,
        "requested_window_start": start_time.isoformat() if start_time else None,
        "requested_window_end": end_time.isoformat() if end_time else None,
        "requested_periods": int(periods),
    }

    if source == "gate":
        try:
            fetch_limit = periods
            if start_ts is not None and end_ts is not None:
                step_seconds = timeframe_to_minutes(timeframe) * 60
                window_seconds = max(end_ts - start_ts, step_seconds)
                expected_periods = max(1, math.ceil(window_seconds / step_seconds) + 2)
                fetch_limit = max(periods, expected_periods)
            df = fetch_gate_futures_candles(
                symbol,
                timeframe,
                limit=max(1, fetch_limit),
                from_ts=start_ts,
                to_ts=end_ts,
            )
            df = _trim_ohlcv_window(df, start_ts=start_ts, end_ts=end_ts)
            if not df.empty:
                meta["actual_source"] = "gate"
                meta["fallback_used"] = False
                meta["candles"] = int(len(df))
                if len(df) < periods:
                    meta["warning"] = f"gate_returned_{len(df)}_candles_below_requested_{periods}"
                return df, meta
            meta["warning"] = "gate_returned_empty_dataframe"
        except Exception as exc:
            logger.warning("Gate data fetch failed for %s: %s", symbol, exc)
            meta["warning"] = f"gate_fetch_failed: {exc}"

        if not allow_fallback:
            raise MarketDataUnavailableError(
                f"gate data unavailable: {meta['warning']} — fallback blocked"
            )

    mock_periods = periods
    if start_ts is not None and end_ts is not None:
        step_seconds = timeframe_to_minutes(timeframe) * 60
        window_seconds = max(end_ts - start_ts, step_seconds)
        mock_periods = max(periods, math.ceil(window_seconds / step_seconds) + 2)
    df = generate_mock_ohlcv(symbol, timeframe, periods=mock_periods, end_time=end_time)
    df = _trim_ohlcv_window(df, start_ts=start_ts, end_ts=end_ts)
    meta["candles"] = int(len(df))
    return df, meta
