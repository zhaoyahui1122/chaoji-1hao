"""Notification service — webhook alerts for live trading events."""
from __future__ import annotations

import os
import threading
from datetime import datetime, timezone
from typing import Any

from app.core.log_config import get_logger

logger = get_logger(__name__)

_WEBHOOK_URL = os.environ.get("NOTIFY_WEBHOOK_URL", "")
_ENABLED = os.environ.get("NOTIFY_ENABLED", "false").lower() in ("1", "true", "yes")


def is_enabled() -> bool:
    return _ENABLED and bool(_WEBHOOK_URL)


def _send(payload: dict[str, Any]) -> None:
    """Fire-and-forget webhook POST in a background thread."""
    if not is_enabled():
        return

    def _worker():
        try:
            import urllib.request

            import json as _json
            data = _json.dumps(payload).encode()
            req = urllib.request.Request(
                _WEBHOOK_URL,
                data=data,
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=10) as resp:
                resp.read()
            logger.info("[NOTIFY] Sent: %s", payload.get("event"))
        except Exception as exc:
            logger.warning("[NOTIFY] Failed: %s", exc)

    threading.Thread(target=_worker, daemon=True).start()


def notify_open(symbol: str, side: str, price: float, qty: float, leverage: int) -> None:
    _send({
        "event": "live_open",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "symbol": symbol,
        "side": side,
        "price": price,
        "qty": qty,
        "leverage": leverage,
    })


def notify_close(symbol: str, side: str, price: float, qty: float, pnl: float, reason: str) -> None:
    _send({
        "event": "live_close",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "symbol": symbol,
        "side": side,
        "price": price,
        "qty": qty,
        "pnl": pnl,
        "reason": reason,
    })


def notify_guard_halt(reason: str, consecutive_losses: int) -> None:
    _send({
        "event": "guard_halt",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "reason": reason,
        "consecutive_losses": consecutive_losses,
    })


def notify_error(context: str, error: str) -> None:
    _send({
        "event": "runner_error",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "context": context,
        "error": error,
    })
