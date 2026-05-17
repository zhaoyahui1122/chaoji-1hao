from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timezone
from threading import Lock
from typing import Any

from app.services.credential_store import save_credentials, load_credentials, clear_credentials

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


def _try_restore_credentials() -> None:
    """On first access, attempt to load persisted credentials."""
    creds = load_credentials()
    if creds:
        _STATE["api_key"], _STATE["api_secret"] = creds
        _STATE["has_credentials"] = True


def get_live_account_session() -> dict[str, Any]:
    with _LOCK:
        if not _STATE["has_credentials"]:
            _try_restore_credentials()
        return deepcopy(_STATE)


def set_live_account_credentials(api_key: str, api_secret: str) -> dict[str, Any]:
    with _LOCK:
        _STATE["api_key"] = api_key
        _STATE["api_secret"] = api_secret
        _STATE["has_credentials"] = bool(api_key and api_secret)
        _STATE["last_error"] = None
    # Persist outside lock (I/O)
    if api_key and api_secret:
        save_credentials(api_key, api_secret)
    return get_live_account_session()


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
    clear_credentials()
    return deepcopy(_STATE)
