"""MACD Trend + Divergence Strategy.

Two entry modes:
1. Trend breakout: MACD golden/death cross + price breakout of recent high/low
2. Divergence reversal: price-MACD divergence + breakout confirmation

Exit: dynamic trailing stop (no fixed take-profit).
Signal timeout: signals expire after N bars if not triggered.
"""

from __future__ import annotations

from typing import Any

import pandas as pd


# ──────────────────────────── Indicators ────────────────────────────


def compute_indicators(
    df: pd.DataFrame,
    macd_fast: int = 12,
    macd_slow: int = 26,
    macd_signal: int = 9,
) -> pd.DataFrame:
    """Add MACD line, signal line, and histogram to the DataFrame."""
    data = df.copy()
    ema_fast = data["close"].ewm(span=macd_fast, adjust=False).mean()
    ema_slow = data["close"].ewm(span=macd_slow, adjust=False).mean()
    data["macd_line"] = ema_fast - ema_slow
    data["macd_signal_line"] = data["macd_line"].ewm(span=macd_signal, adjust=False).mean()
    data["macd_hist"] = data["macd_line"] - data["macd_signal_line"]
    return data


# ──────────────────────── Crossover Detection ───────────────────────


def _detect_crossovers(df: pd.DataFrame) -> pd.Series:
    """Detect MACD golden/death crosses.

    Returns a Series with values: 'golden', 'death', or None.
    """
    macd = df["macd_line"]
    signal = df["macd_signal_line"]
    prev_macd = macd.shift(1)
    prev_signal = signal.shift(1)

    golden = (prev_macd <= prev_signal) & (macd > signal)
    death = (prev_macd >= prev_signal) & (macd < signal)

    result = pd.Series(None, index=df.index, dtype=object)
    result[golden] = "golden"
    result[death] = "death"
    return result


# ──────────────────────── Swing High/Low ────────────────────────────


def _rolling_high(series: pd.Series, lookback: int) -> pd.Series:
    """Rolling max of previous `lookback` bars (exclusive of current)."""
    return series.shift(1).rolling(window=lookback, min_periods=1).max()


def _rolling_low(series: pd.Series, lookback: int) -> pd.Series:
    """Rolling min of previous `lookback` bars (exclusive of current)."""
    return series.shift(1).rolling(window=lookback, min_periods=1).min()


# ──────────────────────── Divergence Detection ──────────────────────


def _detect_divergence(
    df: pd.DataFrame,
    lookback: int = 30,
    macd_line_col: str = "macd_line",
) -> pd.Series:
    """Detect bullish/bearish divergence between price and MACD.

    Bullish divergence: price makes lower low, but MACD makes higher low, MACD < 0.
    Bearish divergence: price makes higher high, but MACD makes lower high, MACD > 0.

    Compares current swing vs previous swing within lookback window.
    Returns: 'bullish', 'bearish', or None.
    """
    close = df["close"]
    macd = df[macd_line_col]
    result = pd.Series(None, index=df.index, dtype=object)

    # Find local minima/maxima indices
    for i in range(lookback * 2, len(df)):
        window_start = max(0, i - lookback)
        prev_window_start = max(0, window_start - lookback)

        # Current window lows/highs
        curr_low_idx = close.iloc[window_start:i].idxmin()
        prev_low_idx = close.iloc[prev_window_start:window_start].idxmin() if window_start > prev_window_start else None

        curr_high_idx = close.iloc[window_start:i].idxmax()
        prev_high_idx = close.iloc[prev_window_start:window_start].idxmax() if window_start > prev_window_start else None

        # Bullish divergence
        if prev_low_idx is not None:
            curr_low_price = close.loc[curr_low_idx]
            prev_low_price = close.loc[prev_low_idx]
            curr_low_macd = macd.loc[curr_low_idx]
            prev_low_macd = macd.loc[prev_low_idx]
            if (curr_low_price < prev_low_price
                    and curr_low_macd > prev_low_macd
                    and curr_low_macd < 0):
                result.iloc[i] = "bullish"

        # Bearish divergence
        if prev_high_idx is not None:
            curr_high_price = close.loc[curr_high_idx]
            prev_high_price = close.loc[prev_high_idx]
            curr_high_macd = macd.loc[curr_high_idx]
            prev_high_macd = macd.loc[prev_high_idx]
            if (curr_high_price > prev_high_price
                    and curr_high_macd < prev_high_macd
                    and curr_high_macd > 0):
                result.iloc[i] = "bearish"

    return result


# ──────────────────────── Signal Generation ─────────────────────────


def generate_signal(
    row: Any,
    *,
    trend_enabled: bool = True,
    divergence_enabled: bool = True,
    signal_expiry: int = 20,
    breakout_lookback: int = 20,
    divergence_confirm_lookback: int = 10,
    # Internal state (maintained by prepare_signals or caller)
    _state: dict[str, Any] | None = None,
) -> tuple[str | None, dict[str, Any] | None]:
    """Generate a trading signal for a single bar.

    This is a simplified interface for the runner. For backtesting,
    use `prepare_signals()` which handles state across all bars.

    Returns (signal, extra_meta) where signal is 'long', 'short', or None.
    """
    if _state is None:
        _state = {}

    signal = None
    extra: dict[str, Any] = {}

    crossover = getattr(row, "_crossover", None)
    bullish_div = getattr(row, "_divergence", None) == "bullish"
    bearish_div = getattr(row, "_divergence", None) == "bearish"
    breakout_high = getattr(row, "_breakout_high", None)
    breakout_low = getattr(row, "_breakout_low", None)
    confirm_high = getattr(row, "_confirm_high", None)
    confirm_low = getattr(row, "_confirm_low", None)

    price = float(row["close"])

    # --- Trend entry ---
    if trend_enabled:
        pending = _state.get("pending_crossover")
        pending_age = _state.get("pending_crossover_age", 0)

        if crossover in ("golden", "death"):
            _state["pending_crossover"] = crossover
            _state["pending_crossover_age"] = 0
            pending = crossover
            pending_age = 0
        elif pending:
            pending_age += 1
            if pending_age > signal_expiry:
                _state.pop("pending_crossover", None)
                _state.pop("pending_crossover_age", None)
                pending = None
                pending_age = 0

        if pending == "golden" and breakout_high is not None and price > breakout_high:
            signal = "long"
            extra["signal_source"] = "trend"
            _state.pop("pending_crossover", None)
            _state.pop("pending_crossover_age", None)
        elif pending == "death" and breakout_low is not None and price < breakout_low:
            signal = "short"
            extra["signal_source"] = "trend"
            _state.pop("pending_crossover", None)
            _state.pop("pending_crossover_age", None)

    # --- Divergence entry ---
    if divergence_enabled and signal is None:
        pending_div = _state.get("pending_divergence")
        pending_div_age = _state.get("pending_divergence_age", 0)

        if bullish_div:
            _state["pending_divergence"] = "bullish"
            _state["pending_divergence_age"] = 0
            pending_div = "bullish"
            pending_div_age = 0
        elif bearish_div:
            _state["pending_divergence"] = "bearish"
            _state["pending_divergence_age"] = 0
            pending_div = "bearish"
            pending_div_age = 0
        elif pending_div:
            pending_div_age += 1
            if pending_div_age > signal_expiry:
                _state.pop("pending_divergence", None)
                _state.pop("pending_divergence_age", None)
                pending_div = None
                pending_div_age = 0

        if pending_div == "bullish" and confirm_high is not None and price > confirm_high:
            signal = "long"
            extra["signal_source"] = "divergence"
            _state.pop("pending_divergence", None)
            _state.pop("pending_divergence_age", None)
        elif pending_div == "bearish" and confirm_low is not None and price < confirm_low:
            signal = "short"
            extra["signal_source"] = "divergence"
            _state.pop("pending_divergence", None)
            _state.pop("pending_divergence_age", None)

    return signal, extra if extra else None


# ──────────────────────── Full Pipeline ─────────────────────────────


def prepare_signals(
    df: pd.DataFrame,
    config: dict[str, Any],
) -> pd.DataFrame:
    """Compute indicators and generate signals for all bars.

    Returns a copy of df with additional columns:
    - macd_line, macd_signal_line, macd_hist
    - crossover: 'golden', 'death', or None
    - divergence: 'bullish', 'bearish', or None
    - signal: 'long', 'short', or None
    - signal_source: 'trend', 'divergence', or None
    """
    macd_fast = int(config.get("macd_fast", 12))
    macd_slow = int(config.get("macd_slow", 26))
    macd_signal_period = int(config.get("macd_signal", 9))
    trend_enabled = bool(config.get("macd_trend_enabled", True))
    divergence_enabled = bool(config.get("macd_divergence_enabled", True))
    signal_expiry = int(config.get("macd_signal_expiry", 20))
    breakout_lookback = int(config.get("macd_breakout_lookback", 20))
    div_confirm_lookback = int(config.get("macd_divergence_confirm_lookback", 10))

    data = compute_indicators(df, macd_fast, macd_slow, macd_signal_period)
    data["_crossover"] = _detect_crossovers(data)
    data["_divergence"] = _detect_divergence(data, lookback=max(breakout_lookback, div_confirm_lookback, 30))

    # Pre-compute rolling breakout levels
    data["_breakout_high"] = _rolling_high(data["high"], breakout_lookback)
    data["_breakout_low"] = _rolling_low(data["low"], breakout_lookback)
    data["_confirm_high"] = _rolling_high(data["high"], div_confirm_lookback)
    data["_confirm_low"] = _rolling_low(data["low"], div_confirm_lookback)

    # Run signal generation with state across all bars
    signals: list[str | None] = []
    sources: list[str | None] = []
    state: dict[str, Any] = {}

    for _, row in data.iterrows():
        sig, meta = generate_signal(
            row,
            trend_enabled=trend_enabled,
            divergence_enabled=divergence_enabled,
            signal_expiry=signal_expiry,
            breakout_lookback=breakout_lookback,
            divergence_confirm_lookback=div_confirm_lookback,
            _state=state,
        )
        signals.append(sig)
        sources.append(meta.get("signal_source") if meta else None)

    data["signal"] = signals
    data["signal_source"] = sources
    return data
