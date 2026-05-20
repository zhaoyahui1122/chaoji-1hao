from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, field_validator
from typing import Literal, Optional

from app.core.settings import SETTINGS
from app.services.strategy_store import (
    load_strategy_config,
    save_strategy_config,
    load_strategy_slots,
    save_strategy_slots,
    delete_strategy_slot,
    add_strategy_slot,
    update_strategy_slot_name,
    update_strategy_slot_config,
)

router = APIRouter()

Timeframe = Literal["5m", "15m", "30m", "1h", "4h"]
Symbol = str


class StrategyConfig(BaseModel):
    symbol: Symbol = "BTC_USDT"
    timeframe: Timeframe = "15m"
    strategy_type: Literal["classic", "turtle", "ict"] = "classic"
    leverage: int = Field(default=5, ge=1, le=150)
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
    turtle_entry_period: int = Field(default=20, ge=5, le=100)
    turtle_exit_period: int = Field(default=10, ge=2, le=50)
    turtle_atr_period: int = Field(default=14, ge=2, le=100)
    turtle_atr_filter: float = Field(default=0.0, ge=0.0)
    ict_bos_lookback: int = Field(default=20, ge=5, le=100)
    ict_risk_reward: float = Field(default=2.5, ge=1.0, le=5.0)
    ict_lookback_eng_bars: int = Field(default=200, ge=1, le=500)
    ict_min_fvg_width_pct: float = Field(default=0.0, ge=0.0, le=0.01)
    ict_cooldown_bars: int = Field(default=0, ge=0, le=100)
    ict_require_trend: bool = Field(default=False)
    stop_loss_pct: float = Field(default=0.02, gt=0, le=0.5)
    take_profit_pct: float = Field(default=0.04, gt=0, le=2.0)
    risk_per_trade_pct: float = Field(default=0.01, gt=0, le=0.1)
    fee_rate: float = Field(default=SETTINGS.default_fee_rate, ge=0, le=0.01)
    slippage_rate: float = Field(default=SETTINGS.default_slippage_rate, ge=0, le=0.01)
    enabled: bool = False

    @field_validator("ma_long")
    @classmethod
    def validate_ma_relation(cls, v, info):
        ma_short = info.data.get("ma_short")
        if ma_short is not None and v <= ma_short:
            raise ValueError("ma_long must be greater than ma_short")
        return v

    @field_validator("macd_slow")
    @classmethod
    def validate_macd_relation(cls, v, info):
        macd_fast = info.data.get("macd_fast")
        if macd_fast is not None and v <= macd_fast:
            raise ValueError("macd_slow must be greater than macd_fast")
        return v


class SlotNameUpdate(BaseModel):
    name: str


class SlotAddRequest(BaseModel):
    name: Optional[str] = None


CURRENT_CONFIG = StrategyConfig(**load_strategy_config(StrategyConfig().model_dump()))


@router.get("")
def get_strategy_config():
    return CURRENT_CONFIG.model_dump()


@router.post("")
def update_strategy_config(config: StrategyConfig):
    global CURRENT_CONFIG
    CURRENT_CONFIG = config
    save_strategy_config(CURRENT_CONFIG.model_dump())
    return {"ok": True, "config": CURRENT_CONFIG.model_dump()}


@router.get("/slots")
def get_strategy_slots():
    """获取所有策略槽"""
    return {"slots": load_strategy_slots()}


@router.post("/slots/add")
def add_slot(req: SlotAddRequest):
    """添加新策略槽"""
    new_slot = add_strategy_slot(req.name)
    return {"ok": True, "slot": new_slot}


@router.post("/slots/{slot_id}/name")
def update_slot_name(slot_id: int, req: SlotNameUpdate):
    """更新策略槽名称"""
    ok, msg = update_strategy_slot_name(slot_id, req.name)
    if not ok:
        raise HTTPException(status_code=400, detail=msg)
    return {"ok": True, "message": msg}


@router.post("/slots/{slot_id}/config")
def update_slot_config(slot_id: int, config: StrategyConfig):
    """更新策略槽配置"""
    ok, msg = update_strategy_slot_config(slot_id, config.model_dump())
    if not ok:
        raise HTTPException(status_code=400, detail=msg)
    return {"ok": True, "message": msg}


@router.post("/slots/{slot_id}/activate")
def activate_slot(slot_id: int):
    global CURRENT_CONFIG
    slot = next((item for item in load_strategy_slots() if item["slotId"] == slot_id), None)
    if slot is None:
        raise HTTPException(status_code=404, detail=f"策略槽 {slot_id} 不存在")
    CURRENT_CONFIG = StrategyConfig(**slot["config"])
    save_strategy_config(CURRENT_CONFIG.model_dump())
    return {"ok": True, "config": CURRENT_CONFIG.model_dump(), "slotId": slot_id}


@router.delete("/slots/{slot_id}")
def delete_slot(slot_id: int):
    """删除策略槽（锁定的槽不允许删除）"""
    ok, msg = delete_strategy_slot(slot_id)
    if not ok:
        raise HTTPException(status_code=400, detail=msg)
    return {"ok": True, "message": msg}
