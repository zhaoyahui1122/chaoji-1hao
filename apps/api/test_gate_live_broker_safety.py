import json

from app.services import gate_live_broker as glb
from app.services.gate_live_broker import GateLiveBroker, LivePosition


def test_gate_trigger_rules_match_stop_loss_and_take_profit_direction():
    assert glb._gate_trigger_rule("long", "stop_loss") == 2
    assert glb._gate_trigger_rule("long", "take_profit") == 1
    assert glb._gate_trigger_rule("short", "stop_loss") == 1
    assert glb._gate_trigger_rule("short", "take_profit") == 2


def test_equity_uses_total_balance_plus_unrealized_pnl(monkeypatch):
    broker = GateLiveBroker()
    monkeypatch.setattr(broker, "_creds", lambda: ("key", "secret"))
    monkeypatch.setattr(
        glb,
        "fetch_futures_account",
        lambda api_key, api_secret: {
            "total": "1000",
            "available": "800",
            "unrealised_pnl": "25",
        },
    )

    assert broker.equity == 1025


def test_close_position_uses_integer_reduce_only_size_and_query_string(monkeypatch):
    broker = GateLiveBroker()
    broker._positions = [
        LivePosition(
            position_id="BTC_USDT",
            symbol="BTC_USDT",
            side="long",
            leverage=50,
            qty=3.0,
            entry_price=100000,
            mark_price=101000,
        )
    ]
    calls = []

    monkeypatch.setattr(broker, "_creds", lambda: ("key", "secret"))
    monkeypatch.setattr(broker, "sync_positions", lambda: broker._positions)
    monkeypatch.setattr(
        glb,
        "fetch_futures_account",
        lambda api_key, api_secret: {
            "total": "1000",
            "available": "900",
            "unrealised_pnl": "0",
        },
    )
    monkeypatch.setattr(glb, "write_equity_snapshot", lambda **kwargs: None)
    monkeypatch.setattr(glb, "append_order_event", lambda **kwargs: None)
    monkeypatch.setattr(glb, "upsert_live_position", lambda **kwargs: None)
    monkeypatch.setattr(glb, "close_structured_position", lambda **kwargs: None)

    def fake_private_request(method, path, api_key, api_secret, query_string="", body="", timeout=15):
        calls.append({
            "method": method,
            "path": path,
            "query_string": query_string,
            "body": json.loads(body) if body else None,
        })
        if method == "POST":
            return {"id": "order-1", "status": "finished", "fill_price": "101000"}
        if "position_close" in path:
            return []
        return []

    monkeypatch.setattr(glb, "_gate_private_request", fake_private_request)

    result = broker.close_position("BTC_USDT", 101000)

    assert result["ok"] is True
    close_order_call = next(call for call in calls if call["method"] == "POST")
    assert close_order_call["body"]["size"] == -3
    assert isinstance(close_order_call["body"]["size"], int)

    cancel_call = next(call for call in calls if call["method"] == "DELETE")
    assert cancel_call["path"] == glb.GATE_FUTURES_PRICE_ORDERS_PATH
    assert cancel_call["query_string"] == "contract=BTC_USDT&status=open"


def test_place_order_emergency_closes_when_stop_loss_order_fails(monkeypatch):
    broker = GateLiveBroker()
    calls = []

    monkeypatch.setattr(broker, "_creds", lambda: ("key", "secret"))
    monkeypatch.setattr(broker, "sync_positions", lambda: broker._positions)
    monkeypatch.setattr(glb, "_get_quanto_multiplier", lambda contract: 1.0)
    monkeypatch.setattr(glb, "_round_price_tick", lambda price, contract=None: price)
    monkeypatch.setattr(glb, "append_order_event", lambda **kwargs: None)
    monkeypatch.setattr(glb, "upsert_live_position", lambda **kwargs: None)
    monkeypatch.setattr(glb, "insert_live_position", lambda **kwargs: None)

    def fake_private_request(method, path, api_key, api_secret, query_string="", body="", timeout=15):
        parsed_body = json.loads(body) if body else None
        calls.append({
            "method": method,
            "path": path,
            "query_string": query_string,
            "body": parsed_body,
        })
        if path.endswith("/BTC_USDT/leverage"):
            return {"leverage": "10"}
        if method == "POST" and path == glb.GATE_FUTURES_ORDERS_PATH:
            return {"id": f"order-{len(calls)}", "status": "finished", "fill_price": "100"}
        if method == "POST" and path == glb.GATE_FUTURES_PRICE_ORDERS_PATH:
            raise RuntimeError("price_order_failed")
        return {}

    monkeypatch.setattr(glb, "_gate_private_request", fake_private_request)

    result = broker.place_order(
        symbol="BTC_USDT",
        side="long",
        price=100,
        leverage=10,
        allocated_margin=10,
        stop_loss_price=95,
        source="runner",
        meta={"take_profit_price": 110},
    )

    order_posts = [
        call for call in calls
        if call["method"] == "POST" and call["path"] == glb.GATE_FUTURES_ORDERS_PATH
    ]
    assert result["ok"] is False
    assert result["error"] == "stop_loss_order_failed"
    assert result["emergency_close"]["ok"] is True
    assert len(order_posts) == 2
    assert order_posts[0]["body"]["reduce_only"] is False
    assert order_posts[0]["body"]["size"] == 1
    assert order_posts[1]["body"]["reduce_only"] is True
    assert order_posts[1]["body"]["size"] == -1
