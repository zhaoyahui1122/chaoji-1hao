"""Trade export endpoints — CSV and JSON."""
from __future__ import annotations

import csv
import io
import json
from typing import Literal

from fastapi import APIRouter, Query
from fastapi.responses import StreamingResponse

from app.services.db import get_conn, init_db

router = APIRouter()


@router.get("/trades")
def export_trades(
    mode: Literal["paper", "live"] = "paper",
    fmt: Literal["csv", "json"] = "csv",
):
    """导出交易记录。"""
    init_db()
    with get_conn() as conn:
        rows = conn.execute(
            """
            SELECT created_at, symbol, side, price, qty, event_type, source, meta_json
            FROM paper_orders
            WHERE trade_mode = ?
            ORDER BY id ASC
            """,
            (mode,),
        ).fetchall()

    items = []
    for r in rows:
        meta = {}
        try:
            meta = json.loads(r["meta_json"]) if r["meta_json"] else {}
        except Exception:
            pass
        items.append({
            "time": r["created_at"],
            "symbol": r["symbol"],
            "side": r["side"],
            "event_type": r["event_type"],
            "price": r["price"],
            "qty": r["qty"],
            "source": r["source"],
            "pnl": meta.get("realized_pnl") or meta.get("pnl"),
            "fee": meta.get("entry_fee") or meta.get("total_fees") or meta.get("fee"),
            "execution_price": meta.get("execution_price"),
        })

    if fmt == "json":
        return {"items": items}

    # CSV
    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=["time", "symbol", "side", "event_type", "price", "qty", "source", "pnl", "fee", "execution_price"])
    writer.writeheader()
    writer.writerows(items)
    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=trades_{mode}.csv"},
    )


@router.get("/summary")
def export_summary(mode: Literal["paper", "live"] = "paper"):
    """导出统计摘要。"""
    init_db()
    with get_conn() as conn:
        rows = conn.execute(
            """
            SELECT event_type, meta_json
            FROM paper_orders
            WHERE trade_mode = ? AND event_type = 'close'
            ORDER BY id ASC
            """,
            (mode,),
        ).fetchall()

    pnls = []
    fees = []
    wins = 0
    for r in rows:
        meta = {}
        try:
            meta = json.loads(r["meta_json"]) if r["meta_json"] else {}
        except Exception:
            pass
        pnl = meta.get("realized_pnl") or meta.get("pnl")
        fee = meta.get("total_fees") or meta.get("entry_fee") or 0
        if pnl is not None:
            pnl_val = float(pnl)
            pnls.append(pnl_val)
            if pnl_val > 0:
                wins += 1
        fees.append(float(fee))

    total = len(pnls)
    total_pnl = sum(pnls)
    total_fees = sum(fees)
    max_consecutive_loss = 0
    cur_loss = 0
    for p in pnls:
        if p < 0:
            cur_loss += 1
            max_consecutive_loss = max(max_consecutive_loss, cur_loss)
        else:
            cur_loss = 0

    avg_win = [p for p in pnls if p > 0]
    avg_loss = [abs(p) for p in pnls if p < 0]
    profit_factor = sum(avg_win) / sum(avg_loss) if avg_loss else 0.0

    return {
        "total_trades": total,
        "win_trades": wins,
        "loss_trades": total - wins,
        "win_rate": round(wins / total, 4) if total else 0.0,
        "total_pnl": round(total_pnl, 2),
        "total_fees": round(total_fees, 2),
        "net_pnl": round(total_pnl, 2),
        "profit_factor": round(profit_factor, 2),
        "max_consecutive_losses": max_consecutive_loss,
        "avg_win": round(sum(avg_win) / len(avg_win), 2) if avg_win else 0.0,
        "avg_loss": round(sum(avg_loss) / len(avg_loss), 2) if avg_loss else 0.0,
    }
