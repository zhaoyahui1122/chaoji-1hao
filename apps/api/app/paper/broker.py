from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any
from uuid import uuid4

from app.core.settings import SETTINGS
from app.services.contract_metrics import build_account_overview, build_position_metrics
from app.services.paper_store import append_order_event, close_structured_position, get_drawdown_summary, load_structured_paper_state, replace_structured_paper_state, reset_structured_paper_state
from app.services.runner_state_store import export_runner_state
from app.services.risk import apply_slippage, calc_fee, calc_max_loss, calc_take_profit_price, leverage_risk_check
from app.services.state_store import export_json_state


@dataclass
class PaperPosition:
    position_id: str
    symbol: str
    side: str
    leverage: int
    qty: float
    entry_price: float
    mark_price: float
    fee_rate: float = SETTINGS.default_fee_rate
    slippage_rate: float = SETTINGS.default_slippage_rate
    entry_fee: float = 0.0
    cumulative_fees: float = 0.0
    entry_slippage_cost: float = 0.0
    exit_slippage_cost: float = 0.0
    cumulative_slippage_cost: float = 0.0
    stop_loss_price: float = 0.0
    take_profit_price: float = 0.0
    best_price: float = 0.0
    trailing_bars_held: int = 0


@dataclass
class PaperOrder:
    position_id: str | None
    symbol: str
    side: str
    price: float
    qty: float
    status: str = "filled"
    event_type: str = "open"
    source: str = "manual"
    meta_json: str | None = None


@dataclass
class PaperBroker:
    initial_balance: float = SETTINGS.initial_balance
    realized_pnl: float = 0.0
    positions: list[PaperPosition] = field(default_factory=list)
    orders: list[PaperOrder] = field(default_factory=list)

    def __post_init__(self):
        self._restore()

    @staticmethod
    def _apply_slippage(side: str, price: float, slippage_rate: float, is_close: bool = False) -> float:
        return apply_slippage(side, price, slippage_rate, is_close)

    @staticmethod
    def _calc_fee(notional: float, fee_rate: float) -> float:
        return calc_fee(notional, fee_rate)

    @property
    def equity(self) -> float:
        unrealized = 0.0
        for p in self.positions:
            if p.side == "long":
                gross_unrealized = (p.mark_price - p.entry_price) * p.qty
            else:
                gross_unrealized = (p.entry_price - p.mark_price) * p.qty
            estimated_exit_fee = self._calc_fee(p.mark_price * p.qty, p.fee_rate)
            unrealized += gross_unrealized - estimated_exit_fee
        return self.initial_balance + self.realized_pnl + unrealized

    def _restore(self) -> None:
        default_state = {
            "initial_balance": self.initial_balance,
            "realized_pnl": self.realized_pnl,
            "positions": [],
            "orders": [],
        }
        data = load_structured_paper_state(default_state) or default_state

        self.initial_balance = data.get("initial_balance", self.initial_balance)
        self.realized_pnl = data.get("realized_pnl", self.realized_pnl)
        self.positions = [PaperPosition(**p) for p in data.get("positions", [])]
        self.orders = [PaperOrder(**o) for o in data.get("orders", [])]
        self._persist()

    def _persist(self) -> None:
        payload = {
            "initial_balance": self.initial_balance,
            "realized_pnl": self.realized_pnl,
            "positions": [p.__dict__ for p in self.positions],
            "orders": [o.__dict__ for o in self.orders],
        }
        metrics_positions = [
            build_position_metrics(
                symbol=p.symbol,
                side=p.side,
                leverage=p.leverage,
                qty=p.qty,
                entry_price=p.entry_price,
                mark_price=p.mark_price,
                equity=self.equity,
            )
            for p in self.positions
        ]
        account = build_account_overview(self.equity, metrics_positions, realized_pnl=self.realized_pnl)
        account = account.model_copy(update=get_drawdown_summary("paper"))
        replace_structured_paper_state(payload, account.model_dump())
        export_json_state(payload)

    def snapshot(self) -> dict[str, Any]:
        metrics_positions = [
            build_position_metrics(
                symbol=p.symbol,
                side=p.side,
                leverage=p.leverage,
                qty=p.qty,
                entry_price=p.entry_price,
                mark_price=p.mark_price,
                equity=self.equity,
            )
            for p in self.positions
        ]
        account = build_account_overview(self.equity, metrics_positions, realized_pnl=self.realized_pnl)
        account = account.model_copy(update=get_drawdown_summary("paper"))
        active_position_ids = {position.position_id for position in self.positions}
        active_orders = [o.__dict__ for o in self.orders if o.position_id in active_position_ids]
        return {
            "account": account.model_dump(),
            "positions": [
                {
                    **p.model_dump(),
                    "position_id": raw.position_id,
                    "open_order_meta_json": next((o.meta_json for o in reversed(self.orders) if o.position_id == raw.position_id and o.event_type == "open"), None),
                }
                for p, raw in zip(metrics_positions, self.positions)
            ],
            "orders": active_orders,
        }

    def place_order(
        self,
        symbol: str,
        side: str,
        price: float,
        leverage: int,
        allocated_margin: float,
        stop_loss_price: float,
        source: str = "manual",
        meta: dict[str, Any] | None = None,
        fee_rate: float | None = None,
        slippage_rate: float | None = None,
        qty: float | None = None,
    ) -> dict[str, Any]:
        fee_rate = SETTINGS.default_fee_rate if fee_rate is None else float(fee_rate)
        slippage_rate = SETTINGS.default_slippage_rate if slippage_rate is None else float(slippage_rate)
        execution_price = self._apply_slippage(side, price, slippage_rate, is_close=False)

        if qty is not None:
            qty = float(qty)
            if qty <= 0:
                return {"ok": False, "reason": "invalid_qty"}
            notional = execution_price * qty
            initial_margin = notional / leverage if leverage > 0 else notional
            max_loss = calc_max_loss(execution_price, stop_loss_price, qty)
            equity_risk_ratio = (max_loss / self.equity) if self.equity > 0 else 1.0
            risk = {
                "allowed": True,
                "qty": qty,
                "notional": notional,
                "initial_margin": initial_margin,
                "max_loss": max_loss,
                "equity_risk_ratio": equity_risk_ratio,
                "leverage": leverage,
                "source": "explicit_qty",
            }
            sizing_mode = str((meta or {}).get("sizing_mode") or "explicit_qty")
            if initial_margin > self.equity * SETTINGS.margin_limit_ratio:
                risk["allowed"] = False
            if equity_risk_ratio > SETTINGS.max_loss_ratio:
                risk["allowed"] = False
        else:
            risk = leverage_risk_check(
                account_equity=self.equity,
                available_balance=self.equity,
                entry_price=execution_price,
                stop_loss_price=stop_loss_price,
                allocated_margin=allocated_margin,
                leverage=leverage,
            )
            qty = risk["qty"]
            notional = execution_price * qty
            sizing_mode = str((meta or {}).get("sizing_mode") or "margin")

        if not risk["allowed"]:
            return {"ok": False, "reason": "risk_rejected", "risk": risk}

        position_id = f"pos_{uuid4().hex[:12]}"
        entry_fee = self._calc_fee(notional, fee_rate)
        entry_slippage_cost = abs(execution_price - price) * qty
        self.realized_pnl -= entry_fee

        resolved_take_profit_price = (meta or {}).get("take_profit_price")
        if resolved_take_profit_price is not None:
            resolved_take_profit_price = float(resolved_take_profit_price)
        else:
            take_profit_pct = (meta or {}).get("take_profit_pct")
            if take_profit_pct is not None:
                resolved_take_profit_price = calc_take_profit_price(execution_price, side, float(take_profit_pct))

        resolved_meta = {
            **(meta or {}),
            "sizing_mode": sizing_mode,
            "leverage": leverage,
            "allocated_margin": allocated_margin,
            "stop_loss_price": stop_loss_price,
            "take_profit_price": resolved_take_profit_price,
            "requested_price": price,
            "execution_price": execution_price,
            "fee_rate": fee_rate,
            "slippage_rate": slippage_rate,
            "entry_fee": entry_fee,
            "entry_slippage_cost": entry_slippage_cost,
            "notional": notional,
        }
        resolved_meta_json = json.dumps(resolved_meta, ensure_ascii=False)
        order = PaperOrder(
            position_id=position_id,
            symbol=symbol,
            side=side,
            price=execution_price,
            qty=qty,
            status="filled",
            event_type="open",
            source=source,
            meta_json=resolved_meta_json,
        )
        position = PaperPosition(
            position_id=position_id,
            symbol=symbol,
            side=side,
            leverage=leverage,
            qty=qty,
            entry_price=execution_price,
            mark_price=execution_price,
            fee_rate=fee_rate,
            slippage_rate=slippage_rate,
            entry_fee=entry_fee,
            cumulative_fees=entry_fee,
            entry_slippage_cost=entry_slippage_cost,
            exit_slippage_cost=0.0,
            cumulative_slippage_cost=entry_slippage_cost,
            stop_loss_price=float(stop_loss_price),
            take_profit_price=float(resolved_take_profit_price) if resolved_take_profit_price else 0.0,
        )
        self.orders.append(order)
        self.positions.append(position)
        append_order_event(
            symbol=symbol,
            side=side,
            price=execution_price,
            qty=qty,
            status=order.status,
            event_type="open",
            position_id=position_id,
            source=source,
            meta=resolved_meta,
        )
        self._persist()
        return {
            "ok": True,
            "order": order.__dict__,
            "risk": risk,
            "execution_price": execution_price,
            "fee": entry_fee,
            "slippage_rate": slippage_rate,
        }

    def update_mark_price(
        self,
        symbol: str,
        mark_price: float,
        source: str = "manual",
        meta: dict[str, Any] | None = None,
        position_id: str | None = None,
        persist: bool = True,
    ) -> dict[str, Any]:
        for p in self.positions:
            if p.symbol != symbol:
                continue
            if position_id and p.position_id != position_id:
                continue

            p.mark_price = mark_price
            estimated_exit_price = self._apply_slippage(p.side, mark_price, p.slippage_rate, is_close=True)
            if p.side == "long":
                gross_unrealized = (estimated_exit_price - p.entry_price) * p.qty
            else:
                gross_unrealized = (p.entry_price - estimated_exit_price) * p.qty
            estimated_exit_fee = self._calc_fee(estimated_exit_price * p.qty, p.fee_rate)
            net_unrealized = gross_unrealized - estimated_exit_fee
            resolved_meta = {
                **(meta or {}),
                "mark_price": mark_price,
                "estimated_exit_price": estimated_exit_price,
                "estimated_exit_fee": estimated_exit_fee,
                "gross_unrealized_pnl": gross_unrealized,
                "net_unrealized_pnl": net_unrealized,
            }
            if persist:
                append_order_event(
                    symbol=p.symbol,
                    side=p.side,
                    price=mark_price,
                    qty=p.qty,
                    status="mark",
                    event_type="mark",
                    position_id=p.position_id,
                    source=source,
                    meta=resolved_meta,
                )
            self._persist()
            return {
                "ok": True,
                "symbol": p.symbol,
                "event": {
                    "position_id": p.position_id,
                    "symbol": p.symbol,
                    "side": p.side,
                    "price": mark_price,
                    "qty": p.qty,
                    "status": "mark",
                    "event_type": "mark",
                    "source": source,
                    "meta_json": json.dumps(resolved_meta, ensure_ascii=False),
                },
            }
        if persist:
            self._persist()
        return {"ok": False, "reason": "position_not_found"}

    def close_position(
        self,
        symbol: str,
        price: float,
        source: str = "manual",
        meta: dict[str, Any] | None = None,
        position_id: str | None = None,
    ) -> dict[str, Any]:
        for i, p in enumerate(self.positions):
            if p.symbol != symbol:
                continue
            if position_id and p.position_id != position_id:
                continue

            execution_price = self._apply_slippage(p.side, price, p.slippage_rate, is_close=True)
            gross_pnl = (execution_price - p.entry_price) * p.qty if p.side == "long" else (p.entry_price - execution_price) * p.qty
            exit_slippage_cost = abs(execution_price - price) * p.qty
            exit_notional = execution_price * p.qty
            exit_fee = self._calc_fee(exit_notional, p.fee_rate)
            net_pnl = gross_pnl - exit_fee
            total_fees = p.cumulative_fees + exit_fee
            total_slippage_cost = p.entry_slippage_cost + exit_slippage_cost
            self.realized_pnl += net_pnl
            closed = self.positions.pop(i)
            closed_row = close_structured_position(
                closed.position_id,
                execution_price,
                net_pnl,
                cumulative_fees=total_fees,
                exit_slippage_cost=exit_slippage_cost,
                cumulative_slippage_cost=total_slippage_cost,
            )
            resolved_meta = {
                **(meta or {}),
                "requested_price": price,
                "execution_price": execution_price,
                "gross_pnl": gross_pnl,
                "net_pnl": net_pnl,
                "realized_pnl": net_pnl,
                "close_price": execution_price,
                "exit_fee": exit_fee,
                "total_fees": total_fees,
                "entry_slippage_cost": p.entry_slippage_cost,
                "exit_slippage_cost": exit_slippage_cost,
                "total_slippage_cost": total_slippage_cost,
                "fee_rate": p.fee_rate,
                "slippage_rate": p.slippage_rate,
            }
            close_order = PaperOrder(
                position_id=closed.position_id,
                symbol=closed.symbol,
                side=closed.side,
                price=execution_price,
                qty=closed.qty,
                status="closed",
                event_type="close",
                source=source,
                meta_json=json.dumps(resolved_meta, ensure_ascii=False),
            )
            self.orders.append(close_order)
            append_order_event(
                symbol=closed.symbol,
                side=closed.side,
                price=execution_price,
                qty=closed.qty,
                status="closed",
                event_type="close",
                position_id=closed.position_id,
                source=source,
                meta=resolved_meta,
            )
            self._persist()
            return {
                "ok": True,
                "symbol": symbol,
                "pnl": net_pnl,
                "gross_pnl": gross_pnl,
                "fee": exit_fee,
                "execution_price": execution_price,
                "closed": closed.__dict__,
                "closed_row": closed_row,
                "event": {
                    "position_id": closed.position_id,
                    "symbol": closed.symbol,
                    "side": closed.side,
                    "price": execution_price,
                    "qty": closed.qty,
                    "status": "closed",
                    "event_type": "close",
                    "source": source,
                    "meta_json": json.dumps(resolved_meta, ensure_ascii=False),
                },
            }
        return {"ok": False, "reason": "position_not_found"}

    def reset(self, initial_balance: float | None = None) -> dict[str, Any]:
        balance = initial_balance if initial_balance and initial_balance > 0 else SETTINGS.initial_balance
        reset_structured_paper_state(balance)
        self.initial_balance = balance
        self.realized_pnl = 0.0
        self.positions.clear()
        self.orders.clear()
        self._persist()
        return {"ok": True, "closed_positions": 0, "equity": self.equity, "initial_balance": self.initial_balance}
