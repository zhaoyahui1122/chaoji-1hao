# Live Mark No-Order Persistence Design

## Goal
Stop the scheduler's live mark observer from appending `mark` rows into `paper_orders`, while keeping open-position `mark_price` refresh behavior intact for `/dashboard` and `/history/positions`.

## Current behavior
- `apps/api/app/services/scheduler.py` refreshes live marks for open positions roughly every 3 seconds.
- That path currently calls `PAPER_BROKER.update_mark_price(...)` with the default `persist=True`.
- `apps/api/app/paper/broker.py` treats `persist=True` as "append a `paper_orders` mark event and persist broker state".
- As a result, `history/orders` is flooded with high-frequency `event_type="mark"` rows from scheduler-driven refreshes.

## Decision
Only disable persistence for the scheduler's `refresh_mode="live_mark"` path.

We will keep the broker API generic and unchanged: `update_mark_price()` continues to support persisted mark events for callers that explicitly want them. The scheduler will opt out by passing `persist=False`.

## Why this approach
1. Smallest behavioral change.
2. Clear ownership boundary: scheduler decides whether its observer writes order history.
3. Avoids baking scheduler-specific policy into the broker or storage layer.
4. Matches an existing pattern already used in `apps/api/app/services/strategy_runner.py`, where mark refreshes on existing positions already call `update_mark_price(..., persist=False)`.

## Files to change
- Modify: `apps/api/app/services/scheduler.py`
- Modify: `apps/api/test_runtime_source_of_truth.py`

## Detailed design
### 1. Scheduler change
In `apps/api/app/services/scheduler.py`, update the live mark refresh call so that:
- `PAPER_BROKER.update_mark_price(...)` is invoked with `persist=False`
- existing `source="runner"` and `meta.refresh_mode="live_mark"` remain unchanged for observability

Expected result:
- in-memory broker positions still receive the newest `mark_price`
- downstream broker state persistence still reflects updated open-position marks through normal broker persistence behavior
- no `paper_orders` row is inserted for scheduler-driven live mark refreshes

### 2. Broker behavior stays generic
`apps/api/app/paper/broker.py` should not gain scheduler-specific conditionals.

`update_mark_price()` will keep its current contract:
- `persist=True`: may append a `mark` order event and persist state
- `persist=False`: update runtime position marks without writing a `paper_orders` mark event

This keeps manual/debug callers free to persist mark events when desired.

### 3. Test coverage
Add or extend tests in `apps/api/test_runtime_source_of_truth.py` to cover three guarantees:

#### A. Scheduler live mark refresh does not append mark orders
Set up an open position, trigger the scheduler live mark path, then verify:
- the open position's `mark_price` changes
- no additional `paper_orders` rows with `event_type="mark"` are created by that path

#### B. Existing open/close order history remains intact
Verify that disabling scheduler mark persistence does not affect normal trading history:
- open events are still persisted as `event_type="open"`
- close events are still persisted as `event_type="close"`
- no regression changes the expected order history for non-scheduler trade events

#### C. Shared runtime views still reflect mark refreshes
Verify that after the non-persisted live mark refresh:
- `/dashboard` shows the refreshed open position `mark_price`
- `/history/positions` shows the same refreshed `mark_price`

This confirms that removing order-history writes does not regress runtime-state alignment.

### 4. Observability and debugging contract
After this change, live mark health should be verified through runtime state, not order history.

Primary observation points:
- `/runner/status` fields such as `last_live_mark_refresh_at`, `last_live_mark_prices`, and `last_live_mark_error`
- `/dashboard` open positions
- `/history/positions` open positions

Explicit debugging rule:
- do not use `/history/orders` growth as the signal that live mark refresh is working
- use runner status freshness plus open-position `mark_price` updates as the source of truth


## Non-goals
- Do not change manual mark update behavior.
- Do not add throttling, deduplication, or thresholds for mark persistence.
- Do not change `history/orders` response filtering.
- Do not redesign `update_mark_price()` semantics beyond using the existing `persist` flag correctly.

## Risks and mitigations
- Risk: a view might rely on `paper_orders` mark rows for fresh pricing.
  - Mitigation: explicit regression test for `/dashboard` and `/history/positions` refreshed mark values.
- Risk: scheduler refresh updates only memory but not durable open-position state.
  - Mitigation: verify the actual read path after refresh rather than only asserting method calls.

## Acceptance criteria
1. Scheduler-driven live mark refresh no longer creates new `paper_orders.event_type = "mark"` rows.
2. `/dashboard` still shows refreshed open-position prices.
3. `/history/positions` still shows the same refreshed open-position prices.
4. Existing non-scheduler `update_mark_price(..., persist=True)` behavior remains unchanged.
