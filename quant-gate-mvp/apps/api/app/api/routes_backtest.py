from datetime import UTC, datetime, timedelta
from fastapi import APIRouter
from pydantic import BaseModel, Field
from typing import Any, Literal

from app.backtest.engine import SimpleBacktester
from app.core.settings import SETTINGS
from app.services.market_data import get_ohlcv, timeframe_to_minutes, MarketDataUnavailableError
from app.services.risk import leverage_risk_check
from fastapi import HTTPException

router = APIRouter()

Timeframe = Literal["5m", "15m", "30m", "1h", "4h"]
Symbol = str
DataSource = Literal["mock", "gate"]
StrategyType = Literal["classic", "turtle"]


class BacktestRequest(BaseModel):
    strategy_type: StrategyType = "classic"

    symbol: Symbol = SETTINGS.default_symbol
    timeframe: Timeframe = SETTINGS.default_timeframe
    data_source: DataSource = "mock"
    leverage: int = Field(default=SETTINGS.default_leverage, ge=1, le=100)
    initial_balance: float = Field(default=SETTINGS.initial_balance, gt=0)
    allocated_margin: float = Field(default=SETTINGS.default_allocated_margin, gt=0)
    fee_rate: float = Field(default=SETTINGS.default_fee_rate, ge=0, le=0.01)
    slippage_rate: float = Field(default=SETTINGS.default_slippage_rate, ge=0, le=0.01)
    entry_price: float = Field(default=64000, gt=0)
    stop_loss_price: float = Field(default=62720, gt=0)
    backtest_days: int = Field(default=7, ge=1, le=365)

    # Classic strategy params
    use_boll: bool = True
    boll_period: int = Field(default=20, ge=5, le=200)
    boll_std: float = Field(default=2.0, ge=0.5, le=5.0)
    use_rsi: bool = True
    rsi_period: int = Field(default=14, ge=2, le=100)
    rsi_oversold: float = Field(default=30, ge=1, le=50)
    rsi_overbought: float = Field(default=70, ge=50, le=99)
    use_ma: bool = True
    ma_short: int = Field(default=9, ge=2, le=100)
    ma_long: int = Field(default=21, ge=2, le=300)
    use_macd: bool = False
    macd_fast: int = Field(default=12, ge=2, le=100)
    macd_slow: int = Field(default=26, ge=3, le=200)
    macd_signal: int = Field(default=9, ge=2, le=100)
    use_kdj: bool = False
    kdj_period: int = Field(default=9, ge=3, le=100)
    kdj_signal_period: int = Field(default=3, ge=2, le=20)
    kdj_overbought: float = Field(default=80, ge=50, le=100)
    kdj_oversold: float = Field(default=20, ge=0, le=50)
    min_signal_score: int = Field(default=3, ge=1, le=10)

    # Turtle strategy params
    turtle_entry_period: int = Field(default=20, ge=5, le=100)
    turtle_exit_period: int = Field(default=10, ge=2, le=50)
    turtle_atr_period: int = Field(default=14, ge=2, le=100)
    turtle_atr_filter: float = Field(default=0.0, ge=0.0)

    # Adaptive strategy params (ADX + RSI mean reversion)
    turtle_adx_period: int = Field(default=14, ge=2, le=100)
    turtle_adx_threshold: float = Field(default=25.0, ge=10.0, le=50.0)
    turtle_rsi_period: int = Field(default=14, ge=2, le=100)
    turtle_rsi_oversold: float = Field(default=35.0, ge=5.0, le=45.0)
    turtle_rsi_overbought: float = Field(default=70.0, ge=55.0, le=95.0)
    turtle_bb_period: int = Field(default=20, ge=5, le=100)
    turtle_bb_std: float = Field(default=2.0, ge=0.5, le=5.0)
    turtle_force_mode: str | None = None  # "turtle" or "mean_reversion" or None

    # Common risk params
    stop_loss_pct: float = Field(default=0.02, gt=0, le=0.5)
    take_profit_pct: float = Field(default=0.04, gt=0, le=2.0)
    risk_per_trade_pct: float = Field(default=0.01, gt=0, le=0.1)


class BacktestSummary(BaseModel):
    return_pct: float
    max_drawdown_pct: float
    win_rate_pct: float
    trades: int
    ending_equity: float
    gross_pnl: float
    fees: float
    slippage_cost: float
    net_pnl: float
    total_gross_pnl: float
    total_fees: float
    total_slippage_cost: float
    total_net_pnl: float


class BacktestResponse(BaseModel):
    ok: bool
    input: dict[str, Any]
    market_data: dict[str, Any]
    risk: dict[str, Any]
    summary: BacktestSummary
    equity_curve: list[dict[str, Any]]
    trades: list[dict[str, Any]]


@router.post("", response_model=BacktestResponse)
def run_backtest(payload: BacktestRequest):
    risk = leverage_risk_check(
        account_equity=payload.initial_balance,
        available_balance=payload.initial_balance,
        entry_price=payload.entry_price,
        stop_loss_price=payload.stop_loss_price,
        allocated_margin=payload.allocated_margin,
        leverage=payload.leverage,
        max_loss_ratio=SETTINGS.max_loss_ratio,
        margin_limit_ratio=SETTINGS.margin_limit_ratio,
    )

    candles_per_day = max(1, int((24 * 60) / timeframe_to_minutes(payload.timeframe)))
    periods = max(payload.backtest_days * candles_per_day, 50)
    end_time = datetime.now(UTC)
    start_time = end_time - timedelta(days=payload.backtest_days)

    try:
        data, market_data = get_ohlcv(
            payload.symbol,
            payload.timeframe,
            source=payload.data_source,
            periods=periods,
            start_time=start_time,
            end_time=end_time,
        )
    except MarketDataUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    engine = SimpleBacktester(initial_balance=payload.initial_balance)
    result = engine.run(data, payload.model_dump())

    return {
        "ok": True,
        "input": payload.model_dump(),
        "market_data": market_data,
        "risk": risk,
        "summary": result.summary,
        "equity_curve": result.equity_curve,
        "trades": result.trades,
    }
