from __future__ import annotations

import os
from datetime import datetime, timedelta
from typing import Any

from app.core.log_config import get_logger
from app.core.settings import SETTINGS
from app.core.state import PAPER_BROKER, LIVE_BROKER
from app.services.runner_log_store import load_logs

logger = get_logger(__name__)


def _extract_pnl(entry: dict[str, Any]) -> float | None:
    """Extract pnl from a log entry, trying multiple known formats."""
    result = entry.get("result")
    if not isinstance(result, dict):
        return None

    # Format 1: action=close → result.result.pnl (broker close result)
    nested = result.get("result")
    if isinstance(nested, dict):
        pnl = nested.get("pnl")
        if pnl is not None:
            try:
                return float(pnl)
            except (TypeError, ValueError):
                pass

    # Format 2: pnl directly on the result dict
    pnl = result.get("pnl")
    if pnl is not None:
        try:
            return float(pnl)
        except (TypeError, ValueError):
            pass

    return None


def _is_trade_entry(entry: dict[str, Any]) -> bool:
    """Check if a log entry represents an actual trade (open/close), not a skip/idle/halt."""
    result = entry.get("result")
    if not isinstance(result, dict):
        return False
    action = result.get("action")
    return action in ("close", "open", "open_long", "open_short")


def _position_value(position: Any, key: str, default: float = 0.0) -> float:
    if isinstance(position, dict):
        value = position.get(key, default)
    else:
        value = getattr(position, key, default)
    try:
        return float(value or default)
    except (TypeError, ValueError):
        return default


def _position_symbol(position: Any) -> str:
    if isinstance(position, dict):
        return str(position.get("symbol") or "")
    return str(getattr(position, "symbol", "") or "")


def _position_notional(position: Any) -> float:
    qty = _position_value(position, "qty", _position_value(position, "size", 0.0))
    price = _position_value(position, "mark_price", _position_value(position, "entry_price", 0.0))
    multiplier = _position_value(position, "quanto_multiplier", 1.0)
    return abs(qty * price * multiplier)


def _broker_equity(broker: Any) -> float:
    initial = broker.get("initial_balance", 1000) if isinstance(broker, dict) else getattr(broker, "initial_balance", 1000)
    equity = broker.get("equity", initial) if isinstance(broker, dict) else getattr(broker, "equity", initial)
    try:
        equity = float(equity)
    except (TypeError, ValueError):
        equity = 0.0
    if equity <= 0:
        try:
            equity = float(initial)
        except (TypeError, ValueError):
            equity = 1000.0
    return max(equity, 1.0)


def apply_entry_risk_limits(
    *,
    broker: Any,
    symbol: str,
    leverage: int,
    requested_margin: float,
    entry_price: float,
) -> dict[str, Any]:
    """?????????????????????????"""
    _ = entry_price  # ???????????????????????????
    equity = _broker_equity(broker)
    positions = broker.get("positions", []) if isinstance(broker, dict) else getattr(broker, "positions", [])

    max_single_margin_ratio = float(os.environ.get("MAX_SINGLE_MARGIN_RATIO", SETTINGS.max_single_margin_ratio))
    max_total_exposure_ratio = float(os.environ.get("MAX_TOTAL_EXPOSURE_RATIO", SETTINGS.max_total_exposure_ratio))
    max_open_positions = int(os.environ.get("MAX_OPEN_POSITIONS", SETTINGS.max_open_positions))

    open_symbols = {_position_symbol(pos) for pos in positions if _position_notional(pos) > 0}
    if symbol not in open_symbols and len(open_symbols) >= max_open_positions:
        return {
            "allowed": False,
            "reason": "max_open_positions_reached",
            "adjusted_margin": 0.0,
            "max_open_positions": max_open_positions,
            "open_positions": len(open_symbols),
        }

    single_margin_cap = equity * max_single_margin_ratio
    capped_margin = min(float(requested_margin), single_margin_cap)

    total_notional = sum(_position_notional(pos) for pos in positions)
    total_notional_cap = equity * max_total_exposure_ratio
    remaining_notional_capacity = max(total_notional_cap - total_notional, 0.0)
    exposure_margin_cap = remaining_notional_capacity / max(int(leverage), 1)
    adjusted_margin = min(capped_margin, exposure_margin_cap)

    if adjusted_margin <= 0:
        return {
            "allowed": False,
            "reason": "max_total_exposure_reached",
            "adjusted_margin": 0.0,
            "equity": round(equity, 6),
            "total_notional": round(total_notional, 6),
            "total_notional_cap": round(total_notional_cap, 6),
            "remaining_notional_capacity": round(remaining_notional_capacity, 6),
        }

    return {
        "allowed": True,
        "reason": None,
        "adjusted_margin": round(adjusted_margin, 10),
        "requested_margin": round(float(requested_margin), 10),
        "single_margin_cap": round(single_margin_cap, 10),
        "total_notional": round(total_notional, 6),
        "total_notional_cap": round(total_notional_cap, 6),
        "remaining_notional_capacity": round(remaining_notional_capacity, 6),
        "max_open_positions": max_open_positions,
        "open_positions": len(open_symbols),
        "max_single_margin_ratio": max_single_margin_ratio,
        "max_total_exposure_ratio": max_total_exposure_ratio,
    }


def evaluate_runner_guards(trade_mode: str = "paper") -> dict[str, Any]:
    broker = LIVE_BROKER if trade_mode == "live" else PAPER_BROKER
    logs = load_logs(limit=500)

    max_consec = int(os.environ.get("MAX_CONSECUTIVE_LOSSES", SETTINGS.max_consecutive_losses))
    max_daily_loss_ratio = float(os.environ.get("MAX_DAILY_LOSS_RATIO", SETTINGS.max_daily_loss_ratio))
    max_exposure = float(os.environ.get("MAX_TOTAL_EXPOSURE_RATIO", SETTINGS.max_total_exposure_ratio))
    max_dd = float(os.environ.get("MAX_DRAWDOWN_HALT_RATIO", SETTINGS.max_drawdown_halt_ratio))
    max_per_hour = int(os.environ.get("MAX_TRADES_PER_HOUR", SETTINGS.max_trades_per_hour))
    max_per_day = int(os.environ.get("MAX_TRADES_PER_DAY", SETTINGS.max_trades_per_day))
    max_open_positions = int(os.environ.get("MAX_OPEN_POSITIONS", SETTINGS.max_open_positions))

    # 连续亏损
    consec = 0
    trade_entries = [e for e in logs if _is_trade_entry(e)]
    for e in trade_entries:
        pnl = _extract_pnl(e)
        if pnl is None:
            break
        if pnl < 0:
            consec += 1
        else:
            break

    # 日内已实现盈亏
    today = datetime.utcnow().date()
    daily_pnl = 0.0
    for e in trade_entries:
        ts = e.get("ts") or e.get("timestamp")
        if ts:
            try:
                d = datetime.fromisoformat(str(ts)).date()
                if d != today:
                    continue
            except (ValueError, TypeError):
                continue
        pnl = _extract_pnl(e)
        if pnl is not None:
            daily_pnl += pnl

    # 实盘优先补充/校验本地结构化成交记录；这些记录来自 Gate 平仓回报，
    # 比 Runner 日志更接近真实账户结果。
    if trade_mode == "live":
        try:
            from app.services.db import get_conn, init_db
            init_db()
            with get_conn() as conn:
                rows = conn.execute(
                    """
                    SELECT realized_pnl FROM paper_positions
                    WHERE trade_mode = 'live'
                      AND status = 'closed'
                      AND realized_pnl IS NOT NULL
                      AND DATE(closed_at) = DATE('now')
                    """
                ).fetchall()
            live_daily_pnl = sum(float(row["realized_pnl"] or 0) for row in rows)
            if rows:
                daily_pnl = live_daily_pnl
        except Exception as exc:
            logger.warning("live daily pnl sync from structured history failed: %s", exc)

    initial = broker.get("initial_balance", 1000) if isinstance(broker, dict) else getattr(broker, "initial_balance", 1000)
    equity = broker.get("equity", initial) if isinstance(broker, dict) else getattr(broker, "equity", initial)
    if initial <= 0:
        initial = 1000

    daily_loss_ratio = abs(daily_pnl) / initial if daily_pnl < 0 else 0.0

    # ???
    positions = broker.get("positions", []) if isinstance(broker, dict) else getattr(broker, "positions", [])
    total_notional = sum(_position_notional(pos) for pos in positions)
    exposure_ratio = total_notional / initial if initial > 0 else 0.0
    open_position_count = len({_position_symbol(pos) for pos in positions if _position_notional(pos) > 0})

    # 回撤
    peak = broker.get("peak_equity", initial) if isinstance(broker, dict) else getattr(broker, "peak_equity", initial)
    if peak <= 0:
        peak = initial
    drawdown_pct = (peak - equity) / peak if peak > 0 else 0.0

    # 交易频率
    now = datetime.utcnow()
    hour_ago = now - timedelta(hours=1)
    day_start = datetime.combine(today, datetime.min.time())
    trades_hour = 0
    trades_day = 0
    for e in logs:
        if not _is_trade_entry(e):
            continue
        ts = e.get("ts") or e.get("timestamp")
        if ts:
            try:
                t = datetime.fromisoformat(str(ts))
                if t >= hour_ago:
                    trades_hour += 1
                if t >= day_start:
                    trades_day += 1
            except (ValueError, TypeError):
                pass

    # 判断是否放行
    halt_reason = None
    if consec >= max_consec:
        halt_reason = f"连亏{consec}笔 (上限{max_consec})"
    elif daily_loss_ratio >= max_daily_loss_ratio:
        halt_reason = f"日内亏损{daily_loss_ratio:.1%} (上限{max_daily_loss_ratio:.1%})"
    elif exposure_ratio >= max_exposure:
        halt_reason = f"敞口{exposure_ratio:.1%} (上限{max_exposure:.1%})"
    elif drawdown_pct >= max_dd:
        halt_reason = f"回撤{drawdown_pct:.1%} (上限{max_dd:.1%})"
    elif trades_hour >= max_per_hour:
        halt_reason = f"1小时{max_per_hour}笔已达上限"
    elif trades_day >= max_per_day:
        halt_reason = f"日内{max_per_day}笔已达上限"

    allowed = halt_reason is None

    return {
        "allowed": allowed,
        "halt_reason": halt_reason,
        "consecutive_loss_count": consec,
        "daily_realized_pnl": round(daily_pnl, 4),
        "daily_loss_ratio": round(daily_loss_ratio, 6),
        "total_notional": round(total_notional, 2),
        "exposure_ratio": round(exposure_ratio, 6),
        "open_position_count": open_position_count,
        "max_open_positions": max_open_positions,
        "current_drawdown_pct": round(drawdown_pct, 6),
        "trades_per_hour": trades_hour,
        "trades_per_day": trades_day,
        "max_trades_per_hour": max_per_hour,
        "max_trades_per_day": max_per_day,
    }
