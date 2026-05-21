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


def evaluate_runner_guards(trade_mode: str = "paper") -> dict[str, Any]:
    logs = load_logs()
    now = datetime.utcnow()
    window_24h = now - timedelta(hours=24)
    window_1h = now - timedelta(hours=1)
    recent_24h = []
    recent_1h = []
    for item in logs:
        try:
            ts = datetime.fromisoformat(str(item.get("ts")))
        except Exception:
            continue
        if ts >= window_24h:
            recent_24h.append(item)
        if ts >= window_1h:
            recent_1h.append(item)

    consecutive_loss_count = 0
    for item in reversed(recent_24h):
        if not _is_trade_entry(item):
            continue
        pnl = _extract_pnl(item)
        if pnl is None:
            continue
        if pnl < 0:
            consecutive_loss_count += 1
        else:
            break

    daily_realized_pnl = 0.0
    for item in recent_24h:
        if not _is_trade_entry(item):
            continue
        pnl = _extract_pnl(item)
        if pnl is not None:
            daily_realized_pnl += pnl

    # 交易频率统计
    trades_per_hour = sum(1 for item in recent_1h if _is_trade_entry(item))
    trades_per_day = sum(1 for item in recent_24h if _is_trade_entry(item))
    max_trades_hour = int(os.environ.get("MAX_TRADES_PER_HOUR", SETTINGS.max_trades_per_hour))
    max_trades_day = int(os.environ.get("MAX_TRADES_PER_DAY", SETTINGS.max_trades_per_day))

    # Use the appropriate broker based on trade mode
    broker = LIVE_BROKER if trade_mode == "live" else PAPER_BROKER
    try:
        broker_initial_balance = broker.initial_balance if hasattr(broker, 'initial_balance') else SETTINGS.initial_balance
        broker_equity = broker.equity
        open_positions = broker.snapshot().get("positions", [])
    except Exception as exc:
        logger.error("Risk guard: failed to get broker data (mode=%s): %s", trade_mode, exc)
        return {
            "allowed": False,
            "halt_reason": "broker_data_unavailable",
            "consecutive_loss_count": consecutive_loss_count,
            "daily_realized_pnl": round(daily_realized_pnl, 6),
            "daily_loss_ratio": 0.0,
            "total_notional": 0.0,
            "exposure_ratio": 0.0,
            "trades_per_hour": trades_per_hour,
            "trades_per_day": trades_per_day,
            "max_trades_per_hour": max_trades_hour,
            "max_trades_per_day": max_trades_day,
        }

    daily_loss_ratio = abs(min(daily_realized_pnl, 0.0)) / max(broker_initial_balance, 1)
    total_notional = sum(float(p.get("notional", 0)) for p in open_positions)
    exposure_ratio = total_notional / max(broker_equity, 1)

    # 回撤检查
    current_drawdown_pct = 0.0
    try:
        from app.services.contract_metrics import update_equity_peak
        dd = update_equity_peak(broker_equity)
        current_drawdown_pct = dd["current_drawdown_pct"]
    except Exception:
        pass

    halt_reason = None
    if consecutive_loss_count >= SETTINGS.max_consecutive_losses:
        halt_reason = "max_consecutive_losses"
    elif daily_loss_ratio >= SETTINGS.max_daily_loss_ratio:
        halt_reason = "max_daily_loss_ratio"
    elif exposure_ratio >= SETTINGS.max_total_exposure_ratio:
        halt_reason = "max_total_exposure_ratio"
    elif current_drawdown_pct >= SETTINGS.max_drawdown_halt_ratio:
        halt_reason = "max_drawdown_ratio"
    elif trades_per_hour >= max_trades_hour:
        halt_reason = "max_trade_frequency_hourly"
    elif trades_per_day >= max_trades_day:
        halt_reason = "max_trade_frequency_daily"

    if halt_reason:
        logger.warning(
            "Risk guard HALT: %s (mode=%s, consecutive_losses=%d, daily_loss_ratio=%.4f, exposure_ratio=%.4f, drawdown=%.4f, trades_h=%d, trades_d=%d)",
            halt_reason, trade_mode, consecutive_loss_count, daily_loss_ratio, exposure_ratio,
            current_drawdown_pct, trades_per_hour, trades_per_day,
        )

    return {
        "allowed": halt_reason is None,
        "halt_reason": halt_reason,
        "consecutive_loss_count": consecutive_loss_count,
        "daily_realized_pnl": round(daily_realized_pnl, 6),
        "daily_loss_ratio": round(daily_loss_ratio, 6),
        "total_notional": round(total_notional, 6),
        "exposure_ratio": round(exposure_ratio, 6),
        "current_drawdown_pct": round(current_drawdown_pct, 6),
        "trades_per_hour": trades_per_hour,
        "trades_per_day": trades_per_day,
        "max_trades_per_hour": max_trades_hour,
        "max_trades_per_day": max_trades_day,
    }
