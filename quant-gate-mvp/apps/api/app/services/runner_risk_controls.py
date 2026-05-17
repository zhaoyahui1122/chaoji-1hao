from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

from app.core.log_config import get_logger
from app.core.settings import SETTINGS
from app.core.state import PAPER_BROKER
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


def evaluate_runner_guards() -> dict[str, Any]:
    logs = load_logs()
    window_start = datetime.utcnow() - timedelta(hours=24)
    recent = []
    for item in logs:
        try:
            ts = datetime.fromisoformat(str(item.get("ts")))
        except Exception:
            continue
        if ts >= window_start:
            recent.append(item)

    consecutive_loss_count = 0
    for item in reversed(recent):
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
    for item in recent:
        if not _is_trade_entry(item):
            continue
        pnl = _extract_pnl(item)
        if pnl is not None:
            daily_realized_pnl += pnl

    daily_loss_ratio = abs(min(daily_realized_pnl, 0.0)) / max(PAPER_BROKER.initial_balance, 1)
    open_positions = PAPER_BROKER.snapshot().get("positions", [])
    total_notional = sum(float(p.get("notional", 0)) for p in open_positions)
    exposure_ratio = total_notional / max(PAPER_BROKER.equity, 1)

    halt_reason = None
    if consecutive_loss_count >= SETTINGS.max_consecutive_losses:
        halt_reason = "max_consecutive_losses"
    elif daily_loss_ratio >= SETTINGS.max_daily_loss_ratio:
        halt_reason = "max_daily_loss_ratio"
    elif exposure_ratio >= SETTINGS.max_total_exposure_ratio:
        halt_reason = "max_total_exposure_ratio"

    if halt_reason:
        logger.warning(
            "Risk guard HALT: %s (consecutive_losses=%d, daily_loss_ratio=%.4f, exposure_ratio=%.4f)",
            halt_reason, consecutive_loss_count, daily_loss_ratio, exposure_ratio,
        )

    return {
        "allowed": halt_reason is None,
        "halt_reason": halt_reason,
        "consecutive_loss_count": consecutive_loss_count,
        "daily_realized_pnl": round(daily_realized_pnl, 6),
        "daily_loss_ratio": round(daily_loss_ratio, 6),
        "total_notional": round(total_notional, 6),
        "exposure_ratio": round(exposure_ratio, 6),
    }
