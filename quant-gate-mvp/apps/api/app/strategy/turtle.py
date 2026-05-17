"""
Adaptive Strategy: Turtle (Trend) + Mean Reversion with RSI + Bollinger Bands

Logic:
  - ADX > adx_threshold  → Trending → Use Turtle (Donchian breakout)
  - ADX < adx_threshold  → Ranging  → Use RSI + Bollinger Bands Mean Reversion
  - ADX between threshold and threshold-5 → Hold previous mode (hysteresis)

Turtle Entry:
  - Long:  close > highest high of last `entry_period` bars
  - Short: close < lowest low of last `entry_period` bars

Turtle Exit:
  - Long exit:  close < lowest low of last `exit_period` bars
  - Short exit: close > highest high of last `exit_period` bars

Mean Reversion Entry (RSI + Bollinger Bands — BOTH must confirm):
  - Long:  close <= bb_lower AND RSI < rsi_oversold
  - Short: close >= bb_upper AND RSI > rsi_overbought

Mean Reversion Exit:
  - exit_long:  RSI > 50
  - exit_short: RSI < 50
"""
from __future__ import annotations

import numpy as np
import pandas as pd


# ──────────────────────────────────────────────
# Indicator calculations
# ──────────────────────────────────────────────

def _calc_rsi(series: pd.Series, period: int = 14) -> pd.Series:
    """Calculate RSI using exponential moving average method."""
    delta = series.diff()
    gain = delta.where(delta > 0, 0.0)
    loss = (-delta).where(delta < 0, 0.0)
    avg_gain = gain.ewm(com=period - 1, min_periods=period).mean()
    avg_loss = loss.ewm(com=period - 1, min_periods=period).mean()
    rs = avg_gain / avg_loss.replace(0, np.nan)
    rsi = 100 - (100 / (1 + rs))
    return rsi


def _calc_adx(df: pd.DataFrame, period: int = 14) -> pd.Series:
    """Calculate ADX (Average Directional Index)."""
    high = df["high"]
    low = df["low"]
    close = df["close"]

    tr1 = high - low
    tr2 = (high - close.shift(1)).abs()
    tr3 = (low - close.shift(1)).abs()
    tr = pd.concat([tr1, tr2, tr3], axis=1).max(axis=1)

    up_move = high - high.shift(1)
    down_move = low.shift(1) - low
    plus_dm = pd.Series(np.where((up_move > down_move) & (up_move > 0), up_move, 0.0), index=df.index)
    minus_dm = pd.Series(np.where((down_move > up_move) & (down_move > 0), down_move, 0.0), index=df.index)

    atr = tr.ewm(alpha=1.0 / period, min_periods=period).mean()
    plus_di = 100 * (plus_dm.ewm(alpha=1.0 / period, min_periods=period).mean() / atr)
    minus_di = 100 * (minus_dm.ewm(alpha=1.0 / period, min_periods=period).mean() / atr)

    di_sum = plus_di + minus_di
    di_diff = (plus_di - minus_di).abs()
    dx = 100 * (di_diff / di_sum.replace(0, np.nan))
    adx = dx.ewm(alpha=1.0 / period, min_periods=period).mean()

    return adx


def _calc_bollinger(close: pd.Series, period: int = 20, std_dev: float = 2.0):
    """Calculate Bollinger Bands."""
    mid = close.rolling(period).mean()
    std = close.rolling(period).std()
    upper = mid + std_dev * std
    lower = mid - std_dev * std
    return upper, mid, lower


def compute_indicators(
    df: pd.DataFrame,
    entry_period: int = 20,
    exit_period: int = 10,
    atr_period: int = 14,
    adx_period: int = 14,
    rsi_period: int = 14,
    bb_period: int = 20,
    bb_std: float = 2.0,
) -> pd.DataFrame:
    """Compute all indicators: Donchian, ATR, ADX, RSI, Bollinger Bands."""
    data = df.copy()

    # ── Donchian Channel (Turtle) ──
    data["dc_upper"] = data["high"].rolling(entry_period).max()
    data["dc_lower"] = data["low"].rolling(entry_period).min()
    data["dc_mid"] = (data["dc_upper"] + data["dc_lower"]) / 2
    data["dc_exit_upper"] = data["high"].rolling(exit_period).max()
    data["dc_exit_lower"] = data["low"].rolling(exit_period).min()

    # ── ATR ──
    high_low = data["high"] - data["low"]
    high_close_prev = (data["high"] - data["close"].shift(1)).abs()
    low_close_prev = (data["low"] - data["close"].shift(1)).abs()
    true_range = pd.concat([high_low, high_close_prev, low_close_prev], axis=1).max(axis=1)
    data["atr"] = true_range.rolling(atr_period).mean()

    # ── ADX ──
    data["adx"] = _calc_adx(data, adx_period)

    # ── RSI ──
    data["rsi"] = _calc_rsi(data["close"], rsi_period)

    # ── Bollinger Bands ──
    data["bb_upper"], data["bb_mid"], data["bb_lower"] = _calc_bollinger(
        data["close"], bb_period, bb_std
    )

    # ── Shifted values for breakout detection ──
    data["prev_dc_upper"] = data["dc_upper"].shift(1)
    data["prev_dc_lower"] = data["dc_lower"].shift(1)
    data["prev_dc_exit_upper"] = data["dc_exit_upper"].shift(1)
    data["prev_dc_exit_lower"] = data["dc_exit_lower"].shift(1)

    return data


# ──────────────────────────────────────────────
# Signal generators
# ──────────────────────────────────────────────

def _turtle_signal(row) -> str | None:
    """Generate turtle (trend) signal from Donchian channel."""
    close = float(row["close"])
    prev_upper = row.get("prev_dc_upper")
    prev_lower = row.get("prev_dc_lower")
    prev_exit_upper = row.get("prev_dc_exit_upper")
    prev_exit_lower = row.get("prev_dc_exit_lower")

    if pd.isna(prev_upper) or pd.isna(prev_lower):
        return None

    # Entry
    if close > prev_upper:
        return "long"
    if close < prev_lower:
        return "short"

    # Exit
    if prev_exit_lower is not None and not pd.isna(prev_exit_lower):
        if close < prev_exit_lower:
            return "exit_long"
    if prev_exit_upper is not None and not pd.isna(prev_exit_upper):
        if close > prev_exit_upper:
            return "exit_short"

    return None


def _mean_reversion_signal(
    row,
    rsi_oversold: float = 35,
    rsi_overbought: float = 70,
    _mr_prev_signal: str | None = None,
) -> tuple[str | None, str | None]:
    """
    Generate mean reversion signal from RSI + Bollinger Bands.

    Entry (BOTH must confirm):
      - Long:  close <= bb_lower AND RSI < rsi_oversold
      - Short: close >= bb_upper AND RSI > rsi_overbought

    Exit: None — rely purely on stop_loss / take_profit.
    """
    close = float(row["close"])
    rsi = row.get("rsi")
    bb_lower = row.get("bb_lower")
    bb_upper = row.get("bb_upper")

    if pd.isna(rsi) or pd.isna(bb_lower) or pd.isna(bb_upper):
        return None, _mr_prev_signal

    # Entry: RSI + Bollinger Bands dual confirmation
    if close <= bb_lower and rsi < rsi_oversold:
        return "long", "long"
    if close >= bb_upper and rsi > rsi_overbought:
        return "short", "short"

    # No exit signal — SL/TP will handle exits
    return None, _mr_prev_signal


def generate_signal(
    row,
    entry_period: int = 20,
    exit_period: int = 10,
    atr_filter: float = 0.0,
    adx_threshold: float = 25.0,
    rsi_oversold: float = 35,
    rsi_overbought: float = 70,
    _prev_mode: str = "turtle",
    _mr_prev_signal: str | None = None,
    force_mode: str | None = None,
) -> tuple[str | None, str, str | None]:
    """
    Adaptive signal: auto-switch between turtle and mean reversion.
    If force_mode is set ("turtle" or "mean_reversion"), skip ADX logic.

    Returns:
        (signal, mode, mr_signal_state)
    """
    adx = row.get("adx")
    atr = row.get("atr")

    if pd.isna(adx):
        return None, _prev_mode, _mr_prev_signal

    # ATR filter (applies to both modes)
    if atr_filter > 0 and not pd.isna(atr) and atr < atr_filter:
        return None, _prev_mode, _mr_prev_signal

    # Force mode override
    if force_mode:
        mode = force_mode
    else:
        # Determine regime with hysteresis
        if adx > adx_threshold:
            mode = "turtle"
        elif adx < (adx_threshold - 5):
            mode = "mean_reversion"
        else:
            mode = _prev_mode

    if mode == "turtle":
        sig = _turtle_signal(row)
        # ADX filter: block entry signals when ADX is below threshold
        # (still allow exit signals)
        if sig in ("long", "short") and adx < adx_threshold:
            return None, mode, _mr_prev_signal
        return sig, mode, _mr_prev_signal
    else:
        sig, new_mr_state = _mean_reversion_signal(row, rsi_oversold, rsi_overbought, _mr_prev_signal)
        return sig, mode, new_mr_state


# ──────────────────────────────────────────────
# Main pipeline
# ──────────────────────────────────────────────

def prepare_signals(df: pd.DataFrame, config: dict) -> pd.DataFrame:
    """
    Full pipeline: compute indicators, generate adaptive signals.
    Returns DataFrame with 'signal' and 'regime' columns.
    """
    entry_period = int(config.get("turtle_entry_period", 20))
    exit_period = int(config.get("turtle_exit_period", 10))
    atr_period = int(config.get("turtle_atr_period", 14))
    atr_filter = float(config.get("turtle_atr_filter", 0.0))
    adx_period = int(config.get("turtle_adx_period", 14))
    adx_threshold = float(config.get("turtle_adx_threshold", 25.0))
    force_mode = config.get("turtle_force_mode", None)  # "turtle" or "mean_reversion" or None
    rsi_period = int(config.get("turtle_rsi_period", 14))
    rsi_oversold = float(config.get("turtle_rsi_oversold", 35))
    rsi_overbought = float(config.get("turtle_rsi_overbought", 70))
    bb_period = int(config.get("turtle_bb_period", 20))
    bb_std = float(config.get("turtle_bb_std", 2.0))

    data = compute_indicators(
        df,
        entry_period=entry_period,
        exit_period=exit_period,
        atr_period=atr_period,
        adx_period=adx_period,
        rsi_period=rsi_period,
        bb_period=bb_period,
        bb_std=bb_std,
    )

    # Generate signals row by row
    signals = []
    regimes = []
    prev_mode = "turtle"
    mr_prev_signal = None
    for _, row in data.iterrows():
        sig, mode, mr_prev_signal = generate_signal(
            row,
            entry_period=entry_period,
            exit_period=exit_period,
            atr_filter=atr_filter,
            adx_threshold=adx_threshold,
            rsi_oversold=rsi_oversold,
            rsi_overbought=rsi_overbought,
            _prev_mode=prev_mode,
            _mr_prev_signal=mr_prev_signal,
            force_mode=force_mode,
        )
        signals.append(sig)
        regimes.append(mode)
        prev_mode = mode

    data["signal"] = signals
    data["regime"] = regimes

    return data
