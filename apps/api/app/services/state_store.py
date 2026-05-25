from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from app.services.db import load_kv, save_kv

STATE_PATH = Path(__file__).resolve().parents[4] / "state" / "paper_broker_state.json"
STATE_PATH.parent.mkdir(parents=True, exist_ok=True)

PAPER_STATE_NAMESPACE = "paper"
PAPER_STATE_KEY = "broker_state"


def _write_state_file(data: dict[str, Any]) -> None:
    STATE_PATH.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def load_json_state(default: dict[str, Any]) -> dict[str, Any]:
    data = load_kv(PAPER_STATE_NAMESPACE, PAPER_STATE_KEY, None)
    if data is not None:
        return data

    if not STATE_PATH.exists():
        save_kv(PAPER_STATE_NAMESPACE, PAPER_STATE_KEY, default)
        return default
    try:
        loaded = json.loads(STATE_PATH.read_text(encoding="utf-8"))
        save_kv(PAPER_STATE_NAMESPACE, PAPER_STATE_KEY, loaded)
        return loaded
    except Exception:
        save_kv(PAPER_STATE_NAMESPACE, PAPER_STATE_KEY, default)
        return default


def export_json_state(data: dict[str, Any]) -> None:
    _write_state_file(data)


def save_json_state(data: dict[str, Any]) -> None:
    save_kv(PAPER_STATE_NAMESPACE, PAPER_STATE_KEY, data)
    _write_state_file(data)
