from __future__ import annotations

from datetime import datetime, time
from typing import Any

import pandas as pd


def _session_allows_entry(timestamp: Any, session: str) -> bool:
    if session == "any":
        return True
    try:
        ts = pd.to_datetime(timestamp)
        current = ts.time()
    except Exception:
        return True

    windows: dict[str, tuple[time, time]] = {
        "asia": (time(0, 0), time(8, 0)),
        "london": (time(7, 0), time(12, 0)),
        "new_york_am": (time(12, 30), time(17, 0)),
    }
    start, end = windows.get(session, windows["new_york_am"])
    return start <= current <= end


def _market_bias(df: pd.DataFrame, ema_period: int = 20) -> str:
    if len(df) < max(ema_period + 3, 8):
        return "neutral"
    ema = df["close"].ewm(span=ema_period, adjust=False).mean()
    last_close = float(df["close"].iloc[-1])
    last_ema = float(ema.iloc[-1])
    prev_ema = float(ema.iloc[-4])
    if last_close > last_ema and last_ema > prev_ema:
        return "bullish"
    if last_close < last_ema and last_ema < prev_ema:
        return "bearish"
    return "neutral"


def _find_recent_fvgs(df: pd.DataFrame, lookback: int, min_width_pct: float) -> list[dict[str, Any]]:
    fvgs: list[dict[str, Any]] = []
    start = max(1, len(df) - lookback)
    for i in range(start, len(df) - 1):
        prev = df.iloc[i - 1]
        nxt = df.iloc[i + 1]
        reference_price = float(df.iloc[i]["close"])
        if reference_price <= 0:
            continue
        if float(nxt["low"]) > float(prev["high"]):
            width = float(nxt["low"]) - float(prev["high"])
            if width / reference_price >= min_width_pct:
                fvgs.append({
                    "type": "bullish",
                    "top": float(nxt["low"]),
                    "bottom": float(prev["high"]),
                    "index": i,
                })
        elif float(nxt["high"]) < float(prev["low"]):
            width = float(prev["low"]) - float(nxt["high"])
            if width / reference_price >= min_width_pct:
                fvgs.append({
                    "type": "bearish",
                    "top": float(prev["low"]),
                    "bottom": float(nxt["high"]),
                    "index": i,
                })
    return fvgs


def _rejected_from_fvg(last: pd.Series, fvg: dict[str, Any]) -> bool:
    open_price = float(last["open"])
    close_price = float(last["close"])
    high = float(last["high"])
    low = float(last["low"])

    if fvg["type"] == "bullish":
        touched = low <= float(fvg["top"]) and close_price >= float(fvg["bottom"])
        rejected = close_price > open_price and close_price > float(fvg["top"])
        return touched and rejected
    touched = high >= float(fvg["bottom"]) and close_price <= float(fvg["top"])
    rejected = close_price < open_price and close_price < float(fvg["bottom"])
    return touched and rejected


def generate_signal(df: pd.DataFrame, config: dict[str, Any]) -> tuple[str | None, dict[str, Any] | None]:
    if df is None or len(df) < 30:
        return None, {"ifvg_signal": None, "ifvg_status": "not_enough_data"}

    session = str(config.get("ifvg_session", "new_york_am"))
    ts = df.iloc[-1].get("timestamp", df.index[-1])
    if not _session_allows_entry(ts, session):
        return None, {"ifvg_signal": None, "ifvg_status": "outside_session", "ifvg_session": session}

    risk_reward = float(config.get("ifvg_risk_reward", 1.5))
    lookback = int(config.get("ifvg_fvg_lookback", 80))
    min_width_pct = float(config.get("ifvg_min_fvg_width_pct", 0.0002))
    require_bias = bool(config.get("ifvg_require_bias", True))
    ema_period = int(config.get("ifvg_bias_ema_period", 20))

    bias = _market_bias(df, ema_period=ema_period)
    fvgs = _find_recent_fvgs(df, lookback=lookback, min_width_pct=min_width_pct)
    if not fvgs:
        return None, {"ifvg_signal": None, "ifvg_status": "waiting_for_fvg", "ifvg_bias": bias}

    last = df.iloc[-1]
    for fvg in reversed(fvgs):
        signal = "long" if fvg["type"] == "bullish" else "short"
        if require_bias and ((signal == "long" and bias == "bearish") or (signal == "short" and bias == "bullish")):
            continue
        if not _rejected_from_fvg(last, fvg):
            continue

        entry = float(last["close"])
        if signal == "long":
            stop_loss = float(fvg["bottom"])
            risk = entry - stop_loss
            if risk <= 0:
                continue
            take_profit = entry + risk * risk_reward
        else:
            stop_loss = float(fvg["top"])
            risk = stop_loss - entry
            if risk <= 0:
                continue
            take_profit = entry - risk * risk_reward

        return signal, {
            "ifvg_signal": signal,
            "ifvg_status": "confirmed_key_level_rejection",
            "ifvg_bias": bias,
            "ifvg_session": session,
            "ifvg_top": fvg["top"],
            "ifvg_bottom": fvg["bottom"],
            "stop_loss_price": round(stop_loss, 4),
            "take_profit_price": round(take_profit, 4),
            "risk_reward": risk_reward,
            "entry_price": round(entry, 4),
        }

    return None, {
        "ifvg_signal": None,
        "ifvg_status": "waiting_for_key_level_rejection",
        "ifvg_bias": bias,
        "ifvg_session": session,
    }
