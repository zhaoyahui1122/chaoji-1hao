from pydantic import BaseModel, Field
from typing import Literal

Timeframe = Literal["5m", "15m", "30m", "1h", "4h"]
Symbol = Literal["BTC_USDT", "ETH_USDT"]


class AppSettings(BaseModel):
    default_symbol: Symbol = "BTC_USDT"
    default_timeframe: Timeframe = "15m"
    default_leverage: int = Field(default=5, ge=1, le=100)
    initial_balance: float = Field(default=10000, gt=0)
    default_allocated_margin: float = Field(default=1000, gt=0)
    default_fee_rate: float = Field(default=0.00015, ge=0, le=0.01)
    default_slippage_rate: float = Field(default=0.0001, ge=0, le=0.01)
    max_loss_ratio: float = Field(default=0.02, gt=0, le=0.2)
    margin_limit_ratio: float = Field(default=0.2, gt=0, le=1.0)
    max_consecutive_losses: int = Field(default=3, ge=1, le=20)
    max_daily_loss_ratio: float = Field(default=0.05, gt=0, le=0.5)
    max_total_exposure_ratio: float = Field(default=3.0, gt=0, le=20.0)


SETTINGS = AppSettings()
