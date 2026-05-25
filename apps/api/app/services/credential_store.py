"""Encrypted credential persistence using Fernet (AES) + SQLite."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from cryptography.fernet import Fernet

from app.services.db import load_kv, save_kv

_NS = "live_account"
_KEY_FILE = Path(__file__).resolve().parents[4] / "state" / ".cred_key"


def _get_or_create_fernet() -> Fernet:
    # Prefer environment variable (more secure than file)
    env_key = os.environ.get("GATE_FERNET_KEY")
    if env_key:
        return Fernet(env_key.encode("utf-8"))
    if _KEY_FILE.exists():
        key = _KEY_FILE.read_bytes()
    else:
        _KEY_FILE.parent.mkdir(parents=True, exist_ok=True)
        key = Fernet.generate_key()
        _KEY_FILE.write_bytes(key)
        # Restrict file permissions on Unix-like systems
        try:
            os.chmod(_KEY_FILE, 0o600)
        except OSError:
            pass
    return Fernet(key)


def save_credentials(api_key: str, api_secret: str) -> None:
    f = _get_or_create_fernet()
    enc_key = f.encrypt(api_key.encode("utf-8")).decode("utf-8")
    enc_secret = f.encrypt(api_secret.encode("utf-8")).decode("utf-8")
    save_kv(_NS, "api_key_enc", enc_key)
    save_kv(_NS, "api_secret_enc", enc_secret)


def load_credentials() -> tuple[str, str] | None:
    enc_key = load_kv(_NS, "api_key_enc", None)
    enc_secret = load_kv(_NS, "api_secret_enc", None)
    if not enc_key or not enc_secret:
        return None
    try:
        f = _get_or_create_fernet()
        api_key = f.decrypt(enc_key.encode("utf-8")).decode("utf-8")
        api_secret = f.decrypt(enc_secret.encode("utf-8")).decode("utf-8")
        return api_key, api_secret
    except Exception:
        return None


def clear_credentials() -> None:
    save_kv(_NS, "api_key_enc", None)
    save_kv(_NS, "api_secret_enc", None)
