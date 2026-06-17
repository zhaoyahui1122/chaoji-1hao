from datetime import UTC, date, datetime, time, timedelta
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field
from typing import Any, Literal

from app.backtest.engine import SimpleBacktester
from app.core.rate_limit import limiter
from app.core.settings import SETTINGS
from app.services.market_data import get_ohlcv, timeframe_to_minutes, MarketDataUnavailableError
from app.services.risk import leverage_risk_check, validate_stop_loss_against_liquidation

router = APIRouter()

Timeframe = Literal["5m", "15m", "30m", "1h", "4h"]
Symbol = str
DataSource = Literal["mock", "gate"]
StrategyType = Literal["classic", "turtle", "ict", "macd_trend"]


class BacktestRequest(BaseModel):
    strategy_type: StrategyType = "classic"

    symbol: Symbol = SETTINGS.default_symbol
    timeframe: Timeframe = SETTINGS.default_timeframe
    data_source: DataSource = "mock"
    leverage: int = Field(default=SETTINGS.default_leverage, ge=1, le=150)
    initial_balance: float = Field(default=SETTINGS.initial_balance, gt=0)
    allocated_margin: float = Field(default=SETTINGS.default_allocated_margin, gt=0)
    fee_rate: float = Field(default=SETTINGS.default_fee_rate, ge=0, le=0.01)
    slippage_rate: float = Field(default=SETTINGS.default_slippage_rate, ge=0, le=0.01)
    entry_price: float = Field(default=64000, gt=0)
    stop_loss_price: float = Field(default=62720, gt=0)
    backtest_days: int = Field(default=7, ge=1, le=365)
    start_date: date | None = None
    end_date: date | None = None

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
    classic_trend_filter_enabled: bool = False
    classic_cooldown_bars: int = Field(default=0, ge=0, le=100)

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

    # ICT-specific params
    ict_bos_lookback: int = Field(default=10, ge=5, le=100)
    ict_risk_reward: float = Field(default=2.5, ge=0.5, le=10.0)
    ict_cooldown_bars: int = Field(default=4, ge=0, le=100)
    ict_lookback_eng_bars: int = Field(default=80, ge=1, le=500)
    ict_min_fvg_width_pct: float = Field(default=0.0, ge=0.0, le=0.01)
    ict_require_trend: bool = Field(default=True)
    ict_fvg_max_bars: int = Field(default=100, ge=10, le=500)
    ict_fvg_tolerance_pct: float = Field(default=0.03, ge=0.0, le=0.1)

    # MACD trend strategy params
    macd_trend_enabled: bool = True
    macd_divergence_enabled: bool = True
    macd_signal_expiry: int = Field(default=20, ge=3, le=100)
    macd_breakout_lookback: int = Field(default=20, ge=5, le=100)
    macd_divergence_confirm_lookback: int = Field(default=10, ge=3, le=50)
    macd_trailing_stop_pct: float = Field(default=2.0, ge=0.5, le=20.0)
    macd_trailing_decay_base: float = Field(default=0.98, ge=0.8, le=1.0)
    macd_trailing_decay_floor: float = Field(default=0.3, ge=0.05, le=0.8)


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
    assumptions: dict[str, Any]
    summary: BacktestSummary
    equity_curve: list[dict[str, Any]]
    trades: list[dict[str, Any]]


def _resolve_backtest_window(payload: BacktestRequest) -> tuple[datetime, datetime, int]:
    if payload.start_date or payload.end_date:
        if not payload.start_date or not payload.end_date:
            raise HTTPException(status_code=422, detail='start_date and end_date must both be provided')
        if payload.start_date > payload.end_date:
            raise HTTPException(status_code=422, detail='start_date cannot be later than end_date')

        window_days = (payload.end_date - payload.start_date).days + 1
        if window_days > 365:
            raise HTTPException(status_code=422, detail='Date range cannot exceed 365 days')

        start_time = datetime.combine(payload.start_date, time.min, tzinfo=UTC)
        end_time = datetime.combine(payload.end_date + timedelta(days=1), time.min, tzinfo=UTC)
        return start_time, end_time, window_days

    end_time = datetime.now(UTC)
    start_time = end_time - timedelta(days=payload.backtest_days)
    return start_time, end_time, payload.backtest_days


@router.post("", response_model=BacktestResponse)
@limiter.limit("5/minute")
def run_backtest(request: Request, payload: BacktestRequest):
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
    start_time, end_time, window_days = _resolve_backtest_window(payload)
    periods = max(window_days * candles_per_day, 50)

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

    df_4h = None
    df_1h = None
    if payload.strategy_type == "ict":
        # ICT 需要 4h + 1h + 15m 三个周期
        periods_1h = max(window_days * 24, 50)
        periods_4h = max(window_days * 6, 20)
        try:
            df_1h, _ = get_ohlcv(payload.symbol, "1h", source=payload.data_source, periods=periods_1h, start_time=start_time, end_time=end_time)
            df_4h, _ = get_ohlcv(payload.symbol, "4h", source=payload.data_source, periods=periods_4h, start_time=start_time, end_time=end_time)
        except MarketDataUnavailableError as exc:
            raise HTTPException(status_code=503, detail=str(exc))

    engine = SimpleBacktester(initial_balance=payload.initial_balance)
    result = engine.run(data, payload.model_dump(), df_4h=df_4h, df_1h=df_1h)
    liquidation_guard = validate_stop_loss_against_liquidation(payload.leverage, payload.stop_loss_pct)
    assumptions = {
        "data_source": payload.data_source,
        "symbol": payload.symbol,
        "timeframe": payload.timeframe,
        "leverage": payload.leverage,
        "fee_rate": payload.fee_rate,
        "slippage_rate": payload.slippage_rate,
        "stop_take_profit_trigger": "high_low_intrabar",
        "liquidation_check": liquidation_guard,
        "contract_unit": "backtest_uses_base_qty; live_gate_uses_contract_size_with_quanto_multiplier",
    }

    return {
        "ok": True,
        "input": payload.model_dump(),
        "market_data": market_data,
        "risk": risk,
        "assumptions": assumptions,
        "summary": result.summary,
        "equity_curve": result.equity_curve,
        "trades": result.trades,
    }
