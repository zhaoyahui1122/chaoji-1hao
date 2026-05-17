from app.services.gate_live_account import build_gate_signature_headers


def test_build_gate_signature_headers_returns_gate_auth_fields():
    headers = build_gate_signature_headers(
        method="GET",
        path="/api/v4/futures/usdt/accounts",
        query_string="",
        body="",
        api_key="demo-key",
        api_secret="demo-secret",
        timestamp="1710000000",
    )

    assert headers["KEY"] == "demo-key"
    assert headers["Timestamp"] == "1710000000"
    assert "SIGN" in headers
