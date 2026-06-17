from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field, field_validator
from typing import Literal

from app.core.rate_limit import limiter
from app.services.strategy_runner import (
    get_runner_logs,
    get_runner_status,
    reset_runner_runtime_state,
    resume_runner,
    run_strategy_cycle,
    set_runner_enabled,
)
from app.core.state import PAPER_BROKER
from app.services.contract_metrics import reset_drawdown_tracker
from app.services.auth_service import AuthenticationError, SESSION_COOKIE_NAME, require_operation_token
from app.services.runner_state_store import load_runner_state

router = APIRouter()

Timeframe = Literal["5m", "15m", "30m", "1h", "4h"]
Symbol = str
DataSource = Literal["mock", "gate"]
StrategyType = Literal["classic", "turtle", "ict", "macd_trend"]
TradeMode = Literal["paper", "live"]
DirectionMode = Literal["auto", "long_only", "short_only"]


class RunnerRequest(BaseModel):
    strategy_type: StrategyType = "classic"

    symbol: Symbol = "BTC_USDT"
    symbols: list[Symbol] | None = None
    timeframe: Timeframe = "15m"
    data_source: DataSource = "gate"
    trade_mode: TradeMode = "paper"
    direction_mode: DirectionMode = "auto"
    leverage: int = Field(default=5, ge=1, le=100)
    allocated_margin: float = Field(default=1000, gt=0)

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
    churn_guard_enabled: bool = False
    classic_trend_filter_enabled: bool = False
    classic_cooldown_bars: int = Field(default=0, ge=0, le=100)

    # Turtle strategy params
    turtle_entry_period: int = Field(default=20, ge=5, le=100)
    turtle_exit_period: int = Field(default=10, ge=2, le=50)
    turtle_atr_period: int = Field(default=14, ge=2, le=100)
    turtle_atr_filter: float = Field(default=0.0, ge=0.0)

    # ICT strategy params
    ict_bos_lookback: int = Field(default=10, ge=5, le=100)
    ict_risk_reward: float = Field(default=2.5, ge=1.0, le=5.0)
    ict_lookback_eng_bars: int = Field(default=80, ge=1, le=500)
    ict_min_fvg_width_pct: float = Field(default=0.0, ge=0.0, le=0.01)
    ict_cooldown_bars: int = Field(default=4, ge=0, le=100)
    ict_require_trend: bool = Field(default=True)

    # MACD trend strategy params
    macd_trend_enabled: bool = True
    macd_divergence_enabled: bool = True
    macd_signal_expiry: int = Field(default=20, ge=3, le=100)
    macd_breakout_lookback: int = Field(default=20, ge=5, le=100)
    macd_divergence_confirm_lookback: int = Field(default=10, ge=3, le=50)
    macd_trailing_stop_pct: float = Field(default=2.0, ge=0.5, le=20.0)

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
    take_profit_pct: float = Field(default=0.05, gt=0, le=2.0)
    risk_per_trade_pct: float = Field(default=0.01, gt=0, le=0.1)
    fee_rate: float = Field(default=0.00015, ge=0, le=0.01)
    slippage_rate: float = Field(default=0.0001, ge=0, le=0.01)
    operation_token: str | None = None
    dry_run: bool = False

    @field_validator("symbols")
    @classmethod
    def validate_symbols(cls, value):
        if value is None:
            return value
        unique = list(dict.fromkeys(value))
        return unique or None


class RunnerToggleRequest(BaseModel):
    enabled: bool
    symbols: list[Symbol] | None = None
    trade_mode: TradeMode = "paper"
    operation_token: str | None = None

    @field_validator("symbols")
    @classmethod
    def validate_symbols(cls, value):
        if value is None:
            return value
        unique = list(dict.fromkeys(value))
        return unique or None


class RunnerResumeRequest(BaseModel):
    operation_token: str | None = None


@router.post("/run-once")
@limiter.limit("10/minute")
def run_once(request: Request, payload: RunnerRequest):
    if payload.trade_mode == "live" and not payload.dry_run:
        try:
            require_operation_token(
                payload.operation_token,
                "runner_live_trade",
                session_token=request.cookies.get(SESSION_COOKIE_NAME, ""),
            )
        except AuthenticationError as exc:
            raise HTTPException(status_code=403, detail=str(exc)) from exc
    return run_strategy_cycle(payload.model_dump())


@router.get("/logs")
def logs():
    return {"items": get_runner_logs()}


@router.get("/status")
def status():
    return get_runner_status()


@router.post("/toggle")
@limiter.limit("10/minute")
def toggle(request: Request, payload: RunnerToggleRequest):
    if payload.enabled:
        action = "runner_toggle_live" if payload.trade_mode == "live" else "runner_toggle"
        try:
            require_operation_token(
                payload.operation_token,
                action,
                session_token=request.cookies.get(SESSION_COOKIE_NAME, ""),
            )
        except AuthenticationError as exc:
            raise HTTPException(status_code=403, detail=str(exc)) from exc
    return set_runner_enabled(payload.enabled, payload.symbols, trade_mode=payload.trade_mode)


@router.post("/resume")
@limiter.limit("10/minute")
def resume(request: Request, payload: RunnerResumeRequest | None = None):
    state = load_runner_state()
    if state.get("trade_mode") == "live":
        try:
            require_operation_token(
                payload.operation_token if payload else None,
                "runner_resume_live",
                session_token=request.cookies.get(SESSION_COOKIE_NAME, ""),
            )
        except AuthenticationError as exc:
            raise HTTPException(status_code=403, detail=str(exc)) from exc
    return resume_runner()


@router.post("/reset-paper")
@limiter.limit("10/minute")
def reset_paper(request: Request):
    reset_drawdown_tracker()
    reset_runner_runtime_state(trade_mode="paper")
    return PAPER_BROKER.reset()
