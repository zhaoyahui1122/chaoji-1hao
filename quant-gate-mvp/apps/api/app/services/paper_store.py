from __future__ import annotations

import json
from typing import Any

from app.services.db import get_conn, init_db
from app.services.state_store import save_json_state


def _normalize_event_type(status: str | None) -> str:
    if status == "closed":
        return "close"
    if status == "mark":
        return "mark"
    return "open"


def _safe_float(value: Any) -> float | None:
    try:
        if value is None:
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def _positive_ratio(numerator: Any, denominator: Any) -> float | None:
    left = _safe_float(numerator)
    right = _safe_float(denominator)
    if left is None or right is None or right <= 0:
        return None
    return left / right


def _enrich_position_history_row(row: dict[str, Any]) -> dict[str, Any]:
    entry_price = _safe_float(row.get("entry_price")) or 0.0
    qty = _safe_float(row.get("qty")) or 0.0
    leverage = _safe_float(row.get("leverage")) or 0.0
    realized_pnl = row.get("realized_pnl")
    entry_notional = entry_price * qty

    open_meta: dict[str, Any] = {}
    open_meta_json = row.get("open_meta_json")
    if open_meta_json:
        try:
            open_meta = json.loads(open_meta_json)
        except (TypeError, ValueError, json.JSONDecodeError):
            open_meta = {}

    margin_basis = (
        _safe_float(open_meta.get("effective_allocated_margin"))
        or _safe_float(open_meta.get("allocated_margin"))
        or ((entry_notional / leverage) if leverage > 0 else entry_notional)
    )
    entry_fee = _safe_float(row.get("entry_fee")) or _safe_float(open_meta.get("entry_fee")) or 0.0
    total_fees = _safe_float(row.get("cumulative_fees")) or entry_fee
    gross_realized_pnl = None if realized_pnl is None else (float(realized_pnl) + total_fees)

    row["entry_notional"] = entry_notional
    row["margin_basis"] = margin_basis
    row["gross_realized_pnl"] = gross_realized_pnl
    row["total_fees"] = total_fees
    row["pnl_rate_on_notional"] = _positive_ratio(realized_pnl, entry_notional)
    row["pnl_rate_on_margin"] = _positive_ratio(realized_pnl, margin_basis)
    row["gross_pnl_rate_on_notional"] = _positive_ratio(gross_realized_pnl, entry_notional)
    row["gross_pnl_rate_on_margin"] = _positive_ratio(gross_realized_pnl, margin_basis)
    return row


def _build_history_filters(
    *,
    symbol: str | None = None,
    status: str | None = None,
    event_type: str | None = None,
    source: str | None = None,
    start_time: str | None = None,
    end_time: str | None = None,
    time_column: str,
) -> tuple[str, list[Any]]:
    clauses: list[str] = []
    params: list[Any] = []

    if symbol:
        clauses.append("symbol = ?")
        params.append(symbol)
    if status:
        clauses.append("status = ?")
        params.append(status)
    if event_type:
        clauses.append("event_type = ?")
        params.append(event_type)
    if source:
        clauses.append("source = ?")
        params.append(source)
    if start_time:
        clauses.append(f"{time_column} >= ?")
        params.append(start_time)
    if end_time:
        clauses.append(f"{time_column} <= ?")
        params.append(end_time)

    where_sql = f" WHERE {' AND '.join(clauses)}" if clauses else ""
    return where_sql, params


def reset_structured_paper_state(initial_balance: float) -> dict[str, Any]:
    init_db()
    with get_conn() as conn:
        conn.execute("DELETE FROM paper_orders")
        conn.execute("DELETE FROM paper_positions")
        conn.execute("DELETE FROM paper_account_snapshots")
        conn.commit()

    broker_state = {
        "initial_balance": float(initial_balance),
        "realized_pnl": 0.0,
        "positions": [],
        "orders": [],
    }
    save_json_state(broker_state)
    return broker_state


def load_structured_paper_state(default: dict[str, Any]) -> dict[str, Any] | None:
    init_db()
    with get_conn() as conn:
        positions = [dict(row) for row in conn.execute(
            "SELECT position_id, symbol, side, leverage, qty, entry_price, mark_price, fee_rate, slippage_rate, entry_fee, cumulative_fees, entry_slippage_cost, exit_slippage_cost, cumulative_slippage_cost, stop_loss_price, take_profit_price FROM paper_positions WHERE status = 'open' ORDER BY id ASC"
        ).fetchall()]
        latest_snapshot = conn.execute(
            "SELECT initial_balance, realized_pnl FROM paper_account_snapshots ORDER BY id DESC LIMIT 1"
        ).fetchone()

        if positions:
            active_position_ids = {
                row["position_id"]
                for row in positions
                if row.get("position_id")
            }
            orders = [dict(row) for row in conn.execute(
                f"SELECT position_id, symbol, side, price, qty, status, event_type, source, meta_json FROM paper_orders WHERE position_id IN ({', '.join('?' for _ in active_position_ids)}) ORDER BY id ASC",
                tuple(active_position_ids),
            ).fetchall()] if active_position_ids else []
        else:
            orders = []

    if positions:
        return {
            "initial_balance": float(latest_snapshot["initial_balance"]) if latest_snapshot else float(default.get("initial_balance", 10000.0)),
            "realized_pnl": float(latest_snapshot["realized_pnl"]) if latest_snapshot else float(default.get("realized_pnl", 0.0)),
            "positions": positions,
            "orders": orders,
        }

    return None


def replace_structured_paper_state(data: dict[str, Any], account_snapshot: dict[str, Any]) -> None:
    init_db()
    positions = data.get("positions", [])
    active_position_ids = {
        p.get("position_id")
        for p in positions
        if p.get("position_id")
    }

    with get_conn() as conn:
        existing_open_rows = conn.execute(
            "SELECT id, position_id FROM paper_positions WHERE status = 'open' ORDER BY id ASC"
        ).fetchall()
        existing_open_by_position_id = {
            row["position_id"]: int(row["id"])
            for row in existing_open_rows
            if row["position_id"]
        }

        for p in positions:
            existing_row_id = existing_open_by_position_id.get(p.get("position_id"))
            values = (
                p.get("position_id"),
                p["symbol"],
                p["side"],
                int(p["leverage"]),
                float(p["qty"]),
                float(p["entry_price"]),
                float(p["mark_price"]),
                float(p.get("fee_rate", 0.0005)),
                float(p.get("slippage_rate", 0.0002)),
                float(p.get("entry_fee", 0.0)),
                float(p.get("cumulative_fees", p.get("entry_fee", 0.0))),
                float(p.get("entry_slippage_cost", 0.0)),
                float(p.get("exit_slippage_cost", 0.0)),
                float(p.get("cumulative_slippage_cost", p.get("entry_slippage_cost", 0.0))),
                float(p.get("stop_loss_price", 0.0)),
                float(p.get("take_profit_price", 0.0)),
            )
            if existing_row_id is None:
                conn.execute(
                    """
                    INSERT INTO paper_positions(position_id, symbol, side, leverage, qty, entry_price, mark_price, fee_rate, slippage_rate, entry_fee, cumulative_fees, entry_slippage_cost, exit_slippage_cost, cumulative_slippage_cost, stop_loss_price, take_profit_price, status)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open')
                    """,
                    values,
                )
            else:
                conn.execute(
                    """
                    UPDATE paper_positions
                    SET position_id = ?,
                        symbol = ?,
                        side = ?,
                        leverage = ?,
                        qty = ?,
                        entry_price = ?,
                        mark_price = ?,
                        fee_rate = ?,
                        slippage_rate = ?,
                        entry_fee = ?,
                        cumulative_fees = ?,
                        entry_slippage_cost = ?,
                        exit_slippage_cost = ?,
                        cumulative_slippage_cost = ?,
                        stop_loss_price = ?,
                        take_profit_price = ?,
                        status = 'open',
                        closed_at = NULL,
                        close_price = NULL,
                        realized_pnl = NULL
                    WHERE id = ?
                    """,
                    (*values, existing_row_id),
                )

        if active_position_ids:
            placeholders = ", ".join("?" for _ in active_position_ids)
            conn.execute(
                f"DELETE FROM paper_positions WHERE status = 'closed' AND position_id IN ({placeholders})",
                tuple(active_position_ids),
            )

        conn.execute(
            """
            INSERT INTO paper_account_snapshots(
                initial_balance,
                realized_pnl,
                equity,
                available_balance,
                margin_used,
                margin_ratio,
                unrealized_pnl,
                open_positions
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                float(data.get("initial_balance", 10000.0)),
                float(data.get("realized_pnl", 0.0)),
                float(account_snapshot.get("equity", 0.0)),
                float(account_snapshot.get("available_balance", 0.0)),
                float(account_snapshot.get("margin_used", 0.0)),
                float(account_snapshot.get("margin_ratio", 0.0)),
                float(account_snapshot.get("unrealized_pnl", 0.0)),
                int(account_snapshot.get("open_positions", 0)),
            ),
        )
        conn.commit()


def append_order_event(
    symbol: str,
    side: str,
    price: float,
    qty: float,
    status: str,
    event_type: str | None = None,
    position_id: str | None = None,
    source: str = "manual",
    meta: dict[str, Any] | None = None,
) -> None:
    init_db()
    normalized_event_type = event_type or _normalize_event_type(status)
    meta_json = json.dumps(meta, ensure_ascii=False) if meta else None
    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO paper_orders(position_id, symbol, side, price, qty, status, event_type, source, meta_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (position_id, symbol, side, float(price), float(qty), status, normalized_event_type, source, meta_json),
        )
        conn.commit()


def close_structured_position(
    position_id: str,
    price: float,
    pnl: float,
    *,
    cumulative_fees: float | None = None,
    exit_slippage_cost: float | None = None,
    cumulative_slippage_cost: float | None = None,
) -> dict[str, Any] | None:
    init_db()
    with get_conn() as conn:
        row = conn.execute(
            "SELECT id, position_id, symbol, side, qty FROM paper_positions WHERE position_id = ? AND status = 'open' ORDER BY id DESC LIMIT 1",
            (position_id,),
        ).fetchone()
        if row:
            updates = [
                "status = 'closed'",
                "closed_at = CURRENT_TIMESTAMP",
                "close_price = ?",
                "realized_pnl = ?",
            ]
            params: list[Any] = [float(price), float(pnl)]
            if cumulative_fees is not None:
                updates.append("cumulative_fees = ?")
                params.append(float(cumulative_fees))
            if exit_slippage_cost is not None:
                updates.append("exit_slippage_cost = ?")
                params.append(float(exit_slippage_cost))
            if cumulative_slippage_cost is not None:
                updates.append("cumulative_slippage_cost = ?")
                params.append(float(cumulative_slippage_cost))
            params.append(int(row["id"]))
            conn.execute(
                f"""
                UPDATE paper_positions
                SET {', '.join(updates)}
                WHERE id = ?
                """,
                params,
            )
            conn.commit()
            return dict(row)
    return None


def get_equity_curve(limit: int = 200) -> list[dict[str, Any]]:
    init_db()
    with get_conn() as conn:
        rows = conn.execute(
            """
            SELECT id, equity, realized_pnl, unrealized_pnl, margin_used, open_positions, created_at
            FROM paper_account_snapshots
            ORDER BY id DESC
            LIMIT ?
            """,
            (int(limit),),
        ).fetchall()
    items = [dict(row) for row in rows]
    items.reverse()
    return items


def get_order_history(
    limit: int = 200,
    symbol: str | None = None,
    status: str | None = None,
    event_type: str | None = None,
    source: str | None = None,
    start_time: str | None = None,
    end_time: str | None = None,
) -> list[dict[str, Any]]:
    init_db()
    where_sql, params = _build_history_filters(
        symbol=symbol,
        status=status,
        event_type=event_type,
        source=source,
        start_time=start_time,
        end_time=end_time,
        time_column="created_at",
    )
    with get_conn() as conn:
        rows = conn.execute(
            f"""
            SELECT id, position_id, symbol, side, price, qty, status, event_type, source, meta_json, created_at
            FROM paper_orders
            {where_sql}
            ORDER BY id DESC
            LIMIT ?
            """,
            (*params, int(limit)),
        ).fetchall()
    return [dict(row) for row in rows]


def get_position_history(
    limit: int = 200,
    symbol: str | None = None,
    status: str | None = None,
    start_time: str | None = None,
    end_time: str | None = None,
) -> list[dict[str, Any]]:
    init_db()
    where_sql, params = _build_history_filters(
        symbol=symbol,
        status=status,
        start_time=start_time,
        end_time=end_time,
        time_column="opened_at",
    )
    with get_conn() as conn:
        rows = conn.execute(
            f"""
            SELECT p.id, p.position_id, p.symbol, p.side, p.leverage, p.qty, p.entry_price, p.mark_price, p.fee_rate, p.slippage_rate, p.entry_fee, p.cumulative_fees, p.entry_slippage_cost, p.exit_slippage_cost, p.cumulative_slippage_cost, p.stop_loss_price, p.take_profit_price, p.status, p.opened_at, p.closed_at, p.close_price, p.realized_pnl,
                   (
                       SELECT o.meta_json
                       FROM paper_orders o
                       WHERE o.position_id = p.position_id AND o.event_type = 'open'
                       ORDER BY o.id ASC
                       LIMIT 1
                   ) AS open_meta_json
            FROM paper_positions p
            {where_sql}
            ORDER BY p.id DESC
            LIMIT ?
            """,
            (*params, int(limit)),
        ).fetchall()
    return [_enrich_position_history_row(dict(row)) for row in rows]


def get_history_stats() -> dict[str, Any]:
    positions = get_position_history(limit=5000)
    equity_curve = get_equity_curve(limit=5000)

    closed_positions = [p for p in positions if p.get("status") == "closed" and p.get("realized_pnl") is not None]
    total_trades = len(closed_positions)
    wins = [p for p in closed_positions if float(p.get("realized_pnl") or 0) > 0]
    losses = [p for p in closed_positions if float(p.get("realized_pnl") or 0) < 0]

    total_fees = sum(float(p.get("cumulative_fees") or 0) for p in closed_positions)
    total_slippage_cost = sum(float(p.get("cumulative_slippage_cost") or 0) for p in closed_positions)
    total_net_realized_pnl = sum(float(p.get("realized_pnl") or 0) for p in closed_positions)
    total_gross_realized_pnl = total_net_realized_pnl + total_fees
    avg_pnl = total_net_realized_pnl / total_trades if total_trades else 0.0
    avg_fee = total_fees / total_trades if total_trades else 0.0
    avg_slippage_cost = total_slippage_cost / total_trades if total_trades else 0.0
    win_rate = len(wins) / total_trades if total_trades else 0.0
    max_profit = max((float(p.get("realized_pnl") or 0) for p in closed_positions), default=0.0)
    max_loss = min((float(p.get("realized_pnl") or 0) for p in closed_positions), default=0.0)

    peak = None
    max_drawdown = 0.0
    for point in equity_curve:
        equity = float(point.get("equity") or 0)
        if peak is None or equity > peak:
            peak = equity
        if peak and peak > 0:
            drawdown = (peak - equity) / peak
            if drawdown > max_drawdown:
                max_drawdown = drawdown

    return {
        "total_trades": total_trades,
        "win_trades": len(wins),
        "loss_trades": len(losses),
        "win_rate": win_rate,
        "gross_pnl": total_gross_realized_pnl,
        "fees": total_fees,
        "slippage_cost": total_slippage_cost,
        "net_pnl": total_net_realized_pnl,
        "avg_pnl_per_trade": avg_pnl,
        "avg_fee_per_trade": avg_fee,
        "avg_slippage_cost_per_trade": avg_slippage_cost,
        "max_profit_trade": max_profit,
        "max_loss_trade": max_loss,
        "max_drawdown_ratio": max_drawdown,
        "equity_points": len(equity_curve),
        "total_gross_realized_pnl": total_gross_realized_pnl,
        "total_fees": total_fees,
        "total_slippage_cost": total_slippage_cost,
        "total_realized_pnl": total_net_realized_pnl,
    }
