from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from app.services.db import load_kv, save_kv

_STATE_DIR = Path(os.environ.get("STATE_DIR", str(Path(__file__).resolve().parents[2] / "state")))
_STATE_DIR.mkdir(parents=True, exist_ok=True)
LOG_PATH = _STATE_DIR / "runner_logs.json"


def _load_json_fallback() -> list[dict[str, Any]]:
    if not LOG_PATH.exists():
        return []
    try:
        return json.loads(LOG_PATH.read_text(encoding="utf-8"))
    except Exception:
        return []


def load_logs() -> list[dict[str, Any]]:
    data = load_kv("runner", "logs", None)
    if data is not None:
        return data

    fallback = _load_json_fallback()
    save_kv("runner", "logs", fallback)
    return fallback


def append_log(entry: dict[str, Any], limit: int = 200) -> None:
    logs = load_logs()
    logs.append(entry)
    logs = logs[-limit:]
    save_kv("runner", "logs", logs)
    LOG_PATH.write_text(json.dumps(logs, ensure_ascii=False, indent=2), encoding="utf-8")
