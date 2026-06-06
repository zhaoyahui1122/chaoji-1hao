import pandas as pd


def compute_indicators(
    df: pd.DataFrame,
    boll_period: int = 20,
    boll_std: float = 2.0,
    rsi_period: int = 14,
    ma_short: int = 9,
    ma_long: int = 21,
    macd_fast: int = 12,
    macd_slow: int = 26,
    macd_signal: int = 9,
    kdj_period: int = 9,
    kdj_signal_period: int = 3,
):
    data = df.copy()
    data["ma_short"] = data["close"].ewm(span=ma_short, adjust=False).mean()
    data["ma_long"] = data["close"].ewm(span=ma_long, adjust=False).mean()
    data["prev_ma_short"] = data["ma_short"].shift(1)
    data["prev_ma_long"] = data["ma_long"].shift(1)
    data["mb"] = data["close"].rolling(boll_period).mean()
    rolling_std = data["close"].rolling(boll_period).std()
    data["ub"] = data["mb"] + boll_std * rolling_std
    data["lb"] = data["mb"] - boll_std * rolling_std

    delta = data["close"].diff()
    gain = delta.clip(lower=0).rolling(rsi_period).mean()
    loss = (-delta.clip(upper=0)).rolling(rsi_period).mean()
    rs = gain / loss.replace(0, pd.NA)
    data["rsi"] = 100 - (100 / (1 + rs))

    ema_fast = data["close"].ewm(span=macd_fast, adjust=False).mean()
    ema_slow = data["close"].ewm(span=macd_slow, adjust=False).mean()
    data["macd_line"] = ema_fast - ema_slow
    data["macd_signal"] = data["macd_line"].ewm(span=macd_signal, adjust=False).mean()
    data["macd_hist"] = data["macd_line"] - data["macd_signal"]
    data["prev_macd_line"] = data["macd_line"].shift(1)
    data["prev_macd_signal"] = data["macd_signal"].shift(1)
    data["prev_macd_hist"] = data["macd_hist"].shift(1)

    lowest_low = data["low"].rolling(kdj_period).min()
    highest_high = data["high"].rolling(kdj_period).max()
    rsv = ((data["close"] - lowest_low) / (highest_high - lowest_low).replace(0, pd.NA)) * 100
    data["kdj_k"] = rsv.ewm(alpha=1 / kdj_signal_period, adjust=False).mean()
    data["kdj_d"] = data["kdj_k"].ewm(alpha=1 / kdj_signal_period, adjust=False).mean()
    data["kdj_j"] = 3 * data["kdj_k"] - 2 * data["kdj_d"]
    data["prev_kdj_k"] = data["kdj_k"].shift(1)
    data["prev_kdj_d"] = data["kdj_d"].shift(1)
    return data


def generate_signal(
    row,
    rsi_oversold: float = 30,
    rsi_overbought: float = 70,
    use_boll: bool = True,
    use_rsi: bool = True,
    use_ma: bool = True,
    use_macd: bool = False,
    use_kdj: bool = False,
    kdj_overbought: float = 80,
    kdj_oversold: float = 20,
    min_signal_score: int = 3,
) -> str | None:
    if use_boll and (pd.isna(row.get("lb")) or pd.isna(row.get("ub"))):
        return None
    if use_rsi and pd.isna(row.get("rsi")):
        return None
    if use_ma and (pd.isna(row.get("ma_short")) or pd.isna(row.get("ma_long"))):
        return None
    if use_macd and (pd.isna(row.get("macd_line")) or pd.isna(row.get("macd_signal")) or pd.isna(row.get("macd_hist"))):
        return None
    if use_kdj and (pd.isna(row.get("kdj_k")) or pd.isna(row.get("kdj_d")) or pd.isna(row.get("kdj_j"))):
        return None

    oversold = float(rsi_oversold)
    overbought = float(rsi_overbought)
    required_score = max(int(min_signal_score or 1), 1)

    long_score = 0
    short_score = 0
    enabled_count = 0

    if use_boll:
        enabled_count += 1
        if row["close"] <= row["lb"]:
            long_score += 2
        elif row["close"] <= row["mb"]:
            long_score += 1
        if row["close"] >= row["ub"]:
            short_score += 2
        elif row["close"] >= row["mb"]:
            short_score += 1

    if use_rsi:
        enabled_count += 1
        if row["rsi"] <= oversold:
            long_score += 2
        elif row["rsi"] <= oversold + 5:
            long_score += 1
        if row["rsi"] >= overbought:
            short_score += 2
        elif row["rsi"] >= overbought - 5:
            short_score += 1

    if use_ma:
        enabled_count += 1
        ma_bull_cross = (
            row.get("prev_ma_short") is not None
            and row.get("prev_ma_long") is not None
            and row.get("prev_ma_short") <= row.get("prev_ma_long")
            and row["ma_short"] > row["ma_long"]
        )
        ma_bear_cross = (
            row.get("prev_ma_short") is not None
            and row.get("prev_ma_long") is not None
            and row.get("prev_ma_short") >= row.get("prev_ma_long")
            and row["ma_short"] < row["ma_long"]
        )
        if ma_bull_cross:
            long_score += 2
        elif row["ma_short"] > row["ma_long"]:
            long_score += 1
        if ma_bear_cross:
            short_score += 2
        elif row["ma_short"] < row["ma_long"]:
            short_score += 1

    if use_macd:
        enabled_count += 1
        macd_bull_cross = (
            row.get("prev_macd_line") is not None
            and row.get("prev_macd_signal") is not None
            and row.get("prev_macd_line") <= row.get("prev_macd_signal")
            and row["macd_line"] > row["macd_signal"]
        )
        macd_bear_cross = (
            row.get("prev_macd_line") is not None
            and row.get("prev_macd_signal") is not None
            and row.get("prev_macd_line") >= row.get("prev_macd_signal")
            and row["macd_line"] < row["macd_signal"]
        )
        if macd_bull_cross or (row["macd_hist"] > 0 and row["macd_line"] >= row["macd_signal"]):
            long_score += 1 if not macd_bull_cross else 2
        if macd_bear_cross or (row["macd_hist"] < 0 and row["macd_line"] <= row["macd_signal"]):
            short_score += 1 if not macd_bear_cross else 2

    if use_kdj:
        enabled_count += 1
        kdj_bull_cross = (
            row.get("prev_kdj_k") is not None
            and row.get("prev_kdj_d") is not None
            and row.get("prev_kdj_k") <= row.get("prev_kdj_d")
            and row["kdj_k"] > row["kdj_d"]
        )
        kdj_bear_cross = (
            row.get("prev_kdj_k") is not None
            and row.get("prev_kdj_d") is not None
            and row.get("prev_kdj_k") >= row.get("prev_kdj_d")
            and row["kdj_k"] < row["kdj_d"]
        )
        if row["kdj_j"] <= float(kdj_oversold):
            long_score += 1
        if row["kdj_j"] >= float(kdj_overbought):
            short_score += 1
        if kdj_bull_cross:
            long_score += 1
        if kdj_bear_cross:
            short_score += 1

    if enabled_count == 0:
        return None

    # 指标不足时直接返回 None，不自动降级阈值
    if enabled_count * 2 < required_score:
        return None

    threshold = required_score
    if long_score >= threshold and long_score > short_score:
        return "long"
    if short_score >= threshold and short_score > long_score:
        return "short"
    return None


def apply_entry_filters(
    signal: str | None,
    row,
    *,
    trend_filter_enabled: bool = False,
) -> str | None:
    """经典策略入场过滤：用于让回测和 Runner 共享同一套额外风控。"""
    if signal not in ("long", "short"):
        return signal
    if not trend_filter_enabled:
        return signal

    ma_short = row.get("ma_short")
    ma_long = row.get("ma_long")
    if pd.isna(ma_short) or pd.isna(ma_long):
        return None
    if signal == "long" and ma_short < ma_long:
        return None
    if signal == "short" and ma_short > ma_long:
        return None
    return signal
