from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from app.services.db import load_kv, save_kv

RUNNER_STATE_NAMESPACE = "runner"
RUNNER_STATE_KEY = "state"

_STATE_DIR = Path(os.environ.get("STATE_DIR", str(Path(__file__).resolve().parents[2] / "state")))
_STATE_DIR.mkdir(parents=True, exist_ok=True)
RUNNER_STATE_PATH = _STATE_DIR / "runner_state.json"

DEFAULT_RUNNER_STATE: dict[str, Any] = {
    "enabled": False,
    "is_running": False,
    "loop_count": 0,
    "last_run_at": None,
    "last_result": None,
    "last_error": None,
    "last_config": None,
    "halt_reason": None,
    "next_run_eta": None,
    "manual_resume_required": False,
    "last_executed_candle_eta": None,
    "selected_symbols": None,
    "last_mark_refresh_at": None,
    "last_live_mark_refresh_at": None,
    "last_live_mark_prices": None,
    "last_live_mark_error": None,
}


def _load_json_fallback() -> dict[str, Any]:
    if not RUNNER_STATE_PATH.exists():
        return DEFAULT_RUNNER_STATE.copy()
    try:
        data = json.loads(RUNNER_STATE_PATH.read_text(encoding="utf-8"))
        return {**DEFAULT_RUNNER_STATE, **data}
    except Exception:
        return DEFAULT_RUNNER_STATE.copy()


def _write_runner_json(data: dict[str, Any]) -> dict[str, Any]:
    RUNNER_STATE_PATH.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    return data


def export_runner_state(data: dict[str, Any]) -> dict[str, Any]:
    merged = {**DEFAULT_RUNNER_STATE, **data}
    return _write_runner_json(merged)


def load_runner_state() -> dict[str, Any]:
    data = load_kv(RUNNER_STATE_NAMESPACE, RUNNER_STATE_KEY, None)
    if data is not None:
        return {**DEFAULT_RUNNER_STATE, **data}

    fallback = _load_json_fallback()
    save_kv(RUNNER_STATE_NAMESPACE, RUNNER_STATE_KEY, fallback)
    return fallback


def save_runner_state(data: dict[str, Any]) -> dict[str, Any]:
    merged = {**DEFAULT_RUNNER_STATE, **data}
    save_kv(RUNNER_STATE_NAMESPACE, RUNNER_STATE_KEY, merged)
    return _write_runner_json(merged)
