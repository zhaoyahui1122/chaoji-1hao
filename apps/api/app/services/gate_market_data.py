from __future__ import annotations

from typing import Any
import time

import pandas as pd
import requests


GATE_FUTURES_CANDLES_URL = "https://api.gateio.ws/api/v4/futures/usdt/candlesticks"
GATE_FUTURES_TICKERS_URL = "https://api.gateio.ws/api/v4/futures/usdt/tickers"
GATE_RETRY_ATTEMPTS = 3
GATE_RETRY_DELAY_SECONDS = 1.0
GATE_MAX_CANDLES_PER_REQUEST = 2000


def timeframe_to_gate_interval(timeframe: str) -> str:
    mapping = {
        "5m": "5m",
        "15m": "15m",
        "30m": "30m",
        "1h": "1h",
        "4h": "4h",
    }
    return mapping.get(str(timeframe), "15m")


def symbol_to_gate_contract(symbol: str) -> str:
    return str(symbol).upper()


def timeframe_to_seconds(timeframe: str) -> int:
    mapping = {
        "5m": 5 * 60,
        "15m": 15 * 60,
        "30m": 30 * 60,
        "1h": 60 * 60,
        "4h": 4 * 60 * 60,
    }
    return mapping.get(str(timeframe), 15 * 60)


def _gate_get(url: str, params: dict[str, Any], timeout: float):
    last_error: Exception | None = None
    for attempt in range(1, GATE_RETRY_ATTEMPTS + 1):
        try:
            return requests.get(url, params=params, timeout=timeout)
        except requests.RequestException as exc:
            last_error = exc
            if attempt == GATE_RETRY_ATTEMPTS:
                break
            time.sleep(GATE_RETRY_DELAY_SECONDS)
    raise RuntimeError(f"gate_request_failed_after_{GATE_RETRY_ATTEMPTS}_attempts: {last_error}")


def fetch_gate_futures_ticker(symbol: str) -> dict[str, Any]:
    contract = symbol_to_gate_contract(symbol)
    resp = _gate_get(GATE_FUTURES_TICKERS_URL, params={"contract": contract}, timeout=15)
    resp.raise_for_status()
    raw = resp.json()
    if not isinstance(raw, list) or not raw:
        raise ValueError("gate_ticker_empty")
    ticker = raw[0]
    if not isinstance(ticker, dict):
        raise ValueError("gate_ticker_invalid")

    last_price = float(ticker.get("last") or 0)
    mark_price = float(ticker.get("mark_price") or last_price or 0)
    index_price = float(ticker.get("index_price") or mark_price or last_price or 0)
    if last_price <= 0:
        raise ValueError("gate_ticker_last_price_invalid")

    return {
        "symbol": contract,
        "last_price": last_price,
        "mark_price": mark_price,
        "index_price": index_price,
        "funding_rate": float(ticker.get("funding_rate") or 0),
        "volume_24h": float(ticker.get("volume_24h") or 0),
        "raw": ticker,
    }


def fetch_gate_futures_candles(
    symbol: str,
    timeframe: str,
    limit: int = 200,
    from_ts: int | None = None,
    to_ts: int | None = None,
) -> pd.DataFrame:
    contract = symbol_to_gate_contract(symbol)
    base_params: dict[str, Any] = {
        "contract": contract,
        "interval": timeframe_to_gate_interval(timeframe),
    }

    def fetch_rows(request_params: dict[str, Any]) -> list[dict[str, float | int]]:
        resp = _gate_get(GATE_FUTURES_CANDLES_URL, params=request_params, timeout=20)
        resp.raise_for_status()
        raw = resp.json()

        rows: list[dict[str, float | int]] = []
        for item in raw:
            if not isinstance(item, dict):
                continue
            rows.append(
                {
                    "timestamp": int(item.get("t", 0)),
                    "volume": float(item.get("v", 0) or 0),
                    "close": float(item.get("c", 0) or 0),
                    "high": float(item.get("h", 0) or 0),
                    "low": float(item.get("l", 0) or 0),
                    "open": float(item.get("o", 0) or 0),
                }
            )
        return rows

    rows: list[dict[str, float | int]] = []
    if from_ts is not None or to_ts is not None:
        step_seconds = timeframe_to_seconds(timeframe)
        normalized_from = int(from_ts) if from_ts is not None else int(to_ts) - (step_seconds * (max(1, int(limit)) - 1))
        normalized_to = int(to_ts) if to_ts is not None else normalized_from + (step_seconds * (max(1, int(limit)) - 1))
        chunk_span_seconds = step_seconds * (GATE_MAX_CANDLES_PER_REQUEST - 1)
        cursor = normalized_from

        while cursor <= normalized_to:
            chunk_to = min(normalized_to, cursor + chunk_span_seconds)
            request_params = {
                **base_params,
                "from": int(cursor),
                "to": int(chunk_to),
            }
            rows.extend(fetch_rows(request_params))
            cursor = chunk_to + step_seconds
    else:
        request_params = {
            **base_params,
            "limit": max(1, min(int(limit), GATE_MAX_CANDLES_PER_REQUEST)),
        }
        rows = fetch_rows(request_params)

    df = pd.DataFrame(rows, columns=["timestamp", "volume", "close", "high", "low", "open"])
    if not df.empty:
        df = df[df["timestamp"] > 0].sort_values("timestamp").drop_duplicates(subset=["timestamp"]).reset_index(drop=True)
    return df
