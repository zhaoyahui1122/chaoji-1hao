from fastapi.testclient import TestClient

from app.main import app
from app.services.live_account_session import clear_live_account_session

client = TestClient(app)


def test_live_account_status_defaults_to_disconnected():
    clear_live_account_session()
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
