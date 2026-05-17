from __future__ import annotations

import json
import threading
import time
from datetime import datetime, timezone
from typing import Any

from app.api.routes_strategy import StrategyConfig
from app.core.state import PAPER_BROKER
from app.services.gate_market_data import fetch_gate_futures_ticker
from app.services.runner_state_store import load_runner_state, save_runner_state
from app.services.strategy_runner import _extract_position_targets, run_strategy_cycle
from app.services.strategy_store import load_strategy_config

RUNNER_THREAD: threading.Thread | None = None
RUNNER_STOP = threading.Event()
MARK_REFRESH_SECONDS = 3
TIMEFRAME_SECONDS = {
    "5m": 300,
    "15m": 900,
    "30m": 1800,
    "1h": 3600,
    "4h": 14400,
}


def _build_runtime_config() -> dict[str, Any]:
    config = load_strategy_config(StrategyConfig().model_dump())
    config["data_source"] = "gate"
    state = load_runner_state()
    selected_symbols = state.get("selected_symbols")
    if selected_symbols:
        config["symbols"] = selected_symbols
        config["symbol"] = selected_symbols[0]
    return config


def _calc_next_run_eta(timeframe: str) -> float:
    seconds = TIMEFRAME_SECONDS.get(str(timeframe), 900)
    now = datetime.now(timezone.utc)
    epoch = int(now.timestamp())
    next_epoch = ((epoch // seconds) + 1) * seconds
    return float(next_epoch)


def _calc_last_closed_candle_eta(timeframe: str) -> float:
    seconds = TIMEFRAME_SECONDS.get(str(timeframe), 900)
    now = datetime.now(timezone.utc)
    epoch = int(now.timestamp())
    return float((epoch // seconds) * seconds)


def _resolve_live_mark_exit(position, mark_price: float, stop_loss_price: float, take_profit_price: float) -> tuple[str | None, float | None]:
    if position.side == "long":
        if mark_price <= stop_loss_price:
            return "stop_loss", mark_price
        if mark_price >= take_profit_price:
            return "take_profit", mark_price
        return None, None
    if mark_price >= stop_loss_price:
        return "stop_loss", mark_price
    if mark_price <= take_profit_price:
        return "take_profit", mark_price
    return None, None


def _extract_live_position_targets(position, stop_loss_pct: float, take_profit_pct: float) -> tuple[float, float]:
    open_order = next(
        (
            order
            for order in reversed(PAPER_BROKER.orders)
            if order.position_id == position.position_id and order.event_type == "open"
        ),
        None,
    )
    if open_order and open_order.meta_json:
        try:
            open_meta = json.loads(open_order.meta_json)
            raw_stop_loss = open_meta.get("stop_loss_price")
            raw_take_profit = open_meta.get("take_profit_price")
            if raw_stop_loss is not None and raw_take_profit is not None:
                return float(raw_stop_loss), float(raw_take_profit)
        except (TypeError, ValueError, json.JSONDecodeError):
            pass
    return _extract_position_targets(position, stop_loss_pct, take_profit_pct)


def _refresh_open_position_marks() -> dict[str, float]:
    positions = list(PAPER_BROKER.positions)
    if not positions:
        return {}

    state = load_runner_state()
    last_config = state.get("last_config") or {}
    stop_loss_pct = float(last_config.get("stop_loss_pct", 0.02))
    take_profit_pct = float(last_config.get("take_profit_pct", 0.04))
    refreshed_symbols: set[str] = set()
    refreshed_prices: dict[str, float] = {}
    for position in positions:
        symbol = position.symbol
        if symbol in refreshed_symbols:
            continue
        ticker = fetch_gate_futures_ticker(symbol)
        mark_price = float(ticker.get("mark_price") or ticker.get("last_price") or 0)
        if mark_price <= 0:
            continue
        PAPER_BROKER.update_mark_price(
            symbol,
            mark_price,
            source="runner",
            meta={
                "runner": True,
                "refresh_mode": "live_mark",
                "mark_price": mark_price,
                "ticker_last_price": ticker.get("last_price"),
                "ticker_index_price": ticker.get("index_price"),
            },
            persist=False,
        )
        refreshed_symbols.add(symbol)
        refreshed_prices[symbol] = mark_price

        symbol_positions = [item for item in list(PAPER_BROKER.positions) if item.symbol == symbol]
        for live_position in symbol_positions:
            stop_loss_price, take_profit_price = _extract_live_position_targets(live_position, stop_loss_pct, take_profit_pct)
            close_reason, trigger_price = _resolve_live_mark_exit(live_position, mark_price, stop_loss_price, take_profit_price)
            if close_reason is None or trigger_price is None:
                continue
            PAPER_BROKER.close_position(
                symbol,
                trigger_price,
                source="runner",
                meta={
                    "runner": True,
                    "refresh_mode": "live_mark",
                    "close_reason": close_reason,
                    "stop_loss_price": stop_loss_price,
                    "take_profit_price": take_profit_price,
                    "trigger_price": trigger_price,
                    "trigger_basis": "live_mark",
                    "ticker_last_price": ticker.get("last_price"),
                    "ticker_index_price": ticker.get("index_price"),
                    "position_id": live_position.position_id,
                },
                position_id=live_position.position_id,
            )
    return refreshed_prices


def _maybe_refresh_live_marks(state: dict[str, Any], now_ts: float) -> None:
    if not state.get("enabled", False):
        return
    if not PAPER_BROKER.positions:
        return

    last_mark_refresh_at = float(state.get("last_mark_refresh_at") or 0)
    if now_ts - last_mark_refresh_at < MARK_REFRESH_SECONDS:
        return

    try:
        refreshed_prices = _refresh_open_position_marks()
        save_runner_state({
            **load_runner_state(),
            "last_mark_refresh_at": now_ts,
            "last_live_mark_refresh_at": datetime.now(timezone.utc).isoformat(),
            "last_live_mark_prices": refreshed_prices,
            "last_live_mark_error": None,
        })
    except Exception as exc:
        save_runner_state({
            **load_runner_state(),
            "last_live_mark_refresh_at": datetime.now(timezone.utc).isoformat(),
            "last_live_mark_error": str(exc),
        })
        # 实时盯市失败不打断主调度循环。
        pass


def _loop() -> None:
    while not RUNNER_STOP.is_set():
        state = load_runner_state()
        now_ts = datetime.now(timezone.utc).timestamp()
        _maybe_refresh_live_marks(state, now_ts)

        if not state.get("enabled", False):
            save_runner_state({**state, "is_running": False, "next_run_eta": None})
            time.sleep(2)
            continue

        config = _build_runtime_config()
        timeframe = str(config.get("timeframe", "15m"))
        next_run_eta = _calc_next_run_eta(timeframe)
        candle_eta = _calc_last_closed_candle_eta(timeframe)
        last_executed_candle_eta = state.get("last_executed_candle_eta")

        if last_executed_candle_eta == candle_eta:
            save_runner_state({**state, "is_running": False, "last_config": config, "next_run_eta": next_run_eta})
            time.sleep(min(max(int(next_run_eta - now_ts), 1), 5))
            continue

        if now_ts < next_run_eta - 1:
            save_runner_state({**state, "is_running": False, "last_config": config, "next_run_eta": next_run_eta})
            wait_seconds = min(max(int(next_run_eta - now_ts), 1), 5)
            time.sleep(wait_seconds)
            continue

        save_runner_state({
            **state,
            "is_running": True,
            "last_config": config,
            "next_run_eta": next_run_eta,
            "last_executed_candle_eta": candle_eta,
        })
        run_strategy_cycle(config)

        fresh_state = load_runner_state()
        next_eta = _calc_next_run_eta(timeframe)
        save_runner_state({
            **fresh_state,
            "is_running": False,
            "next_run_eta": next_eta,
        })
        time.sleep(1)


def ensure_scheduler_started() -> None:
    global RUNNER_THREAD
    if RUNNER_THREAD and RUNNER_THREAD.is_alive():
        return
    RUNNER_STOP.clear()
    RUNNER_THREAD = threading.Thread(target=_loop, name="quant-gate-runner", daemon=True)
    RUNNER_THREAD.start()


def stop_scheduler() -> None:
    RUNNER_STOP.set()
