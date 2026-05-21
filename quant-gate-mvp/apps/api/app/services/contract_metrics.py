from typing import Any

from app.schemas.contracts import PositionMetrics, AccountOverview
from app.services.db import get_conn, init_db

MAINTENANCE_MARGIN_RATIO = 0.005


# ---- 回撤追踪 ----

def update_equity_peak(equity: float) -> dict[str, Any]:
    """更新权益峰值，计算当前回撤和最大回撤，返回回撤信息。"""
    init_db()
    with get_conn() as conn:
        row = conn.execute("SELECT peak_equity, max_drawdown_pct FROM drawdown_tracker WHERE id = 1").fetchone()
        if row is None:
            conn.execute("INSERT INTO drawdown_tracker(id, peak_equity, max_drawdown_pct, peak_date) VALUES (1, ?, 0, CURRENT_TIMESTAMP)", (equity,))
            conn.commit()
            return {"peak_equity": equity, "current_drawdown_pct": 0.0, "max_drawdown_pct": 0.0, "peak_date": None}

        peak = row["peak_equity"]
        max_dd = row["max_drawdown_pct"]
        if equity > peak:
            conn.execute("UPDATE drawdown_tracker SET peak_equity = ?, peak_date = CURRENT_TIMESTAMP WHERE id = 1", (equity,))
            peak = equity
        current_dd = (peak - equity) / peak if peak > 0 else 0.0
        if current_dd > max_dd:
            max_dd = current_dd
            conn.execute("UPDATE drawdown_tracker SET max_drawdown_pct = ? WHERE id = 1", (max_dd,))
        conn.commit()
        peak_row = conn.execute("SELECT peak_date FROM drawdown_tracker WHERE id = 1").fetchone()
    return {
        "peak_equity": round(peak, 2),
        "current_drawdown_pct": round(current_dd, 6),
        "max_drawdown_pct": round(max_dd, 6),
        "peak_date": peak_row["peak_date"] if peak_row else None,
    }


def calc_unrealized_pnl(side: str, entry_price: float, mark_price: float, qty: float) -> float:
    if side == "long":
        return (mark_price - entry_price) * qty
    return (entry_price - mark_price) * qty


def calc_notional(mark_price: float, qty: float) -> float:
    return mark_price * qty


def calc_margin_used(notional: float, leverage: int) -> float:
    if leverage <= 0:
        return notional
    return notional / leverage


def calc_margin_ratio(margin_used: float, equity: float) -> float:
    if equity <= 0:
        return 1.0
    return margin_used / equity


def calc_pnl_return_ratio(unrealized_pnl: float, margin_used: float) -> float:
    if margin_used <= 0:
        return 0.0
    return unrealized_pnl / margin_used


def calc_liquidation_distance_ratio(mark_price: float, liquidation_price: float) -> float:
    if mark_price <= 0:
        return 0.0
    return abs(mark_price - liquidation_price) / mark_price


def estimate_liquidation_price(side: str, entry_price: float, leverage: int, maintenance_margin_ratio: float = MAINTENANCE_MARGIN_RATIO) -> float:
    if leverage <= 0:
        return entry_price
    if side == "long":
        estimated = entry_price * (1 - (1 / leverage) + maintenance_margin_ratio)
        return max(0.0, estimated)
    estimated = entry_price * (1 + (1 / leverage) - maintenance_margin_ratio)
    return max(0.0, estimated)


def build_position_metrics(symbol: str, side: str, leverage: int, qty: float, entry_price: float, mark_price: float, equity: float) -> PositionMetrics:
    notional = calc_notional(mark_price, qty)
    initial_margin = calc_margin_used(notional, leverage)
    maintenance_margin = notional * MAINTENANCE_MARGIN_RATIO
    unrealized_pnl = calc_unrealized_pnl(side, entry_price, mark_price, qty)
    pnl_return_ratio = calc_pnl_return_ratio(unrealized_pnl, initial_margin)
    margin_ratio = calc_margin_ratio(initial_margin, equity)
    liquidation_price = estimate_liquidation_price(side, entry_price, leverage)
    liquidation_distance_ratio = calc_liquidation_distance_ratio(mark_price, liquidation_price)
    return PositionMetrics(
        symbol=symbol,
        side=side,
        leverage=leverage,
        qty=qty,
        entry_price=entry_price,
        mark_price=mark_price,
        notional=notional,
        initial_margin=initial_margin,
        margin_used=initial_margin,
        maintenance_margin=maintenance_margin,
        unrealized_pnl=unrealized_pnl,
        pnl_return_ratio=pnl_return_ratio,
        margin_ratio=margin_ratio,
        liquidation_price=liquidation_price,
        liquidation_distance_ratio=liquidation_distance_ratio,
    )


def build_account_overview(equity: float, positions: list[PositionMetrics], realized_pnl: float = 0.0) -> AccountOverview:
    margin_used = sum(p.margin_used for p in positions)
    total_notional = sum(p.notional for p in positions)
    unrealized_pnl = sum(p.unrealized_pnl for p in positions)
    available_balance = equity - margin_used
    margin_ratio = calc_margin_ratio(margin_used, equity)
    exposure_ratio = calc_margin_ratio(total_notional, equity)
    dd = update_equity_peak(equity)
    return AccountOverview(
        equity=equity,
        available_balance=available_balance,
        margin_used=margin_used,
        unrealized_pnl=unrealized_pnl,
        realized_pnl=realized_pnl,
        open_positions=len(positions),
        total_notional=total_notional,
        exposure_ratio=exposure_ratio,
        margin_ratio=margin_ratio,
        max_drawdown_pct=dd["max_drawdown_pct"],
        current_drawdown_pct=dd["current_drawdown_pct"],
        peak_equity=dd["peak_equity"],
    )
