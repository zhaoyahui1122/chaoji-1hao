# Live Mark No-Order Persistence Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Stop scheduler-driven live mark refreshes from appending `mark` rows into `paper_orders` while preserving refreshed `mark_price` values in runtime-facing views.

**Architecture:** Keep `PaperBroker.update_mark_price()` generic and unchanged, and make the scheduler opt out of order-history persistence by passing `persist=False` only for the `refresh_mode="live_mark"` path. Verify behavior with focused runtime-source-of-truth tests that prove scheduler live marks stop writing order history, normal open/close persistence still works, and `/dashboard` plus `/history/positions` still show refreshed mark prices.

**Tech Stack:** Python 3.12, FastAPI, pytest, SQLite-backed paper trading state

---

### Task 1: Make scheduler live mark refresh stop writing order history

**Files:**
- Modify: `apps/api/app/services/scheduler.py:68-79`
- Test: `apps/api/test_runtime_source_of_truth.py`

**Step 1: Write the failing test**

Add a new test in `apps/api/test_runtime_source_of_truth.py` near the runtime-source-of-truth coverage:

```python
def test_scheduler_live_mark_refresh_updates_positions_without_mark_orders(monkeypatch):
    _reset_tables()
    save_kv(
        "runner",
        "state",
        {
            **DEFAULT_RUNNER_STATE,
            "enabled": True,
            "selected_symbols": ["BTC_USDT"],
            "last_config": {"symbols": ["BTC_USDT"]},
            "last_mark_refresh_at": 0,
        },
    )

    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO paper_positions(
                position_id, symbol, side, leverage, qty, entry_price, mark_price,
                fee_rate, slippage_rate, entry_fee, cumulative_fees,
                entry_slippage_cost, exit_slippage_cost, cumulative_slippage_cost, status
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open')
            """,
            ("scheduler-open", "BTC_USDT", "long", 10, 1.0, 100.0, 101.0, 0.0005, 0.0002, 1.0, 1.0, 0.0, 0.0, 0.0),
        )
        conn.execute(
            """
            INSERT INTO paper_orders(position_id, symbol, side, price, qty, status, event_type, source, meta_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            ("scheduler-open", "BTC_USDT", "long", 100.0, 1.0, "filled", "open", "sqlite", json.dumps({"kind": "open"})),
        )
        conn.commit()

    scheduler_module = importlib.import_module("app.services.scheduler")
    broker = _reload_broker_state()
    assert broker.positions[0].position_id == "scheduler-open"

    monkeypatch.setattr(
        scheduler_module,
        "fetch_gate_futures_ticker",
        lambda symbol: {"mark_price": 123.45, "last_price": 123.40, "index_price": 123.50},
    )

    refreshed = scheduler_module._refresh_open_position_marks()

    assert refreshed == {"BTC_USDT": 123.45}

    with get_conn() as conn:
        order_rows = conn.execute(
            "SELECT event_type FROM paper_orders WHERE position_id = ? ORDER BY id ASC",
            ("scheduler-open",),
        ).fetchall()
        assert [row["event_type"] for row in order_rows] == ["open"]
```

**Step 2: Run test to verify it fails**

Run:
```bash
python -m pytest apps/api/test_runtime_source_of_truth.py::test_scheduler_live_mark_refresh_updates_positions_without_mark_orders -v
```

Expected: FAIL because the current scheduler path still writes a `mark` row into `paper_orders`.

**Step 3: Write minimal implementation**

Change the scheduler live mark refresh call in `apps/api/app/services/scheduler.py` from:

```python
        PAPER_BROKER.update_mark_price(
            symbol,
            mark_price,
            source="runner",
            meta={
                "runner": True,
                "refresh_mode": "live_mark",
                "mark_price": mark_price,
                "ticker_last_price": ticker.get("last_price"),
                "ticker_index_price": ticker.get("index_price"),
            },
        )
```

to:

```python
        PAPER_BROKER.update_mark_price(
            symbol,
            mark_price,
            source="runner",
            meta={
                "runner": True,
                "refresh_mode": "live_mark",
                "mark_price": mark_price,
                "ticker_last_price": ticker.get("last_price"),
                "ticker_index_price": ticker.get("index_price"),
            },
            persist=False,
        )
```

**Step 4: Run test to verify it passes**

Run:
```bash
python -m pytest apps/api/test_runtime_source_of_truth.py::test_scheduler_live_mark_refresh_updates_positions_without_mark_orders -v
```

Expected: PASS.

**Step 5: Commit**

```bash
git add apps/api/app/services/scheduler.py apps/api/test_runtime_source_of_truth.py
git commit -m "fix: stop persisting scheduler live mark orders"
```

### Task 2: Prove runtime views still show refreshed mark prices

**Files:**
- Modify: `apps/api/test_runtime_source_of_truth.py:182-243`
- Test: `apps/api/test_runtime_source_of_truth.py`

**Step 1: Write the failing test**

Add a focused integration-style test in `apps/api/test_runtime_source_of_truth.py`:

```python
def test_non_persisted_live_mark_refresh_updates_dashboard_and_history(monkeypatch):
    _reset_tables()
    save_kv(
        "runner",
        "state",
        {
            **DEFAULT_RUNNER_STATE,
            "enabled": True,
            "selected_symbols": ["BTC_USDT"],
            "last_config": {"symbols": ["BTC_USDT"]},
            "last_mark_refresh_at": 0,
        },
    )

    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO paper_positions(
                position_id, symbol, side, leverage, qty, entry_price, mark_price,
                fee_rate, slippage_rate, entry_fee, cumulative_fees,
                entry_slippage_cost, exit_slippage_cost, cumulative_slippage_cost, status
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open')
            """,
            ("view-open", "BTC_USDT", "long", 10, 1.0, 100.0, 101.0, 0.0005, 0.0002, 1.0, 1.0, 0.0, 0.0, 0.0),
        )
        conn.execute(
            """
            INSERT INTO paper_orders(position_id, symbol, side, price, qty, status, event_type, source, meta_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            ("view-open", "BTC_USDT", "long", 100.0, 1.0, "filled", "open", "sqlite", json.dumps({"kind": "open"})),
        )
        conn.execute(
            """
            INSERT INTO paper_account_snapshots(initial_balance, realized_pnl, equity, available_balance, margin_used, margin_ratio, unrealized_pnl, open_positions)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (10000.0, 0.0, 10000.0, 9900.0, 100.0, 0.01, 0.0, 1),
        )
        conn.commit()

    scheduler_module, _, main_module = _reload_runtime_modules()
    monkeypatch.setattr(
        scheduler_module,
        "fetch_gate_futures_ticker",
        lambda symbol: {"mark_price": 123.45, "last_price": 123.40, "index_price": 123.50},
    )

    scheduler_module._refresh_open_position_marks()
    client = TestClient(main_module.app)

    dashboard = client.get("/dashboard").json()
    positions_history = client.get("/history/positions?status=open").json()

    assert dashboard["positions"][0]["position_id"] == "view-open"
    assert dashboard["positions"][0]["mark_price"] == 123.45
    assert positions_history["items"][0]["position_id"] == "view-open"
    assert positions_history["items"][0]["mark_price"] == 123.45
```

**Step 2: Run test to verify it fails**

Run:
```bash
python -m pytest apps/api/test_runtime_source_of_truth.py::test_non_persisted_live_mark_refresh_updates_dashboard_and_history -v
```

Expected: If the runtime read path still depends on persisted `mark` orders, this test fails; otherwise it may already pass once Task 1 is in place. If it already passes, keep the test as regression coverage and move on.

**Step 3: Write minimal implementation**

If the test fails, make the smallest change needed so runtime views read the refreshed `mark_price` from the shared runtime/source-of-truth path rather than from `paper_orders` mark rows.

Expected target behavior after implementation:

```python
assert dashboard["positions"][0]["mark_price"] == 123.45
assert positions_history["items"][0]["mark_price"] == 123.45
```

Do not add any new persistence for scheduler mark events.

**Step 4: Run test to verify it passes**

Run:
```bash
python -m pytest apps/api/test_runtime_source_of_truth.py::test_non_persisted_live_mark_refresh_updates_dashboard_and_history -v
```

Expected: PASS.

**Step 5: Commit**

```bash
git add apps/api/test_runtime_source_of_truth.py
git commit -m "test: cover non-persisted live mark refresh views"
```

### Task 3: Re-run open/close persistence regression coverage

**Files:**
- Test: `apps/api/test_runtime_source_of_truth.py:142-179`

**Step 1: Reuse the existing open/close regression test**

Use the existing test:

```python
def test_broker_persists_open_and_close_to_sqlite_only():
    ...
```

This test already asserts:

```python
assert [dict(row) for row in order_rows] == [{"position_id": position_id, "event_type": "open"}]
...
assert [dict(row) for row in order_rows] == [
    {"position_id": position_id, "event_type": "open"},
    {"position_id": position_id, "event_type": "close"},
]
```

**Step 2: Run regression tests**

Run:
```bash
python -m pytest \
  apps/api/test_runtime_source_of_truth.py::test_broker_persists_open_and_close_to_sqlite_only \
  apps/api/test_runtime_source_of_truth.py::test_scheduler_live_mark_refresh_updates_positions_without_mark_orders \
  apps/api/test_runtime_source_of_truth.py::test_non_persisted_live_mark_refresh_updates_dashboard_and_history -v
```

Expected: All selected tests PASS.

**Step 3: Run the broader test file**

Run:
```bash
python -m pytest apps/api/test_runtime_source_of_truth.py -v
```

Expected: PASS for the full runtime source-of-truth test module.

**Step 4: Verify the debugging contract manually**

Run the local API and inspect these endpoints after opening a paper position:

```bash
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\Users\14513\.openclaw\workspace\quant-gate-mvp\start-api.ps1"
```

Then verify:
- `GET http://127.0.0.1:8012/runner/status` shows fresh `last_live_mark_refresh_at`, `last_live_mark_prices`, and no unexpected `last_live_mark_error`
- `GET http://127.0.0.1:8012/dashboard` shows refreshed open-position `mark_price`
- `GET http://127.0.0.1:8012/history/positions?status=open` shows the same refreshed `mark_price`
- `GET http://127.0.0.1:8012/history/orders?limit=20` no longer grows with scheduler-driven `event_type="mark"` rows

**Step 5: Commit**

```bash
git add apps/api/test_runtime_source_of_truth.py
git commit -m "test: lock live mark observability contract"
```
