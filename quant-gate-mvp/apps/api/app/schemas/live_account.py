from pydantic import BaseModel
from typing import Literal


PositionSide = Literal["long", "short"]


class LiveAccountOverview(BaseModel):
    equity: float
    available_balance: float
    margin_used: float
    unrealized_pnl: float


class LiveAccountPosition(BaseModel):
    symbol: str
    side: PositionSide
    leverage: int
    size: float
    entry_price: float
    mark_price: float
    unrealized_pnl: float


class LiveAccountStatusResponse(BaseModel):
    connected: bool
    has_credentials: bool
    last_sync_at: str | None
    last_error: str | None
    account: LiveAccountOverview | None
    positions: list[LiveAccountPosition]
    source: str = "gate_futures_live"


class LiveAccountConnectRequest(BaseModel):
    api_key: str
    api_secret: str
