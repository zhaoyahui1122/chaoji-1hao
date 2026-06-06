from __future__ import annotations

import importlib
import json
import os
import sys
from contextlib import contextmanager
from pathlib import Path

import pandas as pd
from fastapi.testclient import TestClient

from app.services.runner_log_store import append_log, load_logs
from app.services.db import get_conn, init_db, save_kv
from app.services.paper_store import load_structured_paper_state
from app.services.runner_state_store import DEFAULT_RUNNER_STATE, load_runner_state, save_runner_state
from app.services.strategy_runner import _run_single_symbol_cycle, set_runner_enabled


REPO_ROOT = Path(__file__).resolve().parents[2]
STATE_DIR = REPO_ROOT / "state"
JSON_BROKER_PATH = STATE_DIR / "paper_broker_state.json"
JSON_RUNNER_PATH = STATE_DIR / "runner_state.json"


@contextmanager
def auth_env(
    username: str = "admin",
    password_hash: str = "fcf730b6d95236ecd3c9fc2d92d7b6b2bb061514961aec041d6c7a7192f592e4",
    session_secret: str = "test-session-secret",
):
    old_values = {
        "ADMIN_USERNAME": os.environ.get("ADMIN_USERNAME"),
        "ADMIN_PASSWORD_HASH": os.environ.get("ADMIN_PASSWORD_HASH"),
        "SESSION_SECRET": os.environ.get("SESSION_SECRET"),
    }
    os.environ["ADMIN_USERNAME"] = username
    os.environ["ADMIN_PASSWORD_HASH"] = password_hash
    os.environ["SESSION_SECRET"] = session_secret
    try:
        yield
    finally:
        for key, value in old_values.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value


def login_test_client(client: TestClient) -> None:
    login_response = client.post("/auth/login", json={"username": "admin", "password": "secret123"})
    assert login_response.status_code == 200


def _reset_tables() -> None:
    init_db()
    if JSON_BROKER_PATH.exists():
        JSON_BROKER_PATH.unlink()
    if JSON_RUNNER_PATH.exists():
        JSON_RUNNER_PATH.unlink()
    with get_conn() as conn:
        conn.execute("DELETE FROM paper_orders")
        conn.execute("DELETE FROM paper_positions")
        conn.execute("DELETE FROM paper_account_snapshots")
        conn.execute("DELETE FROM kv_store WHERE namespace IN ('paper', 'runner')")
        conn.commit()


def _reload_runtime_modules():
    for module_name in (
        "app.paper.broker",
        "app.core.state",
        "app.services.scheduler",
        "app.api.routes_dashboard",
        "app.api.routes_runner",
        "app.api.routes_history",
        "app.api.routes",
        "app.main",
    ):
        sys.modules.pop(module_name, None)

    broker_module = importlib.import_module("app.paper.broker")
    state_module = importlib.import_module("app.core.state")
    main_module = importlib.import_module("app.main")
    return broker_module, state_module, main_module


def _reload_broker_state():
    _, state_module, _ = _reload_runtime_modules()
    return state_module.PAPER_BROKER


def test_broker_loads_open_positions_from_sqlite_only():
    _reset_tables()
    JSON_BROKER_PATH.write_text(
        json.dumps(
            {
                "initial_balance": 999.0,
                "realized_pnl": 123.0,
                "positions": [
                    {
                        "position_id": "json-only",
                        "symbol": "DOGE_USDT",
                        "side": "long",
                        "leverage": 5,
                        "qty": 10.0,
                        "entry_price": 0.1,
                        "mark_price": 0.2,
                    }
                ],
                "orders": [
                    {
                        "position_id": "json-only",
                        "symbol": "DOGE_USDT",
                        "side": "long",
                        "price": 0.1,
                        "qty": 10.0,
                        "status": "filled",
                        "event_type": "open",
                        "source": "json",
                        "meta_json": None,
                    }
                ],
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO paper_positions(position_id, symbol, side, leverage, qty, entry_price, mark_price, fee_rate, slippage_rate, entry_fee, cumulative_fees, entry_slippage_cost, exit_slippage_cost, cumulative_slippage_cost, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open')
            """,
            ("sqlite-open", "BTC_USDT", "long", 10, 0.5, 100.0, 101.0, 0.0005, 0.0002, 1.0, 1.0, 0.0, 0.0, 0.0),
        )
        conn.execute(
            """
            INSERT INTO paper_positions(position_id, symbol, side, leverage, qty, entry_price, mark_price, fee_rate, slippage_rate, entry_fee, cumulative_fees, entry_slippage_cost, exit_slippage_cost, cumulative_slippage_cost, status, close_price, realized_pnl, closed_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'closed', ?, ?, CURRENT_TIMESTAMP)
            """,
            ("sqlite-closed", "ETH_USDT", "short", 20, 1.0, 200.0, 190.0, 0.0005, 0.0002, 1.0, 2.0, 0.0, 0.0, 0.0, 180.0, 15.0),
        )
        conn.execute(
            "INSERT INTO paper_account_snapshots(initial_balance, realized_pnl, equity, available_balance, margin_used, margin_ratio, unrealized_pnl, open_positions) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (10000.0, 55.0, 10055.0, 9955.0, 100.0, 0.01, 0.0, 1),
        )
        conn.execute(
            "INSERT INTO paper_orders(position_id, symbol, side, price, qty, status, event_type, source, meta_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            ("sqlite-open", "BTC_USDT", "long", 100.0, 0.5, "filled", "open", "sqlite", json.dumps({"kind": "open"})),
        )
        conn.execute(
            "INSERT INTO paper_orders(position_id, symbol, side, price, qty, status, event_type, source, meta_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            ("sqlite-open", "BTC_USDT", "long", 101.0, 0.5, "mark", "mark", "sqlite", json.dumps({"kind": "mark"})),
        )
        conn.execute(
            "INSERT INTO paper_orders(position_id, symbol, side, price, qty, status, event_type, source, meta_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            ("sqlite-closed", "ETH_USDT", "short", 180.0, 1.0, "closed", "close", "sqlite", json.dumps({"kind": "close"})),
        )
        conn.commit()

    broker_module, _, _ = _reload_runtime_modules()
    broker = broker_module.PaperBroker(initial_balance=10000.0)

    state = load_structured_paper_state({"initial_balance": 10000.0, "realized_pnl": 0.0, "positions": [], "orders": []})
    assert state is not None
    assert {pos["position_id"] for pos in state["positions"]} == {"sqlite-open"}
    assert {order["position_id"] for order in state["orders"]} == {"sqlite-open"}
    assert {pos.position_id for pos in broker.positions} == {"sqlite-open"}
    assert {order.position_id for order in broker.orders} == {"sqlite-open"}
    assert broker.realized_pnl == 55.0


def test_broker_persists_open_and_close_to_sqlite_only():
    _reset_tables()
    broker = _reload_broker_state()

    open_result = broker.place_order(
        symbol="BTC_USDT",
        side="long",
        price=100.0,
        leverage=10,
        allocated_margin=1000.0,
        stop_loss_price=95.0,
        source="test",
        meta={"test_case": "sqlite_only", "take_profit_pct": 0.1},
        qty=1.0,
    )
    assert open_result["ok"] is True
    position_id = open_result["order"]["position_id"]

    with get_conn() as conn:
        open_rows = conn.execute("SELECT position_id, status FROM paper_positions WHERE position_id = ? ORDER BY id ASC", (position_id,)).fetchall()
        assert [dict(row) for row in open_rows] == [{"position_id": position_id, "status": "open"}]
        order_rows = conn.execute("SELECT position_id, event_type, meta_json FROM paper_orders WHERE position_id = ? ORDER BY id ASC", (position_id,)).fetchall()
        assert len(order_rows) == 1
        assert order_rows[0]["position_id"] == position_id
        assert order_rows[0]["event_type"] == "open"
        open_meta = json.loads(order_rows[0]["meta_json"])
        assert open_meta["test_case"] == "sqlite_only"
        assert open_meta["take_profit_pct"] == 0.1
        assert open_meta["stop_loss_price"] == 95.0
        assert open_meta["take_profit_price"] == 110.01100000000001

    with auth_env():
        _, _, main_module = _reload_runtime_modules()
        client = TestClient(main_module.app)
        login_test_client(client)
        history_open = client.get(f"/history/positions?symbol=BTC_USDT&status=open").json()
    open_dashboard_broker = _reload_broker_state()
    dashboard_snapshot = open_dashboard_broker.snapshot()

    dashboard_position = next(item for item in dashboard_snapshot["positions"] if item["position_id"] == position_id)
    history_open_position = next(item for item in history_open["items"] if item["position_id"] == position_id)
    dashboard_meta = json.loads(dashboard_position["open_order_meta_json"])
    history_open_meta = json.loads(history_open_position["open_meta_json"])

    assert dashboard_meta["stop_loss_price"] == 95.0
    assert dashboard_meta["take_profit_price"] == 110.01100000000001
    assert history_open_meta["stop_loss_price"] == 95.0
    assert history_open_meta["take_profit_price"] == 110.01100000000001

    close_result = broker.close_position("BTC_USDT", 110.0, source="test", position_id=position_id)
    assert close_result["ok"] is True

    with get_conn() as conn:
        position_rows = conn.execute("SELECT position_id, status, close_price, realized_pnl FROM paper_positions WHERE position_id = ? ORDER BY id ASC", (position_id,)).fetchall()
        assert len(position_rows) == 1
        assert position_rows[0]["status"] == "closed"
        assert position_rows[0]["close_price"] is not None
        assert position_rows[0]["realized_pnl"] is not None
        order_rows = conn.execute("SELECT position_id, event_type FROM paper_orders WHERE position_id = ? ORDER BY id ASC", (position_id,)).fetchall()
        assert [dict(row) for row in order_rows] == [
            {"position_id": position_id, "event_type": "open"},
            {"position_id": position_id, "event_type": "close"},
        ]

    positions_history = client.get(f"/history/positions?symbol=BTC_USDT").json()
    history_position = next(item for item in positions_history["items"] if item["position_id"] == position_id)
    history_meta = json.loads(history_position["open_meta_json"])

    assert history_meta["stop_loss_price"] == 95.0
    assert history_meta["take_profit_price"] == 110.01100000000001


def test_scheduler_live_mark_refresh_updates_positions_without_mark_orders(monkeypatch):
    _reset_tables()
    save_kv(
        "runner",
        "state",
        {
            **DEFAULT_RUNNER_STATE,
            "enabled": True,
            "selected_symbols": ["BTC_USDT"],
            "last_config": {"symbols": ["BTC_USDT"], "stop_loss_pct": 0.02, "take_profit_pct": 0.5},
            "last_mark_refresh_at": 0,
        },
    )

    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO paper_positions(position_id, symbol, side, leverage, qty, entry_price, mark_price, fee_rate, slippage_rate, entry_fee, cumulative_fees, entry_slippage_cost, exit_slippage_cost, cumulative_slippage_cost, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open')
            """,
            ("scheduler-open", "BTC_USDT", "long", 10, 1.0, 100.0, 101.0, 0.0005, 0.0002, 1.0, 1.0, 0.0, 0.0, 0.0),
        )
        conn.execute(
            "INSERT INTO paper_orders(position_id, symbol, side, price, qty, status, event_type, source, meta_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            ("scheduler-open", "BTC_USDT", "long", 100.0, 1.0, "filled", "open", "sqlite", json.dumps({"kind": "open"})),
        )
        conn.commit()

    broker_module, _, _ = _reload_runtime_modules()
    broker = _reload_broker_state()
    scheduler_module = sys.modules["app.services.scheduler"]
    assert broker.positions[0].position_id == "scheduler-open"

    monkeypatch.setattr(
        scheduler_module,
        "fetch_gate_futures_ticker",
        lambda symbol: {"mark_price": 123.45, "last_price": 123.4, "index_price": 123.5},
    )

    refreshed = scheduler_module._refresh_open_position_marks()

    assert refreshed == {"BTC_USDT": 123.45}

    refreshed_broker = _reload_broker_state()

    with get_conn() as conn:
        position_rows = conn.execute(
            "SELECT mark_price FROM paper_positions WHERE position_id = ? ORDER BY id ASC",
            ("scheduler-open",),
        ).fetchall()
        order_rows = conn.execute(
            "SELECT event_type FROM paper_orders WHERE position_id = ? ORDER BY id ASC",
            ("scheduler-open",),
        ).fetchall()

    assert [row["mark_price"] for row in position_rows] == [123.45]
    assert [position.mark_price for position in refreshed_broker.positions if position.position_id == "scheduler-open"] == [123.45]
    assert [row["event_type"] for row in order_rows] == ["open"]



def test_scheduler_live_mark_refresh_closes_position_immediately_on_stop_loss(monkeypatch):
    _reset_tables()
    save_kv(
        "runner",
        "state",
        {
            **DEFAULT_RUNNER_STATE,
            "enabled": True,
            "selected_symbols": ["BTC_USDT"],
            "last_config": {"symbols": ["BTC_USDT"], "stop_loss_pct": 0.02, "take_profit_pct": 0.04},
            "last_mark_refresh_at": 0,
        },
    )

    broker = _reload_broker_state()
    open_result = broker.place_order(
        symbol="BTC_USDT",
        side="long",
        price=100.0,
        leverage=10,
        allocated_margin=1000.0,
        stop_loss_price=95.0,
        source="test",
        meta={"stop_loss_price": 95.0, "take_profit_price": 110.0},
        qty=1.0,
    )
    assert open_result["ok"] is True
    position_id = open_result["order"]["position_id"]

    open_meta = json.loads(open_result["order"]["meta_json"])
    scheduler_broker = _reload_broker_state()
    assert any(position.position_id == position_id for position in scheduler_broker.positions)

    scheduler_module = sys.modules["app.services.scheduler"]
    monkeypatch.setattr(
        scheduler_module,
        "fetch_gate_futures_ticker",
        lambda symbol: {"mark_price": 94.0, "last_price": 94.0, "index_price": 94.1},
    )

    refreshed = scheduler_module._refresh_open_position_marks()

    assert refreshed == {"BTC_USDT": 94.0}
    refreshed_broker = _reload_broker_state()
    assert not any(position.position_id == position_id for position in refreshed_broker.positions)

    with get_conn() as conn:
        position_rows = conn.execute(
            "SELECT status, close_price FROM paper_positions WHERE position_id = ? ORDER BY id ASC",
            (position_id,),
        ).fetchall()
        order_rows = conn.execute(
            "SELECT event_type, meta_json FROM paper_orders WHERE position_id = ? ORDER BY id ASC",
            (position_id,),
        ).fetchall()

    assert [dict(row) for row in position_rows] == [{"status": "closed", "close_price": 93.9906}]
    assert [row["event_type"] for row in order_rows] == ["open", "close"]
    close_meta = json.loads(order_rows[-1]["meta_json"])
    assert close_meta["close_reason"] == "stop_loss"
    assert close_meta["trigger_basis"] == "live_mark"
    assert close_meta["trigger_price"] == 94.0
    assert close_meta["stop_loss_price"] == open_meta["stop_loss_price"]
    assert close_meta["take_profit_price"] == open_meta["take_profit_price"]



def test_non_persisted_live_mark_refresh_updates_dashboard_and_history(monkeypatch):
    _reset_tables()
    save_kv(
        "runner",
        "state",
        {
            **DEFAULT_RUNNER_STATE,
            "enabled": True,
            "selected_symbols": ["BTC_USDT", "ETH_USDT"],
            "last_config": {"symbols": ["BTC_USDT", "ETH_USDT"]},
        },
    )

    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO paper_positions(position_id, symbol, side, leverage, qty, entry_price, mark_price, fee_rate, slippage_rate, entry_fee, cumulative_fees, entry_slippage_cost, exit_slippage_cost, cumulative_slippage_cost, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open')
            """,
            ("dashboard-open", "BTC_USDT", "long", 10, 1.0, 100.0, 102.0, 0.0005, 0.0002, 1.0, 1.0, 0.0, 0.0, 0.0),
        )
        conn.execute(
            """
            INSERT INTO paper_positions(position_id, symbol, side, leverage, qty, entry_price, mark_price, fee_rate, slippage_rate, entry_fee, cumulative_fees, entry_slippage_cost, exit_slippage_cost, cumulative_slippage_cost, status, close_price, realized_pnl, closed_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'closed', ?, ?, CURRENT_TIMESTAMP)
            """,
            ("dashboard-closed", "ETH_USDT", "short", 10, 1.0, 200.0, 198.0, 0.0005, 0.0002, 1.0, 2.0, 0.0, 0.0, 0.0, 190.0, 8.0),
        )
        conn.execute(
            "INSERT INTO paper_account_snapshots(initial_balance, realized_pnl, equity, available_balance, margin_used, margin_ratio, unrealized_pnl, open_positions) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (10000.0, 8.0, 10008.0, 9900.0, 100.0, 0.01, 0.0, 1),
        )
        conn.execute(
            "INSERT INTO paper_orders(position_id, symbol, side, price, qty, status, event_type, source, meta_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            ("dashboard-open", "BTC_USDT", "long", 100.0, 1.0, "filled", "open", "sqlite", json.dumps({"kind": "open"})),
        )
        conn.execute(
            "INSERT INTO paper_orders(position_id, symbol, side, price, qty, status, event_type, source, meta_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            ("dashboard-open", "BTC_USDT", "long", 102.0, 1.0, "mark", "mark", "sqlite", json.dumps({"kind": "mark"})),
        )
        conn.execute(
            "INSERT INTO paper_orders(position_id, symbol, side, price, qty, status, event_type, source, meta_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            ("dashboard-closed", "ETH_USDT", "short", 190.0, 1.0, "closed", "close", "sqlite", json.dumps({"kind": "close"})),
        )
        conn.commit()

    with auth_env():
        _, _, main_module = _reload_runtime_modules()
        broker = _reload_broker_state()
        client = TestClient(main_module.app)
        login_test_client(client)

        dashboard = client.get("/dashboard").json()
        positions_history = client.get("/history/positions").json()
        stats = client.get("/history/stats").json()
        runner = client.get("/runner/status").json()

    assert [item["position_id"] for item in dashboard["positions"]] == ["dashboard-open"]
    assert {item["position_id"] for item in dashboard["orders"]} == {"dashboard-open"}
    assert {item["event_type"] for item in dashboard["orders"]} == {"open", "mark"}
    assert {item["position_id"] for item in positions_history["items"]} == {"dashboard-open", "dashboard-closed"}
    assert stats["total_trades"] == 1
    assert runner["selected_symbols"] == ["BTC_USDT", "ETH_USDT"]
    assert runner["current_strategy_config"]["symbols"] == ["BTC_USDT", "ETH_USDT"]


def test_pause_runner_closes_open_positions_at_market_mark_price():
    _reset_tables()
    save_kv(
        "runner",
        "state",
        {
            **DEFAULT_RUNNER_STATE,
            "enabled": True,
            "selected_symbols": ["BTC_USDT", "ETH_USDT"],
            "last_config": {"symbols": ["BTC_USDT", "ETH_USDT"]},
        },
    )

    broker = _reload_broker_state()
    strategy_runner_module = importlib.import_module("app.services.strategy_runner")
    strategy_runner_module.PAPER_BROKER = broker
    strategy_runner_module.get_broker = lambda trade_mode="paper": broker

    first_open = broker.place_order(
        symbol="BTC_USDT",
        side="long",
        price=100.0,
        leverage=10,
        allocated_margin=1000.0,
        stop_loss_price=95.0,
        source="test",
        meta={"take_profit_price": 110.0},
        qty=1.0,
    )
    second_open = broker.place_order(
        symbol="ETH_USDT",
        side="long",
        price=200.0,
        leverage=10,
        allocated_margin=1000.0,
        stop_loss_price=190.0,
        source="test",
        meta={"take_profit_price": 220.0},
        qty=1.0,
    )
    assert first_open["ok"] is True
    assert second_open["ok"] is True

    first_position_id = first_open["order"]["position_id"]
    second_position_id = second_open["order"]["position_id"]

    broker.update_mark_price("BTC_USDT", 101.5, source="test", persist=False)
    broker.update_mark_price("ETH_USDT", 198.25, source="test", persist=False)

    paused_state = strategy_runner_module.set_runner_enabled(False)

    assert paused_state["enabled"] is False
    assert paused_state["is_running"] is False
    assert paused_state["next_run_eta"] is None
    assert {item["position_id"] for item in paused_state["last_pause_closed_positions"]} == {first_position_id, second_position_id}

    reloaded_broker = _reload_broker_state()
    assert reloaded_broker.positions == []

    with get_conn() as conn:
        position_rows = conn.execute(
            "SELECT position_id, status, close_price FROM paper_positions WHERE position_id IN (?, ?) ORDER BY position_id ASC",
            (first_position_id, second_position_id),
        ).fetchall()
        order_rows = conn.execute(
            "SELECT position_id, event_type, meta_json FROM paper_orders WHERE position_id IN (?, ?) ORDER BY id ASC",
            (first_position_id, second_position_id),
        ).fetchall()

    assert [row["status"] for row in position_rows] == ["closed", "closed"]
    close_meta_by_position = {
        row["position_id"]: json.loads(row["meta_json"])
        for row in order_rows
        if row["event_type"] == "close"
    }
    assert set(close_meta_by_position) == {first_position_id, second_position_id}
    assert close_meta_by_position[first_position_id]["close_reason"] == "runner_paused"
    assert close_meta_by_position[first_position_id]["trigger_basis"] == "manual_pause"
    assert close_meta_by_position[first_position_id]["requested_price"] == 101.5
    assert close_meta_by_position[second_position_id]["close_reason"] == "runner_paused"
    assert close_meta_by_position[second_position_id]["trigger_basis"] == "manual_pause"
    assert close_meta_by_position[second_position_id]["requested_price"] == 198.25


def test_runner_state_reads_kv_before_json_fallback():
    _reset_tables()
    JSON_RUNNER_PATH.write_text(
        json.dumps({
            **DEFAULT_RUNNER_STATE,
            "enabled": False,
            "selected_symbols": ["JSON_ONLY"],
        }, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    save_kv(
        "runner",
        "state",
        {
            **DEFAULT_RUNNER_STATE,
            "enabled": True,
            "selected_symbols": ["BTC_USDT", "ETH_USDT"],
            "last_config": {"symbols": ["BTC_USDT", "ETH_USDT"]},
        },
    )

    state = load_runner_state()
    assert state["enabled"] is True
    assert state["selected_symbols"] == ["BTC_USDT", "ETH_USDT"]

    persisted = save_runner_state({**state, "loop_count": 9})
    assert persisted["loop_count"] == 9
    written_json = json.loads(JSON_RUNNER_PATH.read_text(encoding="utf-8"))
    assert written_json["selected_symbols"] == ["BTC_USDT", "ETH_USDT"]
    assert written_json["loop_count"] == 9


def test_runner_reset_paper_clears_runner_runtime_state_and_logs():
    _reset_tables()
    save_runner_state({
        **DEFAULT_RUNNER_STATE,
        "enabled": True,
        "is_running": True,
        "loop_count": 7,
        "last_run_at": "2026-06-04T15:00:00",
        "last_result": {"ok": True, "action": "open"},
        "last_error": "old error",
        "last_config": {"symbol": "BTC_USDT"},
        "selected_symbols": ["BTC_USDT", "ETH_USDT"],
        "trade_mode": "paper",
    })
    append_log({"ts": "2026-06-04T15:00:00", "result": {"action": "open"}})

    with auth_env():
        _, _, main_module = _reload_runtime_modules()
        client = TestClient(main_module.app)
        login_response = client.post("/auth/login", json={"username": "admin", "password": "secret123"})
        assert login_response.status_code == 200

        response = client.post("/runner/reset-paper")
        assert response.status_code == 200

    state = load_runner_state()
    assert state["enabled"] is False
    assert state["is_running"] is False
    assert state["loop_count"] == 0
    assert state["last_run_at"] is None
    assert state["last_result"] is None
    assert state["last_error"] is None
    assert state["last_config"] is None
    assert state["selected_symbols"] is None
    assert state["trade_mode"] == "paper"
    assert load_logs() == []


def test_paper_reset_custom_also_clears_runner_runtime_state_and_logs():
    _reset_tables()
    save_runner_state({
        **DEFAULT_RUNNER_STATE,
        "enabled": True,
        "is_running": False,
        "loop_count": 3,
        "last_run_at": "2026-06-04T16:00:00",
        "last_result": {"ok": False, "action": "halted"},
        "last_config": {"symbol": "ETH_USDT"},
        "selected_symbols": ["ETH_USDT"],
        "trade_mode": "paper",
    })
    append_log({"ts": "2026-06-04T16:00:00", "result": {"action": "halted"}})

    with auth_env():
        _, _, main_module = _reload_runtime_modules()
        client = TestClient(main_module.app)
        login_response = client.post("/auth/login", json={"username": "admin", "password": "secret123"})
        assert login_response.status_code == 200

        response = client.post("/paper/reset-custom", json={"initial_balance": 1000})
        assert response.status_code == 200

    state = load_runner_state()
    assert state["enabled"] is False
    assert state["is_running"] is False
    assert state["loop_count"] == 0
    assert state["last_run_at"] is None
    assert state["last_result"] is None
    assert state["last_config"] is None
    assert state["selected_symbols"] is None
    assert load_logs() == []


def test_runner_run_once_accepts_50x_leverage():
    _reset_tables()
    with auth_env():
        _, _, main_module = _reload_runtime_modules()
        client = TestClient(main_module.app)
        login_response = client.post("/auth/login", json={"username": "admin", "password": "secret123"})
        assert login_response.status_code == 200

        response = client.post(
            "/runner/run-once",
            json={
                "symbol": "BTC_USDT",
                "symbols": ["BTC_USDT"],
                "timeframe": "15m",
                "strategy_type": "classic",
                "data_source": "gate",
                "trade_mode": "paper",
                "leverage": 50,
                "allocated_margin": 100,
                "use_boll": True,
                "boll_period": 24,
                "boll_std": 2.0,
                "use_rsi": True,
                "rsi_period": 14,
                "rsi_oversold": 30,
                "rsi_overbought": 70,
                "use_ma": True,
                "ma_short": 10,
                "ma_long": 30,
                "min_signal_score": 4,
                "churn_guard_enabled": True,
                "turtle_entry_period": 20,
                "turtle_exit_period": 10,
                "turtle_atr_period": 14,
                "turtle_atr_filter": 0.0,
                "stop_loss_pct": 0.02,
                "take_profit_pct": 0.05,
                "risk_per_trade_pct": 0.01,
                "fee_rate": 0.00015,
                "slippage_rate": 0.0001,
            },
        )

    assert response.status_code != 422


def test_run_single_symbol_cycle_with_existing_position_does_not_raise_trade_mode_name_error():
    _reset_tables()
    broker = _reload_broker_state()
    open_result = broker.place_order(
        symbol="BTC_USDT",
        side="long",
        price=100.0,
        leverage=10,
        allocated_margin=100,
        stop_loss_price=98.0,
        source="test",
        meta={
            "take_profit_price": 105.0,
            "stop_loss_price": 98.0,
        },
        qty=5.0,
    )
    assert open_result["ok"] is True

    df = pd.DataFrame(
        [
            {"open": 100.0, "high": 101.0, "low": 99.0, "close": 100.0},
            {"open": 100.0, "high": 101.0, "low": 99.0, "close": 100.0},
        ]
    )

    result = _run_single_symbol_cycle(
        symbol="BTC_USDT",
        config={
            "symbol": "BTC_USDT",
            "trade_mode": "paper",
            "strategy_type": "classic",
            "stop_loss_pct": 0.02,
            "take_profit_pct": 0.05,
        },
        guard={"allowed": True},
        timeframe="15m",
        leverage=50,
        allocated_margin=100,
        risk_per_trade_pct=0.01,
        stop_loss_pct=0.02,
        take_profit_pct=0.05,
        data_source="gate",
        fee_rate=0.00015,
        slippage_rate=0.0001,
        strategy_type="classic",
        broker=broker,
        pre_fetched_data={"df": df, "market_meta": {"actual_source": "gate"}},
    )

    assert result["ok"] is True
    assert result["action"] == "mark"


def test_scheduler_runtime_config_prefers_runner_last_config():
    _reset_tables()
    save_kv(
        "strategy",
        "config",
        {
            "symbol": "BTC_USDT",
            "timeframe": "15m",
            "strategy_type": "classic",
            "leverage": 5,
        },
    )
    save_kv(
        "runner",
        "state",
        {
            **DEFAULT_RUNNER_STATE,
            "enabled": True,
            "trade_mode": "paper",
            "selected_symbols": ["ETH_USDT"],
            "last_config": {
                "symbol": "BTC_USDT",
                "symbols": ["BTC_USDT", "ETH_USDT"],
                "timeframe": "15m",
                "strategy_type": "classic",
                "leverage": 50,
            },
        },
    )

    scheduler_module = importlib.import_module("app.services.scheduler")
    config = scheduler_module._build_runtime_config()

    assert config["leverage"] == 50
    assert config["symbols"] == ["ETH_USDT"]
    assert config["symbol"] == "ETH_USDT"
    assert config["trade_mode"] == "paper"
    assert config["data_source"] == "gate"
