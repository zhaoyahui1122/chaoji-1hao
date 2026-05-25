# Paper Trading Runtime Source Unification Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make `state/quant_gate.db` the single source of truth for paper trading positions, orders, and history so dashboard, history, and runner all read the same state.

**Architecture:** Keep the live broker as the in-memory executor, but make its persistence layer write only to the SQLite state store. Load broker runtime state from SQLite on startup, derive dashboard/history from SQLite-backed broker snapshots, and treat runner JSON/KV files as compatibility caches only until they can be removed.

**Tech Stack:** Python, FastAPI, SQLite, pytest

---

### Task 1: Prove the current split with tests

**Files:**
- Create: `apps/api/tests/test_runtime_source_of_truth.py`

**Step 1: Write the failing test**

```python
from app.core.state import PAPER_BROKER
from app.services.paper_store import load_structured_paper_state


def test_broker_loads_open_positions_from_sqlite_only():
    state = load_structured_paper_state({"initial_balance": 10000.0, "realized_pnl": 0.0, "positions": [], "orders": []})
    assert state is not None
    assert all(pos.get("position_id") for pos in state["positions"])
    assert all(order.get("position_id") in {p["position_id"] for p in state["positions"]} for order in state["orders"])
```

**Step 2: Run test to verify it fails**

Run: `pytest apps/api/tests/test_runtime_source_of_truth.py::test_broker_loads_open_positions_from_sqlite_only -v`
Expected: FAIL until the broker/persistence contract is tightened and test fixtures are added.

**Step 3: Write minimal implementation**

No code yet; this task is just to pin the contract with a test.

**Step 4: Run test to verify it passes**

Run: `pytest apps/api/tests/test_runtime_source_of_truth.py::test_broker_loads_open_positions_from_sqlite_only -v`
Expected: PASS after the persistence contract is stable.

**Step 5: Commit**

```bash
git add apps/api/tests/test_runtime_source_of_truth.py
git commit -m "test: pin runtime source of truth contract"
```

### Task 2: Make broker restore and persist only SQLite-backed state

**Files:**
- Modify: `apps/api/app/paper/broker.py:81-119`
- Modify: `apps/api/app/services/paper_store.py:124-239`
- Modify: `apps/api/app/services/runner_state_store.py:42-56`

**Step 1: Write the failing test**

Add tests that instantiate `PaperBroker` from a controlled SQLite state and assert:
- open positions are restored from `paper_positions WHERE status='open'`
- `orders` only includes rows for those open positions
- closing/opening a position updates SQLite and the in-memory broker together

**Step 2: Run test to verify it fails**

Run: `pytest apps/api/tests/test_runtime_source_of_truth.py -v`
Expected: FAIL because the broker currently still hydrates from mixed JSON/KV paths and snapshots can drift.

**Step 3: Write minimal implementation**

- In `_restore`, load only from `load_structured_paper_state(...)`.
- Remove JSON fallback from broker state restoration.
- Keep `save_json_state(...)` only as a compatibility cache if needed, but do not let it source truth.
- Make `load_runner_state()` prefer SQLite KV and fall back to `runner_state.json` only when KV is empty.
- Make `save_runner_state()` continue writing both stores for now, but the API should read KV first.

**Step 4: Run test to verify it passes**

Run: `pytest apps/api/tests/test_runtime_source_of_truth.py -v`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/api/app/paper/broker.py apps/api/app/services/paper_store.py apps/api/app/services/runner_state_store.py apps/api/tests/test_runtime_source_of_truth.py
git commit -m "fix: source broker state from sqlite"
```

### Task 3: Make dashboard and history read the same state model

**Files:**
- Modify: `apps/api/app/api/routes_dashboard.py:10-20`
- Modify: `apps/api/app/api/routes_history.py:1-126`
- Modify: `apps/api/app/paper/broker.py:121-146`

**Step 1: Write the failing test**

Add endpoint tests that assert:
- `/dashboard.positions` matches the current open positions from SQLite
- `/dashboard.orders` only contains orders for the active lifecycle
- `/history/positions` and `/history/stats` continue to reflect the SQLite tables exactly

**Step 2: Run test to verify it fails**

Run: `pytest apps/api/tests/test_runtime_source_of_truth.py -v`
Expected: FAIL because dashboard still exposes the broker’s full in-memory order list.

**Step 3: Write minimal implementation**

- Change `PaperBroker.snapshot()` so `orders` is filtered to active open position IDs only.
- Keep `positions` derived from the current in-memory open positions.
- Leave history endpoints on SQLite-backed `paper_store`.
- Keep `dashboard` as a composition of one broker snapshot plus runner status, not a separate source.

**Step 4: Run test to verify it passes**

Run: `pytest apps/api/tests/test_runtime_source_of_truth.py -v`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/api/app/api/routes_dashboard.py apps/api/app/api/routes_history.py apps/api/app/paper/broker.py apps/api/tests/test_runtime_source_of_truth.py
git commit -m "fix: align dashboard and history state"
```

### Task 4: Remove runner state ambiguity

**Files:**
- Modify: `apps/api/app/services/strategy_runner.py:169-232`
- Modify: `apps/api/app/services/scheduler.py:27-158`
- Modify: `apps/api/app/services/runner_state_store.py:42-56`

**Step 1: Write the failing test**

Add a test that proves runner status comes from one store path and does not flip between JSON and KV data during startup.

**Step 2: Run test to verify it fails**

Run: `pytest apps/api/tests/test_runtime_source_of_truth.py -v`
Expected: FAIL until runner reads one canonical source for runtime state.

**Step 3: Write minimal implementation**

- Make `runner/state` in KV the read path used by status and scheduler.
- Keep JSON file writes as compatibility output only.
- Ensure `set_runner_enabled()` and `resume_runner()` update the same canonical state path.
- If the JSON file is still needed, treat it as an export, not input.

**Step 4: Run test to verify it passes**

Run: `pytest apps/api/tests/test_runtime_source_of_truth.py -v`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/api/app/services/strategy_runner.py apps/api/app/services/scheduler.py apps/api/app/services/runner_state_store.py apps/api/tests/test_runtime_source_of_truth.py
git commit -m "fix: unify runner runtime state"
```

### Task 5: Verify the end-to-end runtime with the live app

**Files:**
- No code changes expected unless the checks reveal a regression

**Step 1: Run the API tests**

Run: `pytest apps/api/tests/test_runtime_source_of_truth.py -v`
Expected: PASS.

**Step 2: Restart the API**

Run: `powershell -ExecutionPolicy Bypass -File .\start-api.ps1`
Expected: API starts on `127.0.0.1:8012`.

**Step 3: Verify the live endpoints**

Run:
- `python` script to GET `/dashboard`, `/history/positions`, `/history/stats`, `/runner/status`
- confirm the same open `position_id`s appear everywhere
- confirm no closed rows with null `close_price` or `realized_pnl`
- confirm `runner.selected_symbols` matches `runner.last_config.symbols`

**Step 4: If anything regresses, fix the smallest violating layer**

Expected: no regressions.

**Step 5: Commit**

```bash
git add apps/api/app/* apps/api/tests/test_runtime_source_of_truth.py
git commit -m "fix: unify paper trading runtime truth"
```
