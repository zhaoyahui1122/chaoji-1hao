from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.services.db import get_conn, load_kv, save_kv, init_db

_STATE_DIR = Path(os.environ.get("STATE_DIR", str(Path(__file__).resolve().parents[4] / "state")))
_STATE_DIR.mkdir(parents=True, exist_ok=True)
STRATEGY_STATE_PATH = _STATE_DIR / "strategy_config.json"
STRATEGY_SLOTS_PATH = _STATE_DIR / "strategy_slots.json"

# 优化后的15分钟海龟策略预设参数（2026-05-02 15m ADX过滤优化结果）
OPTIMIZED_TURTLE_PRESET = {
    "symbol": "BTC_USDT",
    "timeframe": "15m",
    "strategy_type": "turtle",
    "leverage": 50,
    "use_boll": False,
    "boll_period": 20,
    "boll_std": 2.0,
    "use_rsi": False,
    "rsi_period": 14,
    "rsi_oversold": 30,
    "rsi_overbought": 70,
    "use_ma": False,
    "ma_short": 9,
    "ma_long": 21,
    "use_macd": False,
    "macd_fast": 12,
    "macd_slow": 26,
    "macd_signal": 9,
    "use_kdj": False,
    "kdj_period": 9,
    "kdj_signal_period": 3,
    "kdj_overbought": 80,
    "kdj_oversold": 20,
    "turtle_entry_period": 30,
    "turtle_exit_period": 5,
    "turtle_atr_period": 10,
    "turtle_atr_filter": 0.0,
    "ict_bos_lookback": 10,
    "ict_risk_reward": 2.5,
    "ict_lookback_eng_bars": 80,
    "ict_min_fvg_width_pct": 0.0,
    "ict_cooldown_bars": 4,
    "ict_require_trend": True,
    "ifvg_risk_reward": 1.5,
    "ifvg_fvg_lookback": 80,
    "ifvg_min_fvg_width_pct": 0.0002,
    "ifvg_bias_ema_period": 20,
    "ifvg_session": "new_york_am",
    "ifvg_require_bias": True,
    "ifvg_one_shot_per_session": True,
    "turtle_adx_period": 14,
    "turtle_adx_threshold": 35.0,
    "turtle_force_mode": "turtle",
    "stop_loss_pct": 0.01,
    "take_profit_pct": 0.02,
    "risk_per_trade_pct": 0.01,
    "fee_rate": 0.00015,
    "slippage_rate": 0.0001,
    "enabled": True,
}

DEFAULT_SLOTS = [
    {
        "slotId": 1,
        "name": "15分钟策略",
        "config": {
            "symbol": "BTC_USDT",
            "timeframe": "15m",
            "strategy_type": "classic",
            "leverage": 50,
            "use_boll": True,
            "boll_period": 24,
            "boll_std": 2.0,
            "use_rsi": True,
            "rsi_period": 14,
            "rsi_oversold": 35,
            "rsi_overbought": 65,
            "use_ma": True,
            "ma_short": 10,
            "ma_long": 30,
            "use_macd": False,
            "macd_fast": 12,
            "macd_slow": 26,
            "macd_signal": 5,
            "use_kdj": False,
            "kdj_period": 5,
            "kdj_signal_period": 3,
            "kdj_overbought": 80,
            "kdj_oversold": 20,
            "min_signal_score": 4,
            "churn_guard_enabled": True,
            "classic_trend_filter_enabled": True,
            "classic_cooldown_bars": 2,
            "turtle_entry_period": 20,
            "turtle_exit_period": 10,
            "turtle_atr_period": 14,
            "turtle_atr_filter": 0.0,
            "ict_bos_lookback": 10,
            "ict_risk_reward": 2.5,
            "ict_lookback_eng_bars": 80,
            "ict_min_fvg_width_pct": 0.0,
            "ict_cooldown_bars": 4,
            "ict_require_trend": True,
            "ifvg_risk_reward": 1.5,
            "ifvg_fvg_lookback": 80,
            "ifvg_min_fvg_width_pct": 0.0002,
            "ifvg_bias_ema_period": 20,
            "ifvg_session": "new_york_am",
            "ifvg_require_bias": True,
            "ifvg_one_shot_per_session": True,
            "stop_loss_pct": 0.01,
            "take_profit_pct": 0.015,
            "risk_per_trade_pct": 0.01,
            "fee_rate": 0.00015,
            "slippage_rate": 0.0001,
            "enabled": True,
        },
        "updatedAt": "2026-05-10T00:00:00Z",
        "locked": False,
    },
    {
        "slotId": 2,
        "name": "ICT三周期策略",
        "config": {
            "symbol": "BTC_USDT",
            "timeframe": "15m",
            "strategy_type": "ict",
            "leverage": 50,
            "use_boll": False,
            "boll_period": 20,
            "boll_std": 2.0,
            "use_rsi": False,
            "rsi_period": 14,
            "rsi_oversold": 30,
            "rsi_overbought": 70,
            "use_ma": False,
            "ma_short": 9,
            "ma_long": 21,
            "use_macd": False,
            "macd_fast": 12,
            "macd_slow": 26,
            "macd_signal": 9,
            "use_kdj": False,
            "kdj_period": 9,
            "kdj_signal_period": 3,
            "kdj_overbought": 80,
            "kdj_oversold": 20,
            "min_signal_score": 3,
            "churn_guard_enabled": False,
            "classic_trend_filter_enabled": False,
            "classic_cooldown_bars": 0,
            "turtle_entry_period": 20,
            "turtle_exit_period": 10,
            "turtle_atr_period": 14,
            "turtle_atr_filter": 0.0,
            "ict_bos_lookback": 10,
            "ict_risk_reward": 2.5,
            "ict_lookback_eng_bars": 80,
            "ict_min_fvg_width_pct": 0.0,
            "ict_cooldown_bars": 4,
            "ict_require_trend": True,
            "ifvg_risk_reward": 1.5,
            "ifvg_fvg_lookback": 80,
            "ifvg_min_fvg_width_pct": 0.0002,
            "ifvg_bias_ema_period": 20,
            "ifvg_session": "new_york_am",
            "ifvg_require_bias": True,
            "ifvg_one_shot_per_session": True,
            "stop_loss_pct": 0.02,
            "take_profit_pct": 0.04,
            "risk_per_trade_pct": 0.01,
            "fee_rate": 0.00015,
            "slippage_rate": 0.0001,
            "enabled": True,
        },
        "updatedAt": "2026-05-19T00:00:00Z",
        "locked": False,
    },
    {
        "slotId": 3,
        "name": "IFVG策略",
        "config": {
            "symbol": "BTC_USDT",
            "timeframe": "15m",
            "strategy_type": "ifvg",
            "leverage": 20,
            "use_boll": False,
            "boll_period": 20,
            "boll_std": 2.0,
            "use_rsi": False,
            "rsi_period": 14,
            "rsi_oversold": 30,
            "rsi_overbought": 70,
            "use_ma": False,
            "ma_short": 9,
            "ma_long": 21,
            "use_macd": False,
            "macd_fast": 12,
            "macd_slow": 26,
            "macd_signal": 9,
            "use_kdj": False,
            "kdj_period": 9,
            "kdj_signal_period": 3,
            "kdj_overbought": 80,
            "kdj_oversold": 20,
            "min_signal_score": 3,
            "churn_guard_enabled": False,
            "classic_trend_filter_enabled": False,
            "classic_cooldown_bars": 0,
            "turtle_entry_period": 20,
            "turtle_exit_period": 10,
            "turtle_atr_period": 14,
            "turtle_atr_filter": 0.0,
            "ict_bos_lookback": 10,
            "ict_risk_reward": 2.5,
            "ict_lookback_eng_bars": 80,
            "ict_min_fvg_width_pct": 0.0,
            "ict_cooldown_bars": 4,
            "ict_require_trend": True,
            "ifvg_risk_reward": 1.5,
            "ifvg_fvg_lookback": 80,
            "ifvg_min_fvg_width_pct": 0.0002,
            "ifvg_bias_ema_period": 20,
            "ifvg_session": "new_york_am",
            "ifvg_require_bias": True,
            "ifvg_one_shot_per_session": True,
            "stop_loss_pct": 0.01,
            "take_profit_pct": 0.015,
            "risk_per_trade_pct": 0.01,
            "fee_rate": 0.00015,
            "slippage_rate": 0.0001,
            "enabled": True,
        },
        "updatedAt": "2026-06-21T00:00:00Z",
        "locked": False,
    },
]


def _load_json_fallback(default: dict[str, Any]) -> dict[str, Any]:
    if not STRATEGY_STATE_PATH.exists():
        return default
    try:
        return json.loads(STRATEGY_STATE_PATH.read_text(encoding="utf-8"))
    except Exception:
        return default


def _with_required_default_slots(slots: list[dict[str, Any]]) -> list[dict[str, Any]]:
    existing_types = {str(slot.get("config", {}).get("strategy_type", "")) for slot in slots}
    next_slots = list(slots)
    changed = False
    for default_slot in DEFAULT_SLOTS:
        strategy_type = str(default_slot.get("config", {}).get("strategy_type", ""))
        if strategy_type and strategy_type not in existing_types:
            next_id = max((int(slot.get("slotId", 0) or 0) for slot in next_slots), default=0) + 1
            next_slot = {**default_slot, "slotId": next_id}
            next_slots.append(next_slot)
            existing_types.add(strategy_type)
            changed = True
    if changed:
        save_strategy_slots(next_slots)
    return next_slots


def load_strategy_config(default: dict[str, Any]) -> dict[str, Any]:
    data = load_kv("strategy", "config", None)
    if data is not None:
        return data

    fallback = _load_json_fallback(default)
    save_kv("strategy", "config", fallback)
    return fallback


def save_strategy_config(data: dict[str, Any]) -> dict[str, Any]:
    save_kv("strategy", "config", data)
    STRATEGY_STATE_PATH.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    return data


def load_strategy_slots() -> list[dict[str, Any]]:
    """加载策略槽列表，首次使用时初始化默认槽（含锁定的海龟优化策略）"""
    data = load_kv("strategy", "slots", None)
    if data is not None:
        return _with_required_default_slots(data)

    if STRATEGY_SLOTS_PATH.exists():
        try:
            slots = json.loads(STRATEGY_SLOTS_PATH.read_text(encoding="utf-8"))
            save_kv("strategy", "slots", slots)
            return _with_required_default_slots(slots)
        except Exception:
            pass

    save_kv("strategy", "slots", DEFAULT_SLOTS)
    STRATEGY_SLOTS_PATH.write_text(json.dumps(DEFAULT_SLOTS, ensure_ascii=False, indent=2), encoding="utf-8")
    return DEFAULT_SLOTS


def save_strategy_slots(slots: list[dict[str, Any]]) -> list[dict[str, Any]]:
    save_kv("strategy", "slots", slots)
    STRATEGY_SLOTS_PATH.write_text(json.dumps(slots, ensure_ascii=False, indent=2), encoding="utf-8")
    return slots


def delete_strategy_slot(slot_id: int) -> tuple[bool, str]:
    """删除策略槽，锁定的槽不允许删除"""
    slots = load_strategy_slots()
    target = next((s for s in slots if s["slotId"] == slot_id), None)
    if target is None:
        return False, f"策略槽 {slot_id} 不存在"
    if target.get("locked", False):
        return False, f"策略槽 {slot_id} 已锁定，不允许删除"
    new_slots = [s for s in slots if s["slotId"] != slot_id]
    save_strategy_slots(new_slots)
    return True, f"策略槽 {slot_id} 已删除"


def add_strategy_slot(name: str | None = None) -> dict[str, Any]:
    """添加新策略槽"""
    slots = load_strategy_slots()
    new_id = max((s["slotId"] for s in slots), default=0) + 1
    from datetime import datetime, timezone
    new_slot = {
        "slotId": new_id,
        "name": name or f"策略 {new_id}",
        "config": {
            "symbol": "BTC_USDT",
            "timeframe": "15m",
            "strategy_type": "classic",
            "leverage": 5,
            "use_boll": True,
            "boll_period": 20,
            "boll_std": 2.0,
            "use_rsi": True,
            "rsi_period": 14,
            "rsi_oversold": 30,
            "rsi_overbought": 70,
            "use_ma": True,
            "ma_short": 9,
            "ma_long": 21,
            "churn_guard_enabled": False,
            "classic_trend_filter_enabled": False,
            "classic_cooldown_bars": 0,
            "turtle_entry_period": 20,
            "turtle_exit_period": 10,
            "turtle_atr_period": 14,
            "turtle_atr_filter": 0.0,
            "ict_bos_lookback": 10,
            "ict_risk_reward": 2.5,
            "ict_lookback_eng_bars": 80,
            "ict_min_fvg_width_pct": 0.0,
            "ict_cooldown_bars": 4,
            "ict_require_trend": True,
            "ifvg_risk_reward": 1.5,
            "ifvg_fvg_lookback": 80,
            "ifvg_min_fvg_width_pct": 0.0002,
            "ifvg_bias_ema_period": 20,
            "ifvg_session": "new_york_am",
            "ifvg_require_bias": True,
            "ifvg_one_shot_per_session": True,
            "stop_loss_pct": 0.02,
            "take_profit_pct": 0.04,
            "risk_per_trade_pct": 0.01,
            "fee_rate": 0.00015,
            "slippage_rate": 0.0001,
            "enabled": True,
        },
        "updatedAt": datetime.now(timezone.utc).isoformat(),
        "locked": False,
    }
    slots.append(new_slot)
    save_strategy_slots(slots)
    return new_slot


def update_strategy_slot_name(slot_id: int, name: str) -> tuple[bool, str]:
    """更新策略槽名称"""
    slots = load_strategy_slots()
    target = next((s for s in slots if s["slotId"] == slot_id), None)
    if target is None:
        return False, f"策略槽 {slot_id} 不存在"
    target["name"] = name
    save_strategy_slots(slots)
    return True, f"策略槽 {slot_id} 名称已更新"


def update_strategy_slot_config(slot_id: int, config: dict[str, Any]) -> tuple[bool, str]:
    """更新策略槽配置，锁定的槽不允许修改"""
    slots = load_strategy_slots()
    target = next((s for s in slots if s["slotId"] == slot_id), None)
    if target is None:
        return False, f"策略槽 {slot_id} 不存在"
    if target.get("locked", False):
        return False, f"策略槽 {slot_id} 已锁定，不允许修改参数"
    target["config"] = config
    target["updatedAt"] = datetime.now(timezone.utc).isoformat()
    save_strategy_slots(slots)
    return True, f"策略槽 {slot_id} 配置已更新"


# ---- 策略参数版本管理 ----

def save_strategy_snapshot(config: dict[str, Any], label: str | None = None) -> int:
    """保存策略参数快照，返回 snapshot id。"""
    init_db()
    config_json = json.dumps(config, ensure_ascii=False)
    with get_conn() as conn:
        cur = conn.execute(
            "INSERT INTO strategy_snapshots(config_json, label) VALUES (?, ?)",
            (config_json, label),
        )
        conn.commit()
        return cur.lastrowid


def list_strategy_snapshots(limit: int = 20) -> list[dict[str, Any]]:
    """列出历史参数版本，最新在前。"""
    init_db()
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT id, label, created_at FROM strategy_snapshots ORDER BY id DESC LIMIT ?",
            (limit,),
        ).fetchall()
    return [dict(r) for r in rows]


def rollback_strategy(snapshot_id: int) -> tuple[bool, str, dict[str, Any] | None]:
    """回滚到指定快照版本，返回 (ok, msg, config)。"""
    init_db()
    with get_conn() as conn:
        row = conn.execute(
            "SELECT config_json FROM strategy_snapshots WHERE id = ?",
            (snapshot_id,),
        ).fetchone()
    if row is None:
        return False, f"快照 {snapshot_id} 不存在", None
    config = json.loads(row["config_json"])
    save_strategy_config(config)
    return True, f"已回滚到快照 {snapshot_id}", config
