from __future__ import annotations

from datetime import datetime, timezone

from app.services import gate_market_data


class FakeResponse:
    def __init__(self, payload):
        self._payload = payload

    def raise_for_status(self):
        return None

    def json(self):
        return self._payload


def test_fetch_gate_futures_candles_paginates_when_window_exceeds_single_request(monkeypatch):
    step_seconds = 15 * 60
    request_windows: list[tuple[int, int]] = []

    def fake_gate_get(url: str, params: dict, timeout: float):
        assert url == gate_market_data.GATE_FUTURES_CANDLES_URL
        request_windows.append((int(params["from"]), int(params["to"])))
        from_ts = int(params["from"])
        to_ts = int(params["to"])
        payload = []
        cursor = from_ts
        while cursor <= to_ts:
            payload.append({
                "t": cursor,
                "v": "1",
                "c": "100",
                "h": "101",
                "l": "99",
                "o": "100",
            })
            cursor += step_seconds
        return FakeResponse(payload)

    monkeypatch.setattr(gate_market_data, "_gate_get", fake_gate_get)

    from_ts = int(datetime(2026, 5, 1, tzinfo=timezone.utc).timestamp())
    to_ts = int(datetime(2026, 6, 1, tzinfo=timezone.utc).timestamp())

    df = gate_market_data.fetch_gate_futures_candles(
        "BTC_USDT",
        "15m",
        limit=5000,
        from_ts=from_ts,
        to_ts=to_ts,
    )

    assert len(request_windows) == 2
    assert request_windows[0][0] == from_ts
    assert request_windows[-1][1] == to_ts
    assert not df.empty
    assert int(df.iloc[0]["timestamp"]) == from_ts
    assert int(df.iloc[-1]["timestamp"]) == to_ts
    assert len(df) == ((to_ts - from_ts) // step_seconds) + 1
