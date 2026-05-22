"""
ICT 三周期策略：BOS趋势过滤 + FVG + 吞没形态
-------------------------------------------------
4小时级别：BOS判断大趋势方向（只顺势交易）
1小时级别：识别FVG区域
15分钟级别：吞没形态确认入场
止损：FVG外侧
止盈：止损距离 × risk_reward（默认1:2）
"""
from __future__ import annotations

from typing import Any

import pandas as pd


# ============================================================
# 1. BOS 趋势判断（4小时级别）
# ============================================================

def _get_trend_bos(df_4h: pd.DataFrame, lookback: int = 20) -> list[str]:
    """用BOS判断4小时趋势，返回每根K线的趋势方向列表。"""
    trend_list = ["neutral"] * len(df_4h)
    for i in range(lookback, len(df_4h)):
        window = df_4h.iloc[i - lookback: i]
        recent_high = window["high"].max()
        recent_low = window["low"].min()
        current_close = df_4h.iloc[i]["close"]
        if current_close > recent_high:
            trend_list[i] = "bullish"
        elif current_close < recent_low:
            trend_list[i] = "bearish"
        else:
            trend_list[i] = "neutral"
    return trend_list


# ============================================================
# 2. FVG 识别（1小时级别）
# ============================================================

def _find_fvg(df: pd.DataFrame, max_bars: int = 100) -> list[dict[str, Any]]:
    """识别1小时FVG（公允价值缺口），标记已回补和过期的FVG。"""
    raw_fvgs = []
    for i in range(1, len(df) - 1):
        prev = df.iloc[i - 1]
        curr = df.iloc[i]
        nxt = df.iloc[i + 1]
        if nxt["low"] > prev["high"]:
            raw_fvgs.append({
                "type": "bullish",
                "top": float(nxt["low"]),
                "bottom": float(prev["high"]),
                "index": i,
                "time": df.iloc[i].get("timestamp", df.index[i]),
            })
        elif nxt["high"] < prev["low"]:
            raw_fvgs.append({
                "type": "bearish",
                "top": float(prev["low"]),
                "bottom": float(nxt["high"]),
                "index": i,
                "time": df.iloc[i].get("timestamp", df.index[i]),
            })

    # 检查每个 FVG 是否已被 fill，标记 filled 字段
    n = len(df)
    for fvg in raw_fvgs:
        filled = False
        for j in range(fvg["index"] + 2, n):
            candle = df.iloc[j]
            if fvg["type"] == "bullish" and candle["low"] <= fvg["bottom"]:
                filled = True
                break
            if fvg["type"] == "bearish" and candle["high"] >= fvg["top"]:
                filled = True
                break
        fvg["filled"] = filled

    # 过滤：跳过已 fill 的和过期的
    fvg_list = [
        fvg for fvg in raw_fvgs
        if not fvg["filled"] and (n - 1 - fvg["index"]) <= max_bars
    ]
    return fvg_list


# ============================================================
# 3. 吞没形态识别（15分钟级别）
# ============================================================

def _find_engulfing(df: pd.DataFrame) -> list[dict[str, Any]]:
    """识别15分钟吞没形态。"""
    signals = []
    for i in range(1, len(df)):
        prev = df.iloc[i - 1]
        curr = df.iloc[i]
        if (prev["close"] < prev["open"]
                and curr["close"] > curr["open"]
                and curr["close"] > prev["open"]
                and curr["open"] < prev["close"]):
            signals.append({
                "type": "bullish",
                "index": i,
                "time": curr.get("timestamp", df.index[i]),
                "close": float(curr["close"]),
                "candle_high": float(curr["high"]),
                "candle_low": float(curr["low"]),
            })
        elif (prev["close"] > prev["open"]
              and curr["close"] < curr["open"]
              and curr["close"] < prev["open"]
              and curr["open"] > prev["close"]):
            signals.append({
                "type": "bearish",
                "index": i,
                "time": curr.get("timestamp", df.index[i]),
                "close": float(curr["close"]),
                "candle_high": float(curr["high"]),
                "candle_low": float(curr["low"]),
            })
    return signals


# ============================================================
# 4. 公共接口：对齐项目模式
# ============================================================

def compute_indicators(
    df_4h: pd.DataFrame,
    df_1h: pd.DataFrame,
    df_15m: pd.DataFrame,
    bos_lookback: int = 20,
) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    """
    预计算指标（接口兼容，实际计算在 generate_signal 中完成）。
    直接返回原始 DataFrame，因为 ICT 策略不需要预先给 df 加列。
    """
    return df_4h, df_1h, df_15m


def generate_signal(
    df_4h: pd.DataFrame,
    df_1h: pd.DataFrame,
    df_15m: pd.DataFrame,
    bos_lookback: int = 20,
    risk_reward: float = 2.5,
    lookback_eng_bars: int = 80,
    min_fvg_width_pct: float = 0.0,
    require_trend: bool = True,
    fvg_max_bars: int = 60,
) -> tuple[str | None, dict[str, Any] | None]:
    """
    三周期组合信号生成。

    返回：
        signal: "long" / "short" / None
        extra_meta: 包含 stop_loss_price, take_profit_price 等
    """
    # 1. 计算4h趋势
    trend_list = _get_trend_bos(df_4h, lookback=bos_lookback)
    df_4h_trend = df_4h.copy()
    df_4h_trend["trend"] = trend_list

    # 获取最新15m时间对应的4h趋势
    latest_15m_time = df_15m.index[-1]
    past_4h = df_4h_trend[df_4h_trend.index <= latest_15m_time]
    if past_4h.empty:
        return None, None
    current_trend = past_4h.iloc[-1]["trend"]

    # 2. 识别FVG和吞没
    fvg_list = _find_fvg(df_1h, max_bars=fvg_max_bars)
    eng_list = _find_engulfing(df_15m)

    if not fvg_list or not eng_list:
        return None, None

    current_price = float(df_15m.iloc[-1]["close"])

    # 3. FVG匹配：正确的ICT逻辑
    # FVG先形成 → 价格回踩到FVG区域 → 吞没确认
    matched_fvg = None
    signal_dir = None
    n = len(df_15m)
    for fvg in reversed(fvg_list):
        fvg_width = abs(fvg["top"] - fvg["bottom"])
        if fvg_width < current_price * min_fvg_width_pct:
            continue
        if fvg["type"] == "bullish" and fvg["bottom"] <= current_price <= fvg["top"]:
            matched_fvg = fvg
            signal_dir = "long"
            break
        elif fvg["type"] == "bearish" and fvg["bottom"] <= current_price <= fvg["top"]:
            matched_fvg = fvg
            signal_dir = "short"
            break

    if matched_fvg is None:
        return None, None

    # 检查最近是否有同方向吞没确认
    has_engulfing = False
    latest_eng = None
    for eng in reversed(eng_list):
        eng_idx = eng.get("index", -1)
        if eng_idx < 0 or (n - 1 - eng_idx) > lookback_eng_bars:
            continue
        if (signal_dir == "long" and eng["type"] == "bullish") or \
           (signal_dir == "short" and eng["type"] == "bearish"):
            has_engulfing = True
            latest_eng = eng
            break

    if not has_engulfing:
        return None, None

    eng_close = latest_eng["close"]

    # 趋势过滤：只过滤明确逆势，neutral允许开仓
    if require_trend and current_trend != "neutral":
        if (signal_dir == "long" and current_trend == "bearish") or \
           (signal_dir == "short" and current_trend == "bullish"):
            return None, None

    # 5. 计算入场、止损、止盈
    entry = current_price
    if signal_dir == "long":
        stop_loss = matched_fvg["bottom"]
        sl_distance = entry - stop_loss
        take_profit = entry + sl_distance * risk_reward
    else:
        stop_loss = matched_fvg["top"]
        sl_distance = stop_loss - entry
        take_profit = entry - sl_distance * risk_reward

    extra_meta = {
        "stop_loss_price": round(stop_loss, 4),
        "take_profit_price": round(take_profit, 4),
        "sl_distance": round(sl_distance, 4),
        "fvg_top": matched_fvg["top"],
        "fvg_bottom": matched_fvg["bottom"],
        "trend_4h": current_trend,
        "ict_signal": signal_dir,
        "entry_price": round(entry, 4),
    }

    return signal_dir, extra_meta
