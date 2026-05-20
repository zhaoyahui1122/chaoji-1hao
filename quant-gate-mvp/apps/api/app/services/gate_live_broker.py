"""Gate.io live futures broker — real order execution via Gate API."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from app.core.log_config import get_logger
from app.services.gate_live_account import (
    _gate_private_request,
    fetch_futures_account,
    fetch_futures_positions,
)
from app.services.live_account_session import get_live_account_session
from app.services.paper_store import append_order_event, close_structured_position, insert_live_position

logger = get_logger(__name__)

GATE_FUTURES_ORDERS_PATH = "/api/v4/futures/usdt/orders"
GATE_FUTURES_POSITIONS_PATH = "/api/v4/futures/usdt/positions"


@dataclass
class LivePosition:
    position_id: str
    symbol: str
    side: str
    leverage: int
    qty: float
    entry_price: float
    mark_price: float


@dataclass
class LiveOrder:
    position_id: str | None
    symbol: str
    side: str
    price: float
    qty: float
    status: str = "filled"
    event_type: str = "open"
    source: str = "live"
    meta_json: str | None = None


class GateLiveBroker:
    """Broker that executes trades on Gate.io real futures account."""

    def __init__(self):
        self._positions: list[LivePosition] = []
        self._orders: list[LiveOrder] = []
        self._last_sync: str | None = None

    def _creds(self) -> tuple[str, str]:
        session = get_live_account_session()
        api_key = session.get("api_key")
        api_secret = session.get("api_secret")
        if not api_key or not api_secret:
            raise RuntimeError("gate_live_no_credentials")
        return api_key, api_secret

    @property
    def equity(self) -> float:
        """Fetch real equity from Gate."""
        try:
            api_key, api_secret = self._creds()
            account = fetch_futures_account(api_key, api_secret)
            return float(account.get("available", 0)) + float(account.get("unrealised_pnl", 0))
        except Exception:
            return 0.0

    @property
    def initial_balance(self) -> float:
        # For live trading, use equity as baseline for risk calculations
        return max(self.equity, 1.0)

    @property
    def positions(self) -> list[LivePosition]:
        return self._positions

    @property
    def orders(self) -> list[LiveOrder]:
        return self._orders

    def sync_positions(self) -> list[LivePosition]:
        """Fetch current positions from Gate and update local cache."""
        api_key, api_secret = self._creds()
        raw_positions = fetch_futures_positions(api_key, api_secret)
        self._positions = []
        for item in raw_positions:
            size = int(item.get("size", 0))
            if size == 0:
                continue
            side = "long" if size > 0 else "short"
            self._positions.append(LivePosition(
                position_id=str(item.get("contract", "")),
                symbol=str(item.get("contract", "")),
                side=side,
                leverage=int(float(item.get("leverage", 1))),
                qty=abs(float(size)),
                entry_price=float(item.get("entry_price", 0)),
                mark_price=float(item.get("mark_price", 0)),
            ))
        self._last_sync = datetime.now(timezone.utc).isoformat()
        return self._positions

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
        **kwargs: Any,
    ) -> dict[str, Any]:
        """Place a real futures order on Gate."""
        api_key, api_secret = self._creds()
        contract = symbol.upper()

        # Set leverage first
        try:
            _gate_private_request(
                "PUT",
                f"{GATE_FUTURES_POSITIONS_PATH}/{contract}",
                api_key=api_key,
                api_secret=api_secret,
                body=json.dumps({"leverage": str(leverage)}),
            )
        except Exception:
            pass  # Leverage may already be set

        # Calculate qty from allocated margin and leverage
        notional = allocated_margin * leverage
        qty = max(1, int(notional / price))

        # Gate: positive size = long, negative = short
        order_size = qty if side == "long" else -qty

        body = json.dumps({
            "contract": contract,
            "size": order_size,
            "price": "0",  # Market order
            "tif": "ioc",  # Immediate or cancel
            "close": False,
            "reduce_only": False,
        })

        result = _gate_private_request(
            "POST",
            GATE_FUTURES_ORDERS_PATH,
            api_key=api_key,
            api_secret=api_secret,
            body=body,
        )

        order_id = str(result.get("id", ""))
        self._orders.append(LiveOrder(
            position_id=contract,
            symbol=contract,
            side=side,
            price=price,
            qty=float(qty),
            status=str(result.get("status", "filled")),
            event_type="open",
            source=source,
            meta_json=json.dumps(meta) if meta else None,
        ))

        # Persist to SQLite for history
        append_order_event(
            symbol=contract,
            side=side,
            price=price,
            qty=float(qty),
            status="filled",
            event_type="open",
            position_id=contract,
            source=source,
            meta=meta,
        )
        try:
            insert_live_position(
                position_id=contract,
                symbol=contract,
                side=side,
                leverage=leverage,
                qty=float(qty),
                entry_price=price,
                mark_price=price,
                meta=meta,
            )
        except Exception:
            pass  # Position may already exist from a previous order

        # Sync positions after order
        self.sync_positions()

        logger.info("[LIVE] %s %s %s x%d @ market (order_id=%s)", side.upper(), symbol, order_size, qty, order_id)
        return {
            "ok": True,
            "symbol": symbol,
            "side": side,
            "qty": float(qty),
            "price": price,
            "leverage": leverage,
            "stop_loss_price": stop_loss_price,
            "gate_order_id": order_id,
        }

    def close_position(
        self,
        symbol: str,
        price: float,
        source: str = "manual",
        meta: dict[str, Any] | None = None,
        position_id: str | None = None,
    ) -> dict[str, Any]:
        """Close a real position on Gate by placing a reduce-only order."""
        api_key, api_secret = self._creds()
        contract = symbol.upper()

        # Find current position
        target = None
        for p in self._positions:
            if p.symbol == contract:
                target = p
                break

        if target is None:
            # Try syncing and looking again
            self.sync_positions()
            for p in self._positions:
                if p.symbol == contract:
                    target = p
                    break

        if target is None:
            return {"ok": False, "symbol": symbol, "error": "no_position_found"}

        # Place a reduce-only order to close
        close_size = -target.qty if target.side == "long" else target.qty
        body = json.dumps({
            "contract": contract,
            "size": close_size,
            "price": "0",  # Market order
            "tif": "ioc",
            "close": True,
            "reduce_only": True,
        })

        result = _gate_private_request(
            "POST",
            GATE_FUTURES_ORDERS_PATH,
            api_key=api_key,
            api_secret=api_secret,
            body=body,
        )

        order_id = str(result.get("id", ""))
        pnl = (price - target.entry_price) * target.qty if target.side == "long" else (target.entry_price - price) * target.qty
        logger.info("[LIVE] CLOSE %s %s @ market (pnl=%.2f, order_id=%s)", contract, target.side, pnl, order_id)

        self._orders.append(LiveOrder(
            position_id=contract,
            symbol=contract,
            side=target.side,
            price=price,
            qty=target.qty,
            status=str(result.get("status", "filled")),
            event_type="close",
            source=source,
            meta_json=json.dumps(meta) if meta else None,
        ))

        # Persist to SQLite for history
        append_order_event(
            symbol=contract,
            side=target.side,
            price=price,
            qty=target.qty,
            status="filled",
            event_type="close",
            position_id=contract,
            source=source,
            meta=meta,
        )
        try:
            close_structured_position(
                position_id=contract,
                price=price,
                pnl=pnl,
            )
        except Exception:
            pass

        # Sync positions after close
        self.sync_positions()

        return {
            "ok": True,
            "symbol": symbol,
            "pnl": pnl,
            "execution_price": price,
            "gate_order_id": order_id,
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
        """Update mark price on local position cache (Gate handles mark price internally)."""
        for p in self._positions:
            if p.symbol == symbol.upper():
                p.mark_price = mark_price
                return {"ok": True, "symbol": symbol, "mark_price": mark_price}
        return {"ok": False, "symbol": symbol, "error": "no_position"}

    def snapshot(self) -> dict[str, Any]:
        """Return current account + positions snapshot."""
        self.sync_positions()
        return {
            "account": {"equity": self.equity},
            "positions": [
                {
                    "position_id": p.position_id,
                    "symbol": p.symbol,
                    "side": p.side,
                    "leverage": p.leverage,
                    "qty": p.qty,
                    "entry_price": p.entry_price,
                    "mark_price": p.mark_price,
                    "notional": p.mark_price * p.qty,
                }
                for p in self._positions
            ],
            "orders": [o.__dict__ for o in self._orders[-20:]],
        }

    def reset(self) -> None:
        """Clear local cache (does NOT affect Gate positions)."""
        self._positions = []
        self._orders = []
