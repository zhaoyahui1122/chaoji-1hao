from __future__ import annotations

import importlib
import os
import sys
from contextlib import contextmanager
from typing import Iterator

import pytest
from fastapi.testclient import TestClient


@contextmanager
def auth_env(
    username: str = "admin",
    password_hash: str = "",
    session_secret: str = "test-session-secret",
) -> Iterator[None]:
    old_values = {
        "ADMIN_USERNAME": os.environ.get("ADMIN_USERNAME"),
        "ADMIN_PASSWORD_HASH": os.environ.get("ADMIN_PASSWORD_HASH"),
        "SESSION_SECRET": os.environ.get("SESSION_SECRET"),
    }
    if username:
        os.environ["ADMIN_USERNAME"] = username
    else:
        os.environ.pop("ADMIN_USERNAME", None)
    if password_hash:
        os.environ["ADMIN_PASSWORD_HASH"] = password_hash
    else:
        os.environ.pop("ADMIN_PASSWORD_HASH", None)
    if session_secret:
        os.environ["SESSION_SECRET"] = session_secret
    else:
        os.environ.pop("SESSION_SECRET", None)
    try:
        yield
    finally:
        for key, value in old_values.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value


def _reload_main_module():
    for module_name in (
        "app.api.routes_auth",
        "app.api.routes",
        "app.services.auth_service",
        "app.main",
    ):
        sys.modules.pop(module_name, None)
    return importlib.import_module("app.main")


@pytest.fixture
def password_hash():
    from hashlib import sha256

    return sha256("secret123".encode("utf-8")).hexdigest()


def test_protected_endpoint_requires_login(password_hash):
    with auth_env(password_hash=password_hash):
        main_module = _reload_main_module()
        client = TestClient(main_module.app)
        response = client.get("/dashboard")
        assert response.status_code == 401
        assert response.json()["detail"] == "Authentication required"


def test_login_session_logout_flow(password_hash):
    with auth_env(password_hash=password_hash):
        main_module = _reload_main_module()
        client = TestClient(main_module.app)

        login_response = client.post(
            "/auth/login",
            json={"username": "admin", "password": "secret123"},
        )
        assert login_response.status_code == 200
        assert login_response.json() == {"authenticated": True, "username": "admin"}

        session_response = client.get("/auth/session")
        assert session_response.status_code == 200
        assert session_response.json() == {"authenticated": True, "username": "admin"}

        protected_response = client.get("/protected-test-endpoint")
        assert protected_response.status_code == 404

        logout_response = client.post("/auth/logout")
        assert logout_response.status_code == 200
        assert logout_response.json() == {"authenticated": False}

        after_logout_response = client.get("/protected-test-endpoint")
        assert after_logout_response.status_code == 401


def test_login_rejects_invalid_password(password_hash):
    with auth_env(password_hash=password_hash):
        main_module = _reload_main_module()
        client = TestClient(main_module.app)

        response = client.post(
            "/auth/login",
            json={"username": "admin", "password": "wrong-password"},
        )
        assert response.status_code == 401
        assert response.json()["detail"] == "Invalid username or password"


def test_session_reports_unauthenticated_without_cookie(password_hash):
    with auth_env(password_hash=password_hash):
        main_module = _reload_main_module()
        client = TestClient(main_module.app)

        response = client.get("/auth/session")
        assert response.status_code == 200
        assert response.json() == {"authenticated": False}


def test_cors_preflight_bypasses_auth(password_hash):
    with auth_env(password_hash=password_hash):
        main_module = _reload_main_module()
        client = TestClient(main_module.app)

        response = client.options(
            "/backtest",
            headers={
                "Origin": "http://127.0.0.1:3000",
                "Access-Control-Request-Method": "POST",
            },
        )
        assert response.status_code == 200


def test_missing_auth_env_rejected_on_startup():
    with auth_env(username="", password_hash="", session_secret=""):
        main_module = _reload_main_module()
        with pytest.raises(RuntimeError):
            with TestClient(main_module.app):
                pass
