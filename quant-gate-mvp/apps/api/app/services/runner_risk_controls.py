from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

from app.core.settings import SETTINGS
from app.core.state import PAPER_BROKER
from app.services.runner_log_store import load_logs


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
        result = item.get("result", {})
        nested = result.get("result", {}) if isinstance(result, dict) else {}
        pnl = nested.get("pnl")
        if pnl is None:
            continue
        if float(pnl) < 0:
            consecutive_loss_count += 1
        else:
            break

    daily_realized_pnl = 0.0
    for item in recent:
        result = item.get("result", {})
        nested = result.get("result", {}) if isinstance(result, dict) else {}
        pnl = nested.get("pnl")
        if pnl is not None:
            daily_realized_pnl += float(pnl)

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

    return {
        "allowed": halt_reason is None,
        "halt_reason": halt_reason,
        "consecutive_loss_count": consecutive_loss_count,
        "daily_realized_pnl": round(daily_realized_pnl, 6),
        "daily_loss_ratio": round(daily_loss_ratio, 6),
        "total_notional": round(total_notional, 6),
        "exposure_ratio": round(exposure_ratio, 6),
    }
