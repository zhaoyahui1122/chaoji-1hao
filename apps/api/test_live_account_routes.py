import os
from fastapi.testclient import TestClient

from app.main import app
from app.services.live_account_session import clear_live_account_session


os.environ.setdefault("ADMIN_USERNAME", "admin")
os.environ.setdefault("ADMIN_PASSWORD_HASH", "fcf730b6d95236ecd3c9fc2d92d7b6b2bb061514961aec041d6c7a7192f592e4")
os.environ.setdefault("SESSION_SECRET", "test-session-secret")

client = TestClient(app)


def test_live_account_status_defaults_to_disconnected():
    clear_live_account_session()
    login_response = client.post("/auth/login", json={"username": "admin", "password": "secret123"})
    assert login_response.status_code == 200
    response = client.get("/live-account/status")
    assert response.status_code == 200
    assert response.json() == {
        "connected": False,
        "has_credentials": False,
        "last_sync_at": None,
        "last_error": None,
        "account": None,
        "positions": [],
        "source": "gate_futures_live",
    }
