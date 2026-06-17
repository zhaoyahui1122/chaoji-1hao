from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import time
import secrets
from dataclasses import dataclass
from typing import Any


SESSION_COOKIE_NAME = "quant_gate_session"
SESSION_TTL_SECONDS = 60 * 60 * 12
OPERATION_TOKEN_TTL_SECONDS = 60 * 2


class AuthConfigError(RuntimeError):
    """Raised when required auth configuration is missing."""


class AuthenticationError(ValueError):
    """Raised when credentials are invalid."""


@dataclass(frozen=True)
class AuthSettings:
    admin_username: str
    admin_password_hash: str
    session_secret: str


def load_auth_settings(required: bool = True) -> AuthSettings | None:
    username = os.environ.get("ADMIN_USERNAME", "").strip()
    password_hash = os.environ.get("ADMIN_PASSWORD_HASH", "").strip()
    session_secret = os.environ.get("SESSION_SECRET", "").strip()

    missing = [
        name
        for name, value in (
            ("ADMIN_USERNAME", username),
            ("ADMIN_PASSWORD_HASH", password_hash),
            ("SESSION_SECRET", session_secret),
        )
        if not value
    ]
    if missing:
        if required:
            raise AuthConfigError(f"Missing auth environment variables: {', '.join(missing)}")
        return None
    return AuthSettings(
        admin_username=username,
        admin_password_hash=password_hash,
        session_secret=session_secret,
    )


def _urlsafe_b64encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("utf-8").rstrip("=")


def _urlsafe_b64decode(data: str) -> bytes:
    padding = "=" * (-len(data) % 4)
    return base64.urlsafe_b64decode(data + padding)


def _sign(payload_b64: str, secret: str) -> str:
    return hmac.new(secret.encode("utf-8"), payload_b64.encode("utf-8"), hashlib.sha256).hexdigest()


def create_session_token(username: str, secret: str, ttl_seconds: int = SESSION_TTL_SECONDS) -> str:
    payload = {
        "sub": username,
        "exp": int(time.time()) + ttl_seconds,
        "jti": secrets.token_urlsafe(18),
    }
    payload_b64 = _urlsafe_b64encode(json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8"))
    signature = _sign(payload_b64, secret)
    return f"{payload_b64}.{signature}"


def parse_session_token(token: str, secret: str, *, require_session_active: bool = True) -> dict[str, Any] | None:
    if not token or "." not in token:
        return None
    payload_b64, provided_sig = token.rsplit(".", 1)
    expected_sig = _sign(payload_b64, secret)
    if not hmac.compare_digest(provided_sig, expected_sig):
        return None
    try:
        payload = json.loads(_urlsafe_b64decode(payload_b64).decode("utf-8"))
    except (ValueError, json.JSONDecodeError, UnicodeDecodeError):
        return None
    if not isinstance(payload, dict):
        return None
    exp = payload.get("exp")
    username = payload.get("sub")
    if not isinstance(exp, int) or exp <= int(time.time()):
        return None
    if isinstance(payload.get("op"), str):
        return payload
    if not isinstance(username, str) or not username.strip():
        return None
    if require_session_active and not is_session_active(str(payload.get("jti", ""))):
        return None
    return payload


def create_password_hash(password: str, *, iterations: int = 260_000, salt: str | None = None) -> str:
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), iterations).hex()
    return f"pbkdf2_sha256${iterations}${salt}${digest}"


def verify_password(password: str, stored_hash: str) -> bool:
    normalized = stored_hash.strip()
    if not normalized:
        return False
    if normalized.startswith("$argon2"):
        try:
            from argon2 import PasswordHasher
            from argon2.exceptions import VerifyMismatchError, VerificationError
            try:
                return PasswordHasher().verify(normalized, password)
            except VerifyMismatchError:
                return False
            except VerificationError:
                return False
        except ImportError:
            return False
    if normalized.startswith("pbkdf2_sha256$"):
        try:
            _, iterations_raw, salt, expected = normalized.split("$", 3)
            candidate = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), int(iterations_raw)).hex()
            return hmac.compare_digest(candidate, expected)
        except (ValueError, TypeError):
            return False
    # ??? sha256 ????????????????
    if normalized.startswith("sha256$"):
        normalized = normalized.split("$", 1)[1]
    candidate_hash = hashlib.sha256(password.encode("utf-8")).hexdigest()
    return hmac.compare_digest(candidate_hash, normalized)


def authenticate(username: str, password: str) -> AuthSettings:
    settings = load_auth_settings(required=True)
    if username != settings.admin_username or not verify_password(password, settings.admin_password_hash):
        raise AuthenticationError("Invalid username or password")
    return settings


def create_operation_token(
    action: str,
    secret: str,
    ttl_seconds: int = OPERATION_TOKEN_TTL_SECONDS,
    session_jti: str | None = None,
) -> str:
    payload = {
        "op": action,
        "exp": int(time.time()) + ttl_seconds,
        "jti": secrets.token_urlsafe(18),
    }
    if session_jti:
        payload["session_jti"] = session_jti
    payload_b64 = _urlsafe_b64encode(json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8"))
    signature = _sign(payload_b64, secret)
    return f"{payload_b64}.{signature}"


def parse_operation_token(
    token: str,
    secret: str,
    expected_action: str,
    session_token: str | None = None,
) -> dict[str, Any] | None:
    payload = parse_session_token(token, secret, require_session_active=False)
    if not payload or payload.get("op") != expected_action:
        return None
    expected_session_jti = payload.get("session_jti")
    if expected_session_jti:
        session_payload = parse_session_token(session_token or "", secret)
        if not session_payload or session_payload.get("jti") != expected_session_jti:
            return None
    return payload


def _used_operation_store_key() -> str:
    return "used_operation_tokens"


def _load_used_operation_tokens() -> dict[str, int]:
    try:
        from app.services.db import load_kv
        data = load_kv("auth", _used_operation_store_key(), {})
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _save_used_operation_tokens(data: dict[str, int]) -> None:
    try:
        from app.services.db import save_kv
        save_kv("auth", _used_operation_store_key(), data)
    except Exception:
        pass


def _consume_operation_token_jti(jti: str, exp: int) -> bool:
    if not jti or exp <= int(time.time()):
        return False
    used = {k: v for k, v in _load_used_operation_tokens().items() if int(v or 0) > int(time.time())}
    if jti in used:
        return False
    used[jti] = exp
    _save_used_operation_tokens(used)
    return True


def verify_operation_token(
    token: str | None,
    expected_action: str,
    session_token: str | None = None,
    *,
    consume: bool = False,
) -> bool:
    if not token:
        return False
    settings = load_auth_settings(required=True)
    payload = parse_operation_token(token, settings.session_secret, expected_action, session_token=session_token)
    if payload is None:
        return False
    if consume:
        return _consume_operation_token_jti(str(payload.get("jti") or ""), int(payload.get("exp") or 0))
    return True


def require_operation_token(
    token: str | None,
    expected_action: str,
    session_token: str | None = None,
    *,
    consume: bool = True,
) -> None:
    if not verify_operation_token(token, expected_action, session_token=session_token, consume=consume):
        raise AuthenticationError(f"Operation confirmation required: {expected_action}")


def _session_store_path() -> str:
    return "auth_sessions"


def _load_active_sessions() -> dict[str, int]:
    try:
        from app.services.db import load_kv
        data = load_kv("auth", _session_store_path(), {})
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _save_active_sessions(data: dict[str, int]) -> None:
    try:
        from app.services.db import save_kv
        save_kv("auth", _session_store_path(), data)
    except Exception:
        pass


def register_session_token(token: str, secret: str) -> None:
    payload = parse_session_token(token, secret, require_session_active=False)
    if not payload:
        return
    jti = str(payload.get("jti") or "")
    exp = int(payload.get("exp") or 0)
    if not jti or exp <= int(time.time()):
        return
    sessions = {k: v for k, v in _load_active_sessions().items() if int(v or 0) > int(time.time())}
    sessions[jti] = exp
    _save_active_sessions(sessions)


def revoke_session_token(token: str, secret: str) -> None:
    payload = parse_session_token(token, secret, require_session_active=False)
    if not payload:
        return
    jti = str(payload.get("jti") or "")
    sessions = _load_active_sessions()
    if jti in sessions:
        sessions.pop(jti, None)
        _save_active_sessions(sessions)


def is_session_active(jti: str) -> bool:
    if not jti:
        return False
    sessions = _load_active_sessions()
    exp = int(sessions.get(jti) or 0)
    if exp <= int(time.time()):
        if jti in sessions:
            sessions.pop(jti, None)
            _save_active_sessions(sessions)
        return False
    return True


def get_cookie_secure() -> bool:
    env = os.environ.get("APP_ENV", "").strip().lower()
    if env in {"prod", "production"}:
        return True
    return os.environ.get("COOKIE_SECURE", "").strip().lower() in {"1", "true", "yes", "on"}
