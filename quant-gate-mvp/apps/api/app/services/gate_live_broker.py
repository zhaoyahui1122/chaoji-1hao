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
from app.services.paper_store import append_order_event, close_structured_position, insert_live_position, upsert_live_position, write_equity_snapshot

logger = get_logger(__name__)

GATE_FUTURES_ORDERS_PATH = "/api/v4/futures/usdt/orders"
GATE_FUTURES_POSITIONS_PATH = "/api/v4/futures/usdt/positions"
GATE_FUTURES_PRICE_ORDERS_PATH = "/api/v4/futures/usdt/price_orders"
GATE_CONTRACTS_PATH = "/api/v4/futures/usdt/contracts"

_contract_cache: dict[str, dict[str, float]] = {}


def _get_contract_info(contract: str) -> dict[str, float]:
    """Fetch and cache contract info (quanto_multiplier, tick_size)."""
    cached = _contract_cache.get(contract)
    if cached is not None:
        return cached
    try:
        resp = requests.get(
            f"https://api.gateio.ws{GATE_CONTRACTS_PATH}/{contract}",
            timeout=10,
        )
        resp.raise_for_status()
        data = resp.json()
        info = {
            "quanto_multiplier": float(data.get("quanto_multiplier", "1")),
            "tick_size": float(data.get("order_price_round", "0.1")),
        }
        _contract_cache[contract] = info
        return info
    except Exception:
        return {"quanto_multiplier": 1.0, "tick_size": 0.1}


def _round_price_tick(price: float, contract: str | None = None) -> float:
    """Round price to the contract's valid tick size."""
    tick = 0.1
    if contract:
        tick = _get_contract_info(contract).get("tick_size", 0.1)
    decimals = max(0, len(str(tick).split('.')[-1]) if '.' in str(tick) else 0)
    return round(round(price / tick) * tick, decimals)


def _get_quanto_multiplier(contract: str) -> float:
    """Fetch contract quanto_multiplier from Gate (cached)."""
    return _get_contract_info(contract).get("quanto_multiplier", 1.0)


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
        self._raw_positions: list[dict[str, Any]] = []  # raw Gate API data
        self._orders: list[LiveOrder] = []
        self._last_sync: str | None = None
        self._sl_order_ids: dict[str, str] = {}  # contract -> exchange SL order id
        self._sl_prices: dict[str, float] = {}   # contract -> current SL price
        self._tp_order_ids: dict[str, str] = {}  # contract -> exchange TP order id
        self._tp_prices: dict[str, float] = {}   # contract -> current TP price

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
        self._raw_positions = []
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
            self._raw_positions.append(item)
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

        # Set leverage via POST query string (Gate.io API)
        leverage_actual = leverage
        try:
            lev_resp = _gate_private_request(
                "POST",
                f"{GATE_FUTURES_POSITIONS_PATH}/{contract}/leverage",
                api_key=api_key,
                api_secret=api_secret,
                query_string=f"leverage={leverage}",
            )
            # Response is a list; extract from first item
            if isinstance(lev_resp, list) and lev_resp:
                leverage_actual = int(float(lev_resp[0].get("leverage", leverage)))
            elif isinstance(lev_resp, dict):
                leverage_actual = int(float(lev_resp.get("leverage", leverage)))
        except RuntimeError as exc:
            error_msg = str(exc)
            if "status_400" in error_msg or "status_422" in error_msg:
                logger.error("[LIVE] Leverage set failed (400/422): %s", error_msg)
                return {"ok": False, "error": "leverage_set_failed", "detail": error_msg}
            # Network/other error: retry once
            try:
                lev_resp = _gate_private_request(
                    "POST",
                    f"{GATE_FUTURES_POSITIONS_PATH}/{contract}/leverage",
                    api_key=api_key,
                    api_secret=api_secret,
                    query_string=f"leverage={leverage}",
                )
                if isinstance(lev_resp, list) and lev_resp:
                    leverage_actual = int(float(lev_resp[0].get("leverage", leverage)))
                elif isinstance(lev_resp, dict):
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
        # Sync positions from Gate and upsert with actual accumulated values
        try:
            self.sync_positions()
            gate_pos = next((p for p in self._positions if p.symbol == contract), None)
            if gate_pos:
                upsert_live_position(
                    position_id=contract,
                    symbol=contract,
                    side=gate_pos.side,
                    leverage=gate_pos.leverage,
                    qty=gate_pos.qty,
                    entry_price=gate_pos.entry_price,
                    mark_price=gate_pos.mark_price,
                )
            else:
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
            pass

        # Place exchange-side stop-loss and take-profit conditional orders
        exchange_sl_order_id = None
        if stop_loss_price and stop_loss_price > 0:
            # 防重复：先取消已有止损单
            old_sl_id = self._sl_order_ids.get(contract)
            if old_sl_id:
                try:
                    _gate_private_request(
                        "DELETE",
                        f"{GATE_FUTURES_PRICE_ORDERS_PATH}/{old_sl_id}",
                        api_key=api_key, api_secret=api_secret,
                    )
                except Exception:
                    pass
            try:
                sl_size = -order_size  # Reverse to close
                # Gate rule: 1 = price <= trigger, 2 = price >= trigger
                # SL (both long/short): rule=1
                sl_rule = 1
                sl_trigger = _round_price_tick(stop_loss_price, contract)
                sl_body = json.dumps({
                    "contract": contract,
                    "initial": {
                        "contract": contract,
                        "size": sl_size,
                        "price": "0",
                        "tif": "ioc",
                        "reduce_only": True,
                    },
                    "trigger": {
                        "price": str(sl_trigger),
                        "rule": sl_rule,
                    },
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
                logger.info("[LIVE] Exchange SL placed: contract=%s trigger=%.1f id=%s", contract, sl_trigger, exchange_sl_order_id)
            except Exception as sl_exc:
                logger.warning("[LIVE] Exchange SL placement failed (non-blocking): %s", sl_exc)

        # Place take-profit conditional order
        take_profit_price = (meta or {}).get("take_profit_price")
        if take_profit_price and take_profit_price > 0:
            try:
                tp_size = -order_size
                # TP: long → rule=2 (price rises), short → rule=1 (price drops)
                tp_rule = 2 if side == "long" else 1
                tp_trigger = _round_price_tick(take_profit_price, contract)
                tp_body = json.dumps({
                    "contract": contract,
                    "initial": {
                        "contract": contract,
                        "size": tp_size,
                        "price": "0",
                        "tif": "ioc",
                        "reduce_only": True,
                    },
                    "trigger": {
                        "price": str(tp_trigger),
                        "rule": tp_rule,
                    },
                })
                tp_result = _gate_private_request(
                    "POST",
                    GATE_FUTURES_PRICE_ORDERS_PATH,
                    api_key=api_key,
                    api_secret=api_secret,
                    body=tp_body,
                )
                tp_order_id = str(tp_result.get("id", ""))
                if tp_order_id:
                    self._tp_order_ids[contract] = tp_order_id
                    self._tp_prices[contract] = take_profit_price
                logger.info("[LIVE] Exchange TP placed: contract=%s trigger=%.1f id=%s", contract, tp_trigger, tp_order_id)
            except Exception as tp_exc:
                logger.error("[LIVE] Exchange TP FAILED: contract=%s trigger=%.2f rule=%d size=%d error=%s", contract, tp_trigger, tp_rule, tp_size, tp_exc)

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

        # Query Gate's position_close for authoritative PnL and fees
        # Gate's pnl_pnl (trading PnL) and pnl_fee (total fees) are already in USDT
        # for USDT-margined contracts — no unit conversion needed
        gate_net_pnl = None
        gate_total_fees = 0.0
        try:
            pos_closes = _gate_private_request(
                "GET", "/api/v4/futures/usdt/position_close",
                api_key=api_key, api_secret=api_secret,
                query_string=f"contract={contract}&limit=1",
            )
            if isinstance(pos_closes, list) and pos_closes:
                pc = pos_closes[0]
                # pnl_pnl = trading PnL in USDT, pnl_fee = total fees in USDT
                # These already account for quanto_multiplier internally
                pnl_trading = float(pc.get("pnl_pnl") or 0)
                pnl_fee_total = abs(float(pc.get("pnl_fee") or 0))
                gate_net_pnl = pnl_trading - pnl_fee_total
                gate_total_fees = pnl_fee_total
                actual_qty = abs(int(pc.get("max_size") or 0))
                actual_entry = float(pc.get("short_price") or pc.get("long_price") or target.entry_price)
                if target.side == "long":
                    actual_entry = float(pc.get("long_price") or target.entry_price)
                # Update target with Gate's authoritative values
                if actual_qty > 0:
                    target.qty = float(actual_qty)
                if actual_entry > 0:
                    target.entry_price = actual_entry
                logger.info("[LIVE] Gate position_close: %s trading=%.4f fee=%.4f net=%.4f qty=%d entry=%.1f",
                    contract, pnl_trading, pnl_fee_total, gate_net_pnl, actual_qty, actual_entry)
        except Exception as pc_exc:
            logger.warning("[LIVE] position_close query failed: %s", pc_exc)

        if gate_net_pnl is not None:
            net_pnl = gate_net_pnl
            total_fees = gate_total_fees
            gross_pnl = net_pnl + total_fees
        else:
            # Fallback: estimate fees from trades endpoint (fee is per-contract)
            total_fees = 0.0
            try:
                recent_trades = _gate_private_request(
                    "GET", "/api/v4/futures/usdt/my_trades",
                    api_key=api_key, api_secret=api_secret,
                    query_string=f"contract={contract}&limit=10",
                )
                if isinstance(recent_trades, list):
                    for t in recent_trades:
                        fee_per_contract = abs(float(t.get("fee") or 0))
                        trade_size = abs(int(t.get("size") or 0))
                        total_fees += fee_per_contract * trade_size
            except Exception:
                pass
            # Estimate gross PnL with quanto multiplier
            quanto_multiplier = _get_quanto_multiplier(contract)
            gross_pnl_raw = (execution_price - target.entry_price) * target.qty if target.side == "long" else (target.entry_price - execution_price) * target.qty
            gross_pnl = gross_pnl_raw * quanto_multiplier
            net_pnl = gross_pnl - total_fees

        # Slippage estimate: small for liquid pairs
        total_slippage = abs(target.entry_price * target.qty) * 0.00001

        logger.info("[LIVE] CLOSE %s %s @ market (gross=%.2f, fees=%.4f, net=%.2f, order_id=%s, fill=%.1f)", contract, target.side, gross_pnl, total_fees, net_pnl, order_id, execution_price)

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
            # Update position with Gate's actual entry_price and qty before closing
            upsert_live_position(
                position_id=contract,
                symbol=contract,
                side=target.side,
                leverage=target.leverage if hasattr(target, 'leverage') else 1,
                qty=target.qty,
                entry_price=target.entry_price,
                mark_price=execution_price,
            )
            close_structured_position(
                position_id=contract,
                price=execution_price,
                pnl=net_pnl,
                cumulative_fees=total_fees,
                cumulative_slippage_cost=total_slippage,
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
            self._tp_order_ids.pop(contract, None)
            self._tp_prices.pop(contract, None)
        except Exception as cancel_exc:
            logger.warning("[LIVE] Cancel conditional orders failed (non-blocking): %s", cancel_exc)

        # Sync positions after close
        self.sync_positions()

        # Write equity snapshot for drawdown tracking
        try:
            equity = self.equity
            if equity > 0:
                write_equity_snapshot(equity=equity, realized_pnl=net_pnl, trade_mode="live")
        except Exception:
            pass

        return {
            "ok": True,
            "symbol": symbol,
            "pnl": net_pnl,
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

        # Cancel ONLY the old SL order (by tracked ID), preserving TP
        sl_id = self._sl_order_ids.get(contract)
        if sl_id:
            try:
                _gate_private_request(
                    "DELETE",
                    f"{GATE_FUTURES_PRICE_ORDERS_PATH}/{sl_id}",
                    api_key=api_key,
                    api_secret=api_secret,
                )
            except Exception:
                pass
        else:
            # No tracked SL ID — fetch conditional orders, cancel only the SL one
            try:
                cond_orders = self._fetch_conditional_orders()
                for co in cond_orders:
                    co_contract = str(co.get("initial", {}).get("contract", "") or co.get("contract", ""))
                    if co_contract != contract:
                        continue
                    trigger = float(co.get("trigger", {}).get("price", 0) or 0)
                    co_id = str(co.get("id", ""))
                    if not co_id or trigger <= 0:
                        continue
                    # Identify SL: for short, trigger > mark; for long, trigger < mark
                    is_sl = (trigger > target.mark_price) if target.side == "short" else (trigger < target.mark_price)
                    if is_sl:
                        try:
                            _gate_private_request(
                                "DELETE",
                                f"{GATE_FUTURES_PRICE_ORDERS_PATH}/{co_id}",
                                api_key=api_key,
                                api_secret=api_secret,
                            )
                        except Exception:
                            pass
                        break
            except Exception:
                pass

        # Place new SL
        try:
            sl_size = -target.qty if target.side == "long" else target.qty
            # Gate rule: 1 = price <= trigger
            # Long SL (price drops): trigger < mark, rule=1
            # Short SL (price rises): trigger > mark, rule=1
            sl_trigger = _round_price_tick(new_sl_price, contract)
            sl_body = json.dumps({
                "contract": contract,
                "initial": {
                    "contract": contract,
                    "size": sl_size,
                    "price": "0",
                    "tif": "ioc",
                    "reduce_only": True,
                },
                "trigger": {
                    "price": str(sl_trigger),
                    "rule": 1,
                },
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

    def _fetch_conditional_orders(self) -> list[dict[str, Any]]:
        """Fetch open conditional orders (SL/TP) from Gate."""
        try:
            api_key, api_secret = self._creds()
            resp = _gate_private_request(
                "GET",
                GATE_FUTURES_PRICE_ORDERS_PATH,
                api_key=api_key,
                api_secret=api_secret,
                query_string="status=open",
            )
            if isinstance(resp, list):
                return resp
        except Exception:
            pass
        return []

    def snapshot(self) -> dict[str, Any]:
        """Return current account + positions snapshot with computed fields."""
        self.sync_positions()
        # Fetch real account data for equity
        account_info: dict[str, Any] = {"equity": self.equity}
        raw_account: dict[str, Any] = {}
        try:
            api_key, api_secret = self._creds()
            raw_account = fetch_futures_account(api_key, api_secret)
            account_info = {
                "equity": float(raw_account.get("available", 0)) + float(raw_account.get("unrealised_pnl", 0)),
                "available_balance": float(raw_account.get("available", 0)),
                "margin_used": float(raw_account.get("position_margin", 0)) + float(raw_account.get("order_margin", 0)),
                "unrealized_pnl": float(raw_account.get("unrealised_pnl", 0)),
                "realized_pnl": 0,
            }
        except Exception:
            pass

        # Fetch conditional orders for SL/TP
        cond_orders = self._fetch_conditional_orders()
        sl_tp_by_contract: dict[str, dict[str, float]] = {}
        for co in cond_orders:
            contract = str(co.get("initial", {}).get("contract", "") or co.get("contract", ""))
            if not contract:
                continue
            trigger_price = float(co.get("trigger", {}).get("price", 0) or 0)
            if trigger_price <= 0:
                continue
            rule = int(co.get("trigger", {}).get("rule", 0) or 0)
            entry = sl_tp_by_contract.setdefault(contract, {})
            # rule=1: price <= trigger (SL for short, TP for short)
            # rule=2: price >= trigger (SL for long, TP for long)
            # Distinguish SL vs TP by comparing to mark price
            pos = next((p for p in self._positions if p.symbol == contract), None)
            if pos:
                if pos.side == "short":
                    # Short: SL is above price (trigger > mark), TP is below
                    if trigger_price > pos.mark_price:
                        entry["sl"] = trigger_price
                    else:
                        entry["tp"] = trigger_price
                else:
                    # Long: SL is below price (trigger < mark), TP is above
                    if trigger_price < pos.mark_price:
                        entry["sl"] = trigger_price
                    else:
                        entry["tp"] = trigger_price

        equity = account_info.get("equity", self.equity)

        # Build lookup from raw Gate position data
        raw_by_contract: dict[str, dict[str, Any]] = {}
        for rp in self._raw_positions:
            contract = str(rp.get("contract", ""))
            if contract:
                raw_by_contract[contract] = rp

        positions_out = []
        for p in self._positions:
            raw = raw_by_contract.get(p.symbol, {})
            notional = p.mark_price * p.qty
            # Use Gate's actual margin field (cross-margin real amount)
            initial_margin = abs(float(raw.get("margin", 0)))
            if initial_margin <= 0:
                initial_margin = notional / p.leverage if p.leverage > 0 else notional
            # Maintenance margin: initial_margin * maintenance_rate
            maint_rate = float(raw.get("maintenance_rate", 0.005))
            maintenance_margin = initial_margin * maint_rate
            # Unrealized PnL from Gate directly (already in USDT for quanto contracts)
            unrealized_pnl = float(raw.get("unrealised_pnl", 0))
            if unrealized_pnl == 0:
                quanto_multiplier = _get_quanto_multiplier(p.symbol)
                unrealized_pnl = (
                    (p.mark_price - p.entry_price) * p.qty * quanto_multiplier if p.side == "long"
                    else (p.entry_price - p.mark_price) * p.qty * quanto_multiplier
                )
            pnl_return_ratio = unrealized_pnl / initial_margin if initial_margin > 0 else 0
            # Liquidation price from Gate directly
            liq_price = float(raw.get("liq_price", 0))
            if liq_price <= 0 and p.leverage > 0:
                liq_price = (
                    p.entry_price * (1 - 1 / p.leverage) if p.side == "long"
                    else p.entry_price * (1 + 1 / p.leverage)
                )
            liq_distance = (
                abs(p.mark_price - liq_price) / p.mark_price if p.mark_price > 0 and liq_price > 0
                else 0
            )

            sl_tp = sl_tp_by_contract.get(p.symbol, {})
            positions_out.append({
                "position_id": p.position_id,
                "symbol": p.symbol,
                "side": p.side,
                "leverage": p.leverage,
                "qty": p.qty,
                "entry_price": p.entry_price,
                "mark_price": p.mark_price,
                "notional": notional,
                "initial_margin": initial_margin,
                "margin_used": initial_margin,
                "maintenance_margin": maintenance_margin,
                "unrealized_pnl": unrealized_pnl,
                "pnl_return_ratio": pnl_return_ratio,
                "liquidation_price": liq_price,
                "liquidation_distance_ratio": liq_distance,
                "stop_loss_price": sl_tp.get("sl"),
                "take_profit_price": sl_tp.get("tp"),
            })

        # Compute account-level aggregates
        total_notional = sum(p["notional"] for p in positions_out)
        margin_used_total = sum(p["initial_margin"] for p in positions_out)
        unrealized_total = sum(p["unrealized_pnl"] for p in positions_out)
        margin_ratio = margin_used_total / equity if equity > 0 else 0
        exposure_ratio = total_notional / equity if equity > 0 else 0
        account_info["margin_ratio"] = margin_ratio
        account_info["open_positions"] = len(positions_out)
        account_info["total_notional"] = total_notional
        account_info["exposure_ratio"] = exposure_ratio
        account_info["margin_used"] = margin_used_total
        account_info["unrealized_pnl"] = unrealized_total

        return {
            "account": account_info,
            "positions": positions_out,
            "orders": [o.__dict__ for o in self._orders[-20:]],
        }

    def reset(self) -> None:
        """Clear local cache (does NOT affect Gate positions)."""
        self._positions = []
        self._raw_positions = []
        self._orders = []
        self._sl_order_ids = {}
        self._sl_prices = {}
        self._tp_order_ids = {}
        self._tp_prices = {}
