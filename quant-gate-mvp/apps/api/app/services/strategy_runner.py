from __future__ import annotations

from datetime import datetime
import json
from typing import Any

from app.core.state import PAPER_BROKER
from app.services.market_data import get_ohlcv
from app.services.runner_log_store import append_log, load_logs
from app.services.runner_risk_controls import evaluate_runner_guards
from app.services.runner_state_store import load_runner_state, save_runner_state
from app.services.risk import build_risk_sized_order, calc_stop_loss_price, calc_take_profit_price
from app.services.strategy_store import load_strategy_config
from app.strategy.boll_rsi_ma import compute_indicators as classic_compute_indicators, generate_signal as classic_generate_signal
from app.strategy.turtle import prepare_signals as turtle_prepare_signals


def _run_classic_signal(config: dict[str, Any], df, last_row) -> tuple[str | None, dict[str, Any] | None]:
    """Run classic strategy and return (signal, extra_meta)."""
    ind = classic_compute_indicators(
        df,
        boll_period=int(config.get("boll_period", 20)),
        boll_std=float(config.get("boll_std", 2.0)),
        rsi_period=int(config.get("rsi_period", 14)),
        ma_short=int(config.get("ma_short", 9)),
        ma_long=int(config.get("ma_long", 21)),
        macd_fast=int(config.get("macd_fast", 12)),
        macd_slow=int(config.get("macd_slow", 26)),
        macd_signal=int(config.get("macd_signal", 9)),
        kdj_period=int(config.get("kdj_period", 9)),
        kdj_signal_period=int(config.get("kdj_signal_period", 3)),
    )
    last = ind.iloc[-1]
    signal = classic_generate_signal(
        last,
        rsi_oversold=float(config.get("rsi_oversold", 30)),
        rsi_overbought=float(config.get("rsi_overbought", 70)),
        use_boll=bool(config.get("use_boll", True)),
        use_rsi=bool(config.get("use_rsi", True)),
        use_ma=bool(config.get("use_ma", True)),
        use_macd=bool(config.get("use_macd", False)),
        use_kdj=bool(config.get("use_kdj", False)),
        kdj_overbought=float(config.get("kdj_overbought", 80)),
        kdj_oversold=float(config.get("kdj_oversold", 20)),
        min_signal_score=int(config.get("min_signal_score", 3)),
    )
    return signal, None


def _run_turtle_signal(config: dict[str, Any], df, last_row) -> tuple[str | None, dict[str, Any] | None]:
    """Run turtle strategy and return (signal, extra_meta)."""
    data = turtle_prepare_signals(df, config)
    last = data.iloc[-1]
    raw_signal = last.get("signal")
    atr = float(last["atr"]) if not (last.get("atr") is None or str(last.get("atr")) == "nan") else 0.0
    regime = last.get("regime", "turtle")
    adx = float(last["adx"]) if not (last.get("adx") is None or str(last.get("adx")) == "nan") else 0.0
    rsi = float(last["rsi"]) if not (last.get("rsi") is None or str(last.get("rsi")) == "nan") else 0.0

    signal = None
    if raw_signal in ("long", "short"):
        signal = raw_signal
    elif raw_signal in ("exit_long", "exit_short"):
        signal = raw_signal

    extra = {"atr": atr, "turtle_signal": raw_signal, "regime": regime, "adx": adx, "rsi": rsi}
    return signal, extra


def _should_block_reverse_signal(config: dict[str, Any], existing, signal: str | None, price: float) -> bool:
    if not bool(config.get("churn_guard_enabled", False)):
        return False
    if existing is None or signal not in ("long", "short"):
        return False
    if existing.side == signal:
        return False
    if existing.entry_price <= 0:
        return False

    move_ratio = abs(price - existing.entry_price) / existing.entry_price
    stop_loss_pct = max(float(config.get("stop_loss_pct", 0.02) or 0.02), 0.0)
    threshold = max(stop_loss_pct * 0.5, 0.002)
    return move_ratio < threshold



def _extract_position_targets(existing, stop_loss_pct: float, take_profit_pct: float) -> tuple[float, float]:
    stop_loss_price = None
    take_profit_price = None
    open_order = next((order for order in reversed(PAPER_BROKER.orders) if order.position_id == existing.position_id and order.event_type == "open"), None)
    if open_order and open_order.meta_json:
        try:
            open_meta = json.loads(open_order.meta_json)
            raw_stop_loss = open_meta.get("stop_loss_price")
            raw_take_profit = open_meta.get("take_profit_price")
            if raw_stop_loss is not None:
                stop_loss_price = float(raw_stop_loss)
            if raw_take_profit is not None:
                take_profit_price = float(raw_take_profit)
        except (TypeError, ValueError, json.JSONDecodeError):
            stop_loss_price = None
            take_profit_price = None
    if stop_loss_price is None:
        stop_loss_price = calc_stop_loss_price(existing.entry_price, existing.side, stop_loss_pct)
    if take_profit_price is None:
        take_profit_price = calc_take_profit_price(existing.entry_price, existing.side, take_profit_pct)
    return stop_loss_price, take_profit_price


def _resolve_exit_trigger(existing, stop_loss_price: float, take_profit_price: float, candle_high: float, candle_low: float) -> tuple[str | None, float | None]:
    if existing.side == "long":
        if candle_low <= stop_loss_price:
            return "stop_loss", stop_loss_price
        if candle_high >= take_profit_price:
            return "take_profit", take_profit_price
        return None, None
    if candle_high >= stop_loss_price:
        return "stop_loss", stop_loss_price
    if candle_low <= take_profit_price:
        return "take_profit", take_profit_price
    return None, None


def _close_position_from_trigger(
    *,
    symbol: str,
    strategy_type: str,
    close_reason: str,
    trigger_price: float,
    stop_loss_price: float,
    take_profit_price: float,
    signal: str | None,
    price: float,
    guard: dict[str, Any],
    market_meta: dict[str, Any],
    candle_high: float,
    candle_low: float,
) -> dict[str, Any]:
    result = PAPER_BROKER.close_position(
        symbol,
        trigger_price,
        source="runner",
        meta={
            "runner": True,
            "strategy_type": strategy_type,
            "close_reason": close_reason,
            "stop_loss_price": stop_loss_price,
            "take_profit_price": take_profit_price,
            "trigger_price": trigger_price,
            "trigger_candle_high": candle_high,
            "trigger_candle_low": candle_low,
            "trigger_basis": "candle_range",
        },
    )
    return {
        "ok": True,
        "symbol": symbol,
        "action": "close",
        "close_reason": close_reason,
        "signal": signal,
        "price": price,
        "trigger_price": trigger_price,
        "result": result,
        "guard": guard,
        "market_data": market_meta,
    }


def _save_and_return(config: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any]:
    append_log({"ts": datetime.utcnow().isoformat(), "config": config, "result": payload})
    state = load_runner_state()
    save_runner_state({
        **state,
        "is_running": state.get("enabled", False),  # 如果 enabled 则保持 is_running
        "last_run_at": datetime.utcnow().isoformat(),
        "last_result": payload,
        "last_error": None,
        "last_config": config,
        "loop_count": state.get("loop_count", 0) + 1,
    })
    return payload


def run_strategy_cycle(config: dict[str, Any]) -> dict[str, Any]:
    state = load_runner_state()
    guard = evaluate_runner_guards()

    if state.get("manual_resume_required") and guard["allowed"]:
        state["manual_resume_required"] = False
        state["halt_reason"] = None
        state["last_error"] = None
        save_runner_state(state)

    if not guard["allowed"]:
        payload = {"ok": False, "action": "halted", "reason": guard["halt_reason"], "guard": guard}
        append_log({"ts": datetime.utcnow().isoformat(), "config": config, "result": payload})
        save_runner_state({
            **state,
            "last_run_at": datetime.utcnow().isoformat(),
            "last_result": payload,
            "last_error": None,
            "last_config": config,
            "halt_reason": guard["halt_reason"],
            "manual_resume_required": True,
            # 保持 enabled，让前端知道机器人是“被暂停”而不是“未启动”
            "is_running": False,
            "enabled": True,
        })
        return payload

    symbols = config.get("symbols") or [config.get("symbol", "BTC_USDT")]
    symbol = symbols[0]
    timeframe = config.get("timeframe", "15m")
    leverage = int(config.get("leverage", 5))
    allocated_margin = float(config.get("allocated_margin", 1000))
    risk_per_trade_pct = float(config.get("risk_per_trade_pct", 0.01))
    stop_loss_pct = float(config.get("stop_loss_pct", 0.02))
    take_profit_pct = float(config.get("take_profit_pct", 0.04))
    data_source = config.get("data_source", "gate")
    fee_rate = float(config.get("fee_rate", 0.00015))
    slippage_rate = float(config.get("slippage_rate", 0.0001))
    strategy_type = config.get("strategy_type", "classic")

    save_runner_state({
        **state,
        "is_running": True,
        "enabled": True,  # run-once 时自动启用 runner
        "last_error": None,
        "last_config": config,
        "halt_reason": None,
        "selected_symbols": symbols,
    })

    try:
        per_symbol_results: list[dict[str, Any]] = []
        for current_symbol in symbols:
            symbol_config = {**config, "symbol": current_symbol}
            result = _run_single_symbol_cycle(
                symbol=current_symbol,
                config=symbol_config,
                guard=guard,
                timeframe=timeframe,
                leverage=leverage,
                allocated_margin=allocated_margin,
                risk_per_trade_pct=risk_per_trade_pct,
                stop_loss_pct=stop_loss_pct,
                take_profit_pct=take_profit_pct,
                data_source=data_source,
                fee_rate=fee_rate,
                slippage_rate=slippage_rate,
                strategy_type=strategy_type,
            )
            per_symbol_results.append(result)

        if len(per_symbol_results) == 1:
            return _save_and_return(config, per_symbol_results[0])

        actions = [item.get("action") for item in per_symbol_results if item.get("action")]
        payload = {
            "ok": True,
            "action": "multi_symbol_cycle",
            "symbols": symbols,
            "results": per_symbol_results,
            "summary": " / ".join(f"{item.get('symbol')}: {item.get('action')}" for item in per_symbol_results),
            "guard": guard,
            "actions": actions,
        }
        return _save_and_return(config, payload)

    except Exception as exc:
        payload = {"ok": False, "action": "error", "reason": str(exc)}
        append_log({"ts": datetime.utcnow().isoformat(), "config": config, "result": payload})
        save_runner_state({
            **load_runner_state(),
            "is_running": False,
            "last_run_at": datetime.utcnow().isoformat(),
            "last_result": payload,
            "last_error": str(exc),
            "loop_count": load_runner_state().get("loop_count", 0) + 1,
        })
        return payload


def _run_single_symbol_cycle(
    *,
    symbol: str,
    config: dict[str, Any],
    guard: dict[str, Any],
    timeframe: str,
    leverage: int,
    allocated_margin: float,
    risk_per_trade_pct: float,
    stop_loss_pct: float,
    take_profit_pct: float,
    data_source: str,
    fee_rate: float,
    slippage_rate: float,
    strategy_type: str,
) -> dict[str, Any]:
    df, market_meta = get_ohlcv(symbol, timeframe, source=data_source)
    if df.empty:
        return {"ok": False, "symbol": symbol, "reason": "no_market_data", "market_data": market_meta}

    last_row = df.iloc[-1]
    price = float(last_row["close"])
    candle_high = float(last_row["high"])
    candle_low = float(last_row["low"])

    if strategy_type == "turtle":
        signal, extra_meta = _run_turtle_signal(config, df, last_row)
    else:
        signal, extra_meta = _run_classic_signal(config, df, last_row)

    existing = next((p for p in PAPER_BROKER.positions if p.symbol == symbol), None)
    market_fallback_used = (
        str(data_source) == "gate"
        and (
            bool(market_meta.get("fallback_used"))
            or str(market_meta.get("actual_source") or "") != "gate"
        )
    )

    if market_fallback_used and existing is not None:
        return {
            "ok": True,
            "symbol": symbol,
            "action": "skip_fallback_market",
            "reason": "market_data_fallback_with_open_position",
            "signal": signal,
            "price": price,
            "guard": guard,
            "market_data": market_meta,
        }

    if market_fallback_used and existing is None:
        return {
            "ok": True,
            "symbol": symbol,
            "action": "skip_fallback_entry",
            "reason": "market_data_fallback_new_entry_blocked",
            "signal": signal,
            "price": price,
            "guard": guard,
            "market_data": market_meta,
        }

    if existing is not None and signal in ("long", "short") and existing.side != signal:
        if _should_block_reverse_signal(config, existing, signal, price):
            move_ratio = abs(price - existing.entry_price) / existing.entry_price if existing.entry_price > 0 else 0.0
            threshold = max(float(config.get("stop_loss_pct", 0.02) or 0.02) * 0.5, 0.002)
            return {
                "ok": True,
                "symbol": symbol,
                "action": "skip_reverse_churn_guard",
                "reason": "reverse_signal_blocked_by_churn_guard",
                "signal": signal,
                "price": price,
                "guard": guard,
                "market_data": market_meta,
                "churn_guard": {
                    "enabled": True,
                    "move_ratio": move_ratio,
                    "threshold": threshold,
                },
            }
        PAPER_BROKER.close_position(
            symbol, price, source="runner",
            meta={"runner": True, "strategy_type": strategy_type, "close_reason": "reverse_signal", "signal": signal},
        )
        existing = None

    if strategy_type == "turtle" and existing is not None:
        turtle_sig = (extra_meta or {}).get("turtle_signal")
        should_exit = (existing.side == "long" and turtle_sig == "exit_long") or (existing.side == "short" and turtle_sig == "exit_short")
        if should_exit:
            result = PAPER_BROKER.close_position(
                symbol, price, source="runner",
                meta={"runner": True, "strategy_type": strategy_type, "close_reason": "turtle_exit", "turtle_signal": turtle_sig},
            )
            return {
                "ok": True, "symbol": symbol, "action": "close", "close_reason": "turtle_exit",
                "signal": turtle_sig, "price": price, "result": result, "guard": guard, "market_data": market_meta,
            }

    if signal in ("long", "short") and existing is None:
        if strategy_type == "turtle" and extra_meta and extra_meta.get("atr", 0) > 0:
            atr = extra_meta["atr"]
            if signal == "long":
                sl_price = price - 2 * atr
                tp_price = price + 3 * atr
            else:
                sl_price = price + 2 * atr
                tp_price = price - 3 * atr
            sizing = build_risk_sized_order(
                side=signal, account_equity=PAPER_BROKER.equity, entry_price=price,
                leverage=leverage, risk_per_trade_pct=risk_per_trade_pct,
                stop_loss_pct=stop_loss_pct, take_profit_pct=take_profit_pct,
                allocated_margin_cap=allocated_margin,
            )
            sizing["stop_loss_price"] = sl_price
            sizing["take_profit_price"] = tp_price
        else:
            sizing = build_risk_sized_order(
                side=signal, account_equity=PAPER_BROKER.equity, entry_price=price,
                leverage=leverage, risk_per_trade_pct=risk_per_trade_pct,
                stop_loss_pct=stop_loss_pct, take_profit_pct=take_profit_pct,
                allocated_margin_cap=allocated_margin,
            )

        effective_allocated_margin = sizing["effective_allocated_margin"]
        explicit_qty = sizing["qty"]
        result = PAPER_BROKER.place_order(
            symbol=symbol, side=signal, price=price, leverage=leverage,
            allocated_margin=effective_allocated_margin,
            stop_loss_price=sizing["stop_loss_price"], source="runner",
            meta={
                "runner": True, "strategy_type": strategy_type, "sizing_mode": "risk",
                "timeframe": timeframe, "data_source": market_meta.get("actual_source"),
                "allocated_margin": allocated_margin,
                "effective_allocated_margin": effective_allocated_margin,
                "risk_per_trade_pct": risk_per_trade_pct, "explicit_qty": explicit_qty,
                "stop_loss_pct": stop_loss_pct, "stop_loss_price": sizing["stop_loss_price"],
                "take_profit_pct": take_profit_pct, "take_profit_price": sizing["take_profit_price"],
                **({"atr": extra_meta.get("atr"), "turtle_signal": extra_meta.get("turtle_signal")} if extra_meta else {}),
            },
            fee_rate=fee_rate, slippage_rate=slippage_rate,
            qty=explicit_qty if explicit_qty > 0 else None,
        )
        action = "open" if result.get("ok") else "rejected"
        return {
            "ok": True, "symbol": symbol, "action": action, "signal": signal, "price": price,
            "result": result, "guard": guard, "market_data": market_meta,
        }

    if signal in ("long", "short") and existing is not None and existing.side == signal:
        return {
            "ok": True, "symbol": symbol, "action": "skip_same_side", "signal": signal, "price": price,
            "guard": guard, "market_data": market_meta,
        }

    if existing is not None:
        mark_result = PAPER_BROKER.update_mark_price(
            symbol, price, source="runner",
            meta={"runner": True, "strategy_type": strategy_type, "signal": signal, "mark_price": price},
            persist=False,
        )
        stop_loss_price, take_profit_price = _extract_position_targets(existing, stop_loss_pct, take_profit_pct)
        close_reason, trigger_price = _resolve_exit_trigger(existing, stop_loss_price, take_profit_price, candle_high, candle_low)

        if close_reason and trigger_price is not None:
            return _close_position_from_trigger(
                symbol=symbol,
                strategy_type=strategy_type,
                close_reason=close_reason,
                trigger_price=trigger_price,
                stop_loss_price=stop_loss_price,
                take_profit_price=take_profit_price,
                signal=signal,
                price=price,
                guard=guard,
                market_meta=market_meta,
                candle_high=candle_high,
                candle_low=candle_low,
            )

        return {
            "ok": True, "symbol": symbol, "action": "mark", "signal": signal, "price": price,
            "result": mark_result, "guard": guard, "market_data": market_meta,
        }

    return {
        "ok": True, "symbol": symbol, "action": "idle", "signal": signal, "price": price,
        "guard": guard, "market_data": market_meta,
    }


def get_runner_logs() -> list[dict[str, Any]]:
    return load_logs()


def get_runner_status() -> dict[str, Any]:
    state = load_runner_state()
    state["guard"] = evaluate_runner_guards()
    state["last_run_config"] = state.get("last_config")
    state["current_strategy_config"] = load_strategy_config(state.get("last_config") or {})
    if state.get("selected_symbols"):
        state["current_strategy_config"]["symbols"] = state["selected_symbols"]
        state["current_strategy_config"]["symbol"] = state["selected_symbols"][0]
    state["live_mark_observer"] = {
        "refresh_interval_seconds": 3,
        "last_refresh_at": state.get("last_live_mark_refresh_at"),
        "last_prices": state.get("last_live_mark_prices"),
        "last_error": state.get("last_live_mark_error"),
    }
    return state


def set_runner_enabled(enabled: bool, symbols: list[str] | None = None) -> dict[str, Any]:
    state = load_runner_state()
    state["enabled"] = enabled
    if symbols is not None:
        state["selected_symbols"] = symbols
    if not enabled:
        state["next_run_eta"] = None
        state["is_running"] = False
        closed_positions: list[dict[str, Any]] = []
        for position in list(PAPER_BROKER.positions):
            result = PAPER_BROKER.close_position(
                position.symbol,
                position.mark_price,
                source="runner",
                meta={
                    "runner": True,
                    "close_reason": "runner_paused",
                    "trigger_basis": "manual_pause",
                    "position_id": position.position_id,
                },
                position_id=position.position_id,
            )
            if result.get("ok"):
                closed_positions.append({
                    "position_id": position.position_id,
                    "symbol": position.symbol,
                    "side": position.side,
                    "requested_price": position.mark_price,
                    "execution_price": result.get("execution_price"),
                })
        state["last_pause_closed_positions"] = closed_positions
    return save_runner_state(state)


def resume_runner() -> dict[str, Any]:
    state = load_runner_state()
    state["manual_resume_required"] = False
    state["halt_reason"] = None
    state["last_error"] = None
    return save_runner_state(state)
