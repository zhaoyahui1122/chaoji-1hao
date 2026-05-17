from pydantic import BaseModel
from typing import Literal


PositionSide = Literal["long", "short"]


class PositionMetrics(BaseModel):
    symbol: str
    side: PositionSide
    leverage: int
    qty: float
    entry_price: float
    mark_price: float
    notional: float
    initial_margin: float
    margin_used: float
    maintenance_margin: float
    unrealized_pnl: float
    pnl_return_ratio: float
    margin_ratio: float
    liquidation_price: float
    liquidation_distance_ratio: float


class AccountOverview(BaseModel):
    equity: float
    available_balance: float
    margin_used: float
    unrealized_pnl: float
    realized_pnl: float
    open_positions: int
    total_notional: float
    exposure_ratio: float
    margin_ratio: float
