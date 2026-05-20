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

def _find_fvg(df: pd.DataFrame) -> list[dict[str, Any]]:
    """识别1小时FVG（公允价值缺口）。"""
    fvg_list = []
    for i in range(1, len(df) - 1):
        prev = df.iloc[i - 1]
        curr = df.iloc[i]
        nxt = df.iloc[i + 1]
        if nxt["low"] > prev["high"]:
            fvg_list.append({
                "type": "bullish",
                "top": float(nxt["low"]),
                "bottom": float(prev["high"]),
                "index": i,
                "time": df.iloc[i].get("timestamp", df.index[i]),
            })
        elif nxt["high"] < prev["low"]:
            fvg_list.append({
                "type": "bearish",
                "top": float(prev["low"]),
                "bottom": float(nxt["high"]),
                "index": i,
                "time": df.iloc[i].get("timestamp", df.index[i]),
            })
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
    lookback_eng_bars: int = 200,
    min_fvg_width_pct: float = 0.0,
    require_trend: bool = False,
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
    if require_trend and current_trend == "neutral":
        return None, None

    # 2. 识别FVG和吞没
    fvg_list = _find_fvg(df_1h)
    eng_list = _find_engulfing(df_15m)

    if not fvg_list or not eng_list:
        return None, None

    # 3. 找最近 N 根 K 线内的吞没（避免老信号反复触发）
    latest_eng = None
    n = len(df_15m)
    for eng in reversed(eng_list):
        eng_idx = eng.get("index", -1)
        if eng_idx >= 0 and (n - 1 - eng_idx) <= lookback_eng_bars:
            latest_eng = eng
            break

    if latest_eng is None:
        return None, None

    eng_time = str(pd.to_datetime(latest_eng["time"]))
    eng_close = latest_eng["close"]
    eng_type = latest_eng["type"]
    current_price = float(df_15m.iloc[-1]["close"])

    # 趋势过滤：可选只顺势交易
    if require_trend and eng_type != current_trend:
        return None, None

    # 4. 匹配FVG：找吞没之后形成的、方向一致的FVG
    signal_dir = eng_type  # 用吞没方向决定信号方向
    matched_fvg = None
    for fvg in fvg_list:
        fvg_time = str(pd.to_datetime(fvg["time"]))
        if eng_time <= fvg_time:
            continue
        if fvg["type"] != signal_dir:
            continue
        if not (fvg["bottom"] <= eng_close <= fvg["top"]):
            continue
        # FVG 质量过滤：最小宽度
        fvg_width = abs(fvg["top"] - fvg["bottom"])
        if fvg_width < current_price * min_fvg_width_pct:
            continue
        # FVG 未被填充：当前价格仍在 FVG 同侧
        if signal_dir == "bullish" and current_price < fvg["bottom"]:
            continue  # 价格已跌穿 FVG，缺口已回填
        if signal_dir == "bearish" and current_price > fvg["top"]:
            continue  # 价格已涨穿 FVG，缺口已回填
        matched_fvg = fvg
        break

    if matched_fvg is None:
        return None, None

    # 5. 计算入场、止损、止盈
    entry = eng_close
    if eng_type == "bullish":
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
        "ict_signal": eng_type,
        "entry_price": round(entry, 4),
    }

    return eng_type, extra_meta
