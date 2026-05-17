from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timezone
from threading import Lock
from typing import Any

_LOCK = Lock()
_DEFAULT_STATE = {
    "api_key": None,
    "api_secret": None,
    "has_credentials": False,
    "connected": False,
    "last_sync_at": None,
    "last_error": None,
    "account": None,
    "positions": [],
    "source": "gate_futures_live",
}
_STATE: dict[str, Any] = deepcopy(_DEFAULT_STATE)


def get_live_account_session() -> dict[str, Any]:
    with _LOCK:
        return deepcopy(_STATE)


def set_live_account_credentials(api_key: str, api_secret: str) -> dict[str, Any]:
    with _LOCK:
        _STATE["api_key"] = api_key
        _STATE["api_secret"] = api_secret
        _STATE["has_credentials"] = bool(api_key and api_secret)
        _STATE["last_error"] = None
        return deepcopy(_STATE)


def set_live_account_snapshot(account: dict[str, Any] | None, positions: list[dict[str, Any]], last_sync_at: str | None = None) -> dict[str, Any]:
    with _LOCK:
        _STATE["connected"] = True
        _STATE["account"] = deepcopy(account)
        _STATE["positions"] = deepcopy(positions)
        _STATE["last_sync_at"] = last_sync_at or datetime.now(timezone.utc).isoformat()
        _STATE["last_error"] = None
        return deepcopy(_STATE)


def set_live_account_error(message: str) -> dict[str, Any]:
    with _LOCK:
        _STATE["connected"] = False
        _STATE["last_error"] = message
        return deepcopy(_STATE)


def clear_live_account_session() -> dict[str, Any]:
    with _LOCK:
        _STATE.clear()
        _STATE.update(deepcopy(_DEFAULT_STATE))
        return deepcopy(_STATE)
