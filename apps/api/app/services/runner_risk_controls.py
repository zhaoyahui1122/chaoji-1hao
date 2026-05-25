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
    # 风控已取消 — 始终放行
    return {
        "allowed": True,
        "halt_reason": None,
        "consecutive_loss_count": 0,
        "daily_realized_pnl": 0.0,
        "daily_loss_ratio": 0.0,
        "total_notional": 0.0,
        "exposure_ratio": 0.0,
        "current_drawdown_pct": 0.0,
        "trades_per_hour": 0,
        "trades_per_day": 0,
        "max_trades_per_hour": int(os.environ.get("MAX_TRADES_PER_HOUR", SETTINGS.max_trades_per_hour)),
        "max_trades_per_day": int(os.environ.get("MAX_TRADES_PER_DAY", SETTINGS.max_trades_per_day)),
    }
