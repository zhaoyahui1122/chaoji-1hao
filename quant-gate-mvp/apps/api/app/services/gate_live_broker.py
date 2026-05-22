"""Gate.io live futures broker — real order execution via Gate API."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

import requests

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
GATE_FUTURES_PRICE_ORDERS_PATH = "/api/v4/futures/usdt/price_orders"
GATE_CONTRACTS_PATH = "/api/v4/futures/usdt/contracts"

_contract_cache: dict[str, float] = {}


def _get_quanto_multiplier(contract: str) -> float:
    """Fetch contract quanto_multiplier from Gate (cached)."""
    cached = _contract_cache.get(contract)
    if cached is not None:
        return cached
    try:
        resp = requests.get(
            f"https://api.gateio.ws{GATE_CONTRACTS_PATH}/{contract}",
            timeout=10,
        )
        resp.raise_for_status()
        multiplier = float(resp.json().get("quanto_multiplier", "1"))
        _contract_cache[contract] = multiplier
        return multiplier
    except Exception:
        return 1.0  # fallback: assume 1 USD per contract


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
        self._sl_order_ids: dict[str, str] = {}  # contract -> exchange SL order id
        self._sl_prices: dict[str, float] = {}   # contract -> current SL price

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

        # Set leverage with proper error handling
        leverage_actual = leverage
        try:
            lev_resp = _gate_private_request(
                "PUT",
                f"{GATE_FUTURES_POSITIONS_PATH}/{contract}",
                api_key=api_key,
                api_secret=api_secret,
                body=json.dumps({"leverage": str(leverage)}),
            )
            if isinstance(lev_resp, dict):
                leverage_actual = int(float(lev_resp.get("leverage", leverage)))
        except RuntimeError as exc:
            error_msg = str(exc)
            if "status_400" in error_msg or "status_422" in error_msg:
                logger.error("[LIVE] Leverage set failed (400/422): %s", error_msg)
                return {"ok": False, "error": "leverage_set_failed", "detail": error_msg}
            # Network/other error: retry once
            try:
                lev_resp = _gate_private_request(
                    "PUT",
                    f"{GATE_FUTURES_POSITIONS_PATH}/{contract}",
                    api_key=api_key,
                    api_secret=api_secret,
                    body=json.dumps({"leverage": str(leverage)}),
                )
                if isinstance(lev_resp, dict):
                    leverage_actual = int(float(lev_resp.get("leverage", leverage)))
            except Exception as exc2:
                logger.error("[LIVE] Leverage retry failed: %s", exc2)
                return {"ok": False, "error": "leverage_set_failed", "detail": str(exc2)}

        # Calculate qty from allocated margin and leverage
        notional = allocated_margin * leverage
        quanto_multiplier = _get_quanto_multiplier(contract)
        qty = max(1, int(notional / (price * quanto_multiplier)))

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

        # Extract actual fill price from Gate response
        fill_price = float(result.get("fill_price") or result.get("avg_deal_price") or result.get("price") or 0)
        execution_price = fill_price if fill_price > 0 else price

        self._orders.append(LiveOrder(
            position_id=contract,
            symbol=contract,
            side=side,
            price=execution_price,
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
            price=execution_price,
            qty=float(qty),
            status="filled",
            event_type="open",
            position_id=contract,
            source=source,
            meta=meta,
            trade_mode="live",
        )
        try:
            insert_live_position(
                position_id=contract,
                symbol=contract,
                side=side,
                leverage=leverage,
                qty=float(qty),
                entry_price=execution_price,
                mark_price=execution_price,
                meta=meta,
            )
        except Exception:
            pass  # Position may already exist from a previous order

        # Place exchange-side stop-loss conditional order (safety net)
        exchange_sl_order_id = None
        if stop_loss_price and stop_loss_price > 0:
            try:
                sl_size = -order_size  # Reverse to close
                # Gate rule: 1 = price <= trigger (for long stop-loss), 2 = price >= trigger (for short stop-loss)
                sl_rule = 1 if side == "long" else 2
                sl_body = json.dumps({
                    "contract": contract,
                    "initial": {
                        "contract": contract,
                        "size": sl_size,
                        "price": "0",
                        "tif": "ioc",
                        "close": True,
                        "reduce_only": True,
                    },
                    "trigger": {
                        "price": str(stop_loss_price),
                        "rule": sl_rule,
                    },
                    "order_type": "market",
                })
                sl_result = _gate_private_request(
                    "POST",
                    GATE_FUTURES_PRICE_ORDERS_PATH,
                    api_key=api_key,
                    api_secret=api_secret,
                    body=sl_body,
                )
                exchange_sl_order_id = str(sl_result.get("id", ""))
                if exchange_sl_order_id:
                    self._sl_order_ids[contract] = exchange_sl_order_id
                    self._sl_prices[contract] = stop_loss_price
                logger.info("[LIVE] Exchange SL placed: contract=%s trigger=%.1f id=%s", contract, stop_loss_price, exchange_sl_order_id)
            except Exception as sl_exc:
                logger.warning("[LIVE] Exchange SL placement failed (non-blocking): %s", sl_exc)

        # Sync positions after order
        self.sync_positions()

        logger.info("[LIVE] %s %s %s x%d @ market (order_id=%s, fill=%.1f)", side.upper(), symbol, order_size, qty, order_id, execution_price)
        return {
            "ok": True,
            "symbol": symbol,
            "side": side,
            "qty": float(qty),
            "price": price,
            "execution_price_actual": execution_price,
            "leverage": leverage,
            "leverage_actual": leverage_actual,
            "stop_loss_price": stop_loss_price,
            "gate_order_id": order_id,
            "exchange_sl_order_id": exchange_sl_order_id,
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

        # Extract actual fill price from Gate response
        fill_price = float(result.get("fill_price") or result.get("avg_deal_price") or result.get("price") or 0)
        execution_price = fill_price if fill_price > 0 else price

        pnl = (execution_price - target.entry_price) * target.qty if target.side == "long" else (target.entry_price - execution_price) * target.qty
        logger.info("[LIVE] CLOSE %s %s @ market (pnl=%.2f, order_id=%s, fill=%.1f)", contract, target.side, pnl, order_id, execution_price)

        self._orders.append(LiveOrder(
            position_id=contract,
            symbol=contract,
            side=target.side,
            price=execution_price,
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
            price=execution_price,
            qty=target.qty,
            status="filled",
            event_type="close",
            position_id=contract,
            source=source,
            meta=meta,
            trade_mode="live",
        )
        try:
            close_structured_position(
                position_id=contract,
                price=execution_price,
                pnl=pnl,
            )
        except Exception:
            pass

        # Cancel exchange-side conditional orders for this contract
        try:
            _gate_private_request(
                "DELETE",
                f"{GATE_FUTURES_PRICE_ORDERS_PATH}?contract={contract}&status=open",
                api_key=api_key,
                api_secret=api_secret,
            )
            logger.info("[LIVE] Cancelled conditional orders for %s", contract)
            self._sl_order_ids.pop(contract, None)
            self._sl_prices.pop(contract, None)
        except Exception as cancel_exc:
            logger.warning("[LIVE] Cancel conditional orders failed (non-blocking): %s", cancel_exc)

        # Sync positions after close
        self.sync_positions()

        return {
            "ok": True,
            "symbol": symbol,
            "pnl": pnl,
            "execution_price": execution_price,
            "execution_price_actual": execution_price,
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

    def update_stop_loss(
        self,
        symbol: str,
        new_sl_price: float,
        drift_threshold_pct: float = 0.005,
    ) -> dict[str, Any]:
        """Cancel old exchange SL and place a new one if the price has drifted enough."""
        contract = symbol.upper()
        old_sl = self._sl_prices.get(contract)
        if old_sl is not None and old_sl > 0:
            drift = abs(new_sl_price - old_sl) / old_sl
            if drift < drift_threshold_pct:
                return {"ok": True, "symbol": symbol, "action": "skip", "reason": "drift_below_threshold"}

        api_key, api_secret = self._creds()

        # Find position to know direction and size
        target = next((p for p in self._positions if p.symbol == contract), None)
        if target is None:
            return {"ok": False, "symbol": symbol, "error": "no_position"}

        # Cancel old conditional orders
        try:
            _gate_private_request(
                "DELETE",
                f"{GATE_FUTURES_PRICE_ORDERS_PATH}?contract={contract}&status=open",
                api_key=api_key,
                api_secret=api_secret,
            )
        except Exception:
            pass

        # Place new SL
        try:
            sl_size = -target.qty if target.side == "long" else target.qty
            sl_rule = 1 if target.side == "long" else 2
            sl_body = json.dumps({
                "contract": contract,
                "initial": {
                    "contract": contract,
                    "size": sl_size,
                    "price": "0",
                    "tif": "ioc",
                    "close": True,
                    "reduce_only": True,
                },
                "trigger": {
                    "price": str(new_sl_price),
                    "rule": sl_rule,
                },
                "order_type": "market",
            })
            sl_result = _gate_private_request(
                "POST",
                GATE_FUTURES_PRICE_ORDERS_PATH,
                api_key=api_key,
                api_secret=api_secret,
                body=sl_body,
            )
            new_id = str(sl_result.get("id", ""))
            if new_id:
                self._sl_order_ids[contract] = new_id
                self._sl_prices[contract] = new_sl_price
            logger.info("[LIVE] SL updated: %s %.1f -> %.1f id=%s", contract, old_sl or 0, new_sl_price, new_id)
            return {"ok": True, "symbol": symbol, "action": "updated", "old_sl": old_sl, "new_sl": new_sl_price, "order_id": new_id}
        except Exception as exc:
            logger.warning("[LIVE] SL update failed for %s: %s", contract, exc)
            return {"ok": False, "symbol": symbol, "error": str(exc)}

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
        self._sl_order_ids = {}
        self._sl_prices = {}
