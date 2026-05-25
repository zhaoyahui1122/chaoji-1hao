from fastapi import APIRouter, Query
from pydantic import BaseModel

from app.services.paper_store import get_equity_curve, get_history_stats, get_order_history, get_position_history

router = APIRouter()


class HistoryPositionResponse(BaseModel):
    id: int
    position_id: str | None = None
    symbol: str
    side: str
    leverage: int
    qty: float
    entry_price: float
    mark_price: float
    fee_rate: float | None = None
    slippage_rate: float | None = None
    entry_fee: float | None = None
    cumulative_fees: float | None = None
    entry_slippage_cost: float | None = None
    exit_slippage_cost: float | None = None
    cumulative_slippage_cost: float | None = None
    open_meta_json: str | None = None
    status: str
    opened_at: str
    closed_at: str | None = None
    close_price: float | None = None
    realized_pnl: float | None = None
    gross_realized_pnl: float | None = None
    total_fees: float | None = None
    entry_notional: float | None = None
    margin_basis: float | None = None
    pnl_rate_on_notional: float | None = None
    pnl_rate_on_margin: float | None = None
    gross_pnl_rate_on_notional: float | None = None
    gross_pnl_rate_on_margin: float | None = None


class PositionHistoryResponse(BaseModel):
    items: list[HistoryPositionResponse]
    count: int
    filters: dict[str, str | None]


class HistoryStatsResponse(BaseModel):
    total_trades: int
    win_trades: int
    loss_trades: int
    win_rate: float
    gross_pnl: float
    fees: float
    slippage_cost: float
    net_pnl: float
    avg_pnl_per_trade: float
    avg_fee_per_trade: float
    total_slippage_cost: float
    avg_slippage_cost_per_trade: float
    max_profit_trade: float
    max_loss_trade: float
    max_drawdown_ratio: float
    equity_points: int
    total_gross_realized_pnl: float
    total_fees: float
    total_realized_pnl: float


@router.get('/equity-curve')
def equity_curve(limit: int = Query(default=100, ge=1, le=1000), trade_mode: str | None = Query(default=None)):
    items = get_equity_curve(limit=limit, trade_mode=trade_mode)
    return {
        'items': items,
        'count': len(items),
    }


@router.get('/orders')
def order_history(
    limit: int = Query(default=200, ge=1, le=1000),
    symbol: str | None = Query(default=None),
    status: str | None = Query(default=None),
    event_type: str | None = Query(default=None),
    source: str | None = Query(default=None),
    start_time: str | None = Query(default=None),
    end_time: str | None = Query(default=None),
    trade_mode: str | None = Query(default=None),
):
    items = get_order_history(
        limit=limit, symbol=symbol, status=status,
        event_type=event_type, source=source,
        start_time=start_time, end_time=end_time,
        trade_mode=trade_mode,
    )
    return {
        'items': items,
        'count': len(items),
        'filters': {
            'symbol': symbol,
            'status': status,
            'event_type': event_type,
            'source': source,
            'start_time': start_time,
            'end_time': end_time,
            'trade_mode': trade_mode,
        },
    }


@router.get('/positions', response_model=PositionHistoryResponse)
def position_history(
    limit: int = Query(default=100, ge=1, le=1000),
    symbol: str | None = Query(default=None),
    status: str | None = Query(default=None),
    start_time: str | None = Query(default=None),
    end_time: str | None = Query(default=None),
    trade_mode: str | None = Query(default=None),
):
    items = get_position_history(limit=limit, symbol=symbol, status=status, start_time=start_time, end_time=end_time, trade_mode=trade_mode)
    return {
        'items': items,
        'count': len(items),
        'filters': {
            'symbol': symbol,
            'status': status,
            'start_time': start_time,
            'end_time': end_time,
            'trade_mode': trade_mode,
        },
    }


@router.get('/stats', response_model=HistoryStatsResponse)
def history_stats(trade_mode: str | None = Query(default=None)):
    return get_history_stats(trade_mode=trade_mode)
