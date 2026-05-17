from fastapi import APIRouter
from pydantic import BaseModel, Field
from typing import Literal

from app.core.state import PAPER_BROKER
from app.services.risk import build_risk_sized_order

router = APIRouter()

Symbol = str
Side = Literal["long", "short"]
Source = Literal["manual", "runner"]


class PlaceOrderRequest(BaseModel):
    symbol: Symbol
    side: Side
    price: float = Field(gt=0)
    leverage: int = Field(ge=1, le=100)
    allocated_margin: float = Field(gt=0)
    stop_loss_price: float = Field(gt=0)
    qty: float | None = Field(default=None, gt=0)
    risk_per_trade_pct: float | None = Field(default=None, gt=0, le=0.1)
    stop_loss_pct: float | None = Field(default=None, gt=0, le=0.5)
    take_profit_pct: float | None = Field(default=None, gt=0, le=2.0)
    fee_rate: float | None = Field(default=None, ge=0, le=0.01)
    slippage_rate: float | None = Field(default=None, ge=0, le=0.01)
    source: Source = "manual"


class UpdateMarkPriceRequest(BaseModel):
    symbol: Symbol
    mark_price: float = Field(gt=0)
    position_id: str | None = None
    source: Source = "manual"


class ClosePositionRequest(BaseModel):
    symbol: Symbol
    price: float = Field(gt=0)
    position_id: str | None = None
    source: Source = "manual"


@router.post("/reset")
def reset_paper():
    return PAPER_BROKER.reset()


class ResetPaperRequest(BaseModel):
    initial_balance: float | None = Field(default=None, gt=0)


@router.post("/reset-custom")
def reset_paper_custom(payload: ResetPaperRequest):
    return PAPER_BROKER.reset(initial_balance=payload.initial_balance)


@router.post("/order")
def place_order(payload: PlaceOrderRequest):
    explicit_qty = payload.qty
    effective_allocated_margin = payload.allocated_margin
    extra_meta = {}

    if explicit_qty is None and payload.risk_per_trade_pct is not None and payload.stop_loss_pct is not None and payload.take_profit_pct is not None:
        sizing = build_risk_sized_order(
            side=payload.side,
            account_equity=PAPER_BROKER.equity,
            entry_price=payload.price,
            leverage=payload.leverage,
            risk_per_trade_pct=payload.risk_per_trade_pct,
            stop_loss_pct=payload.stop_loss_pct,
            take_profit_pct=payload.take_profit_pct,
            allocated_margin_cap=payload.allocated_margin,
        )
        explicit_qty = sizing["qty"] if sizing["qty"] > 0 else None
        effective_allocated_margin = sizing["effective_allocated_margin"]
        extra_meta = {
            "sizing_mode": "risk",
            "allocated_margin": payload.allocated_margin,
            "effective_allocated_margin": sizing["effective_allocated_margin"],
            "risk_based_allocated_margin": sizing["risk_based_allocated_margin"],
            "risk_per_trade_pct": payload.risk_per_trade_pct,
            "explicit_qty": sizing["qty"],
            "stop_loss_pct": payload.stop_loss_pct,
            "take_profit_pct": payload.take_profit_pct,
            "take_profit_price": sizing["take_profit_price"],
        }

    return PAPER_BROKER.place_order(
        symbol=payload.symbol,
        side=payload.side,
        price=payload.price,
        leverage=payload.leverage,
        allocated_margin=effective_allocated_margin,
        stop_loss_price=payload.stop_loss_price,
        source=payload.source,
        fee_rate=payload.fee_rate,
        slippage_rate=payload.slippage_rate,
        qty=explicit_qty,
        meta=extra_meta or None,
    )


@router.post("/mark")
def update_mark(payload: UpdateMarkPriceRequest):
    result = PAPER_BROKER.update_mark_price(
        payload.symbol,
        payload.mark_price,
        source=payload.source,
        meta={"position_id": payload.position_id} if payload.position_id else None,
        position_id=payload.position_id,
    )
    return {**result, "snapshot": PAPER_BROKER.snapshot()}


@router.post("/close")
def close_position(payload: ClosePositionRequest):
    result = PAPER_BROKER.close_position(
        payload.symbol,
        payload.price,
        source=payload.source,
        meta={"position_id": payload.position_id} if payload.position_id else None,
        position_id=payload.position_id,
    )
    return {**result, "snapshot": PAPER_BROKER.snapshot()}
