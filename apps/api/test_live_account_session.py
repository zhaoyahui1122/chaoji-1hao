from app.services.live_account_session import clear_live_account_session, get_live_account_session, set_live_account_credentials


def test_live_account_session_stores_credentials_without_persistence():
    clear_live_account_session()

    set_live_account_credentials(api_key="demo-key", api_secret="demo-secret")
    session = get_live_account_session()

    assert session["has_credentials"] is True
    assert session["api_key"] == "demo-key"
    assert session["api_secret"] == "demo-secret"
    assert session["last_error"] is None
