from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta
import json
from typing import Any

from app.core.log_config import get_logger
from app.core.state import PAPER_BROKER, get_broker
from app.services.market_data import get_ohlcv, MarketDataUnavailableError
from app.services.notify_service import notify_guard_halt, notify_error, notify_open, notify_close
from app.services.runner_log_store import append_log, clear_logs, load_logs
from app.services.runner_risk_controls import apply_entry_risk_limits, evaluate_runner_guards
from app.services.runner_state_store import DEFAULT_RUNNER_STATE, load_runner_state, save_runner_state
from app.services.risk import (
    build_risk_sized_order,
    calc_stop_loss_price,
    calc_take_profit_price,
    validate_stop_loss_against_liquidation,
)
from app.services.strategy_store import load_strategy_config
from app.strategy.boll_rsi_ma import (
    apply_entry_filters as classic_apply_entry_filters,
    compute_indicators as classic_compute_indicators,
    generate_signal as classic_generate_signal,
)
from app.strategy.turtle import prepare_signals as turtle_prepare_signals
from app.strategy.ict import generate_signal as ict_generate_signal
from app.strategy.ifvg import generate_signal as ifvg_generate_signal
from app.strategy.macd_trend import (
    compute_indicators as macd_compute_indicators,
    prepare_signals as macd_prepare_signals,
)

logger = get_logger(__name__)

TIMEFRAME_SECONDS = {
    "5m": 300,
    "15m": 900,
    "30m": 1800,
    "1h": 3600,
    "4h": 14400,
}


def _apply_direction_mode(signal: str | None, direction_mode: str) -> tuple[str | None, dict[str, Any] | None]:
    if signal not in ('long', 'short'):
        return signal, None
    if direction_mode == 'long_only' and signal == 'short':
        return None, {'blocked_signal': signal, 'direction_mode': direction_mode}
    if direction_mode == 'short_only' and signal == 'long':
        return None, {'blocked_signal': signal, 'direction_mode': direction_mode}
    return signal, None


def _build_liquidation_guard_message(leverage: int, stop_loss_pct: float, liquidation_buffer_pct: float) -> str:
    return (
        f"当前 {leverage}x 杠杆下，估算强平缓冲仅 {liquidation_buffer_pct * 100:.2f}%，"
        f"但止损为 {stop_loss_pct * 100:.2f}%，会先强平后止损，请降低杠杆或缩小止损。"
    )


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
    signal = classic_apply_entry_filters(
        signal,
        last,
        trend_filter_enabled=bool(config.get("classic_trend_filter_enabled", False)),
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


def _run_macd_signal(config: dict[str, Any], df, last_row) -> tuple[str | None, dict[str, Any] | None]:
    """Run MACD trend/divergence strategy and return (signal, extra_meta)."""
    data = macd_prepare_signals(df, config)
    last = data.iloc[-1]
    raw_signal = last.get("signal")
    signal_source = last.get("signal_source")

    signal = raw_signal if raw_signal in ("long", "short") else None

    extra: dict[str, Any] = {"signal_source": signal_source}
    lookback = int(config.get("macd_breakout_lookback", 20))
    trailing_pct = float(config.get("macd_trailing_stop_pct", 2.0)) / 100.0

    if signal == "long":
        # best_price = 最高价（用于跟踪止损的锚点）
        best_price = float(df["high"].iloc[-lookback:].max())
        extra["best_price"] = best_price
        extra["stop_loss_price"] = best_price * (1 - trailing_pct)
    elif signal == "short":
        best_price = float(df["low"].iloc[-lookback:].min())
        extra["best_price"] = best_price
        extra["stop_loss_price"] = best_price * (1 + trailing_pct)

    return signal, extra


def _run_ifvg_signal(config: dict[str, Any], df, last_row) -> tuple[str | None, dict[str, Any] | None]:
    """Run IFVG strategy and return (signal, extra_meta)."""
    return ifvg_generate_signal(df, config)


def _compute_trailing_stop(
    config: dict[str, Any],
    df,
    existing,
) -> float | None:
    """Compute the dynamic trailing stop for a MACD trend position.

    Tracks best_price (highest high for long / lowest low for short) since entry.
    Applies a decay coefficient that tightens the trailing % as the position ages:
        effective_pct = trailing_pct * max(decay_floor, decay_base ^ bars_held)

    Only moves in the favorable direction (tightens, never loosens).
    """
    trailing_pct = float(config.get("macd_trailing_stop_pct", 2.0)) / 100.0
    decay_base = float(config.get("macd_trailing_decay_base", 0.98))
    decay_floor = float(config.get("macd_trailing_decay_floor", 0.3))
    entry_price = float(existing.entry_price)
    current_stop = getattr(existing, "stop_loss_price", None) or 0.0

    # ── Update best_price from latest candle ──
    best = getattr(existing, "best_price", 0.0) or 0.0
    bars_held = getattr(existing, "trailing_bars_held", 0) or 0

    last_high = float(df["high"].iloc[-1]) if len(df) > 0 else 0.0
    last_low = float(df["low"].iloc[-1]) if len(df) > 0 else 0.0

    if existing.side == "long":
        if best <= 0:
            best = float(df["high"].max())
        else:
            best = max(best, last_high)
    else:
        if best <= 0:
            best = float(df["low"].min())
        else:
            best = min(best, last_low)

    # Persist updated tracking fields on the position object
    existing.best_price = best
    existing.trailing_bars_held = bars_held + 1

    # ── Decay coefficient: trailing tightens over time ──
    decay = max(decay_floor, decay_base ** bars_held)
    effective_pct = trailing_pct * decay

    # ── Compute new stop ──
    if existing.side == "long":
        new_stop = best * (1 - effective_pct)
        # Breakeven floor: never below entry
        new_stop = max(new_stop, entry_price * 0.995)
        if current_stop > 0:
            new_stop = max(new_stop, current_stop)
        return new_stop
    else:
        new_stop = best * (1 + effective_pct)
        new_stop = min(new_stop, entry_price * 1.005)
        if current_stop > 0:
            new_stop = min(new_stop, current_stop)
        return new_stop


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


def _classic_entry_cooldown_guard(config: dict[str, Any], symbol: str, timeframe: str) -> dict[str, Any] | None:
    cooldown_bars = int(config.get("classic_cooldown_bars", 0) or 0)
    if cooldown_bars <= 0:
        return None

    cooldown_seconds = cooldown_bars * TIMEFRAME_SECONDS.get(str(timeframe), 900)
    if cooldown_seconds <= 0:
        return None

    now = datetime.utcnow()
    # 日志按时间追加保存，冷却判断必须以最近一次平仓为准。
    for entry in reversed(load_logs(limit=100)):
        result = entry.get("result")
        if not isinstance(result, dict):
            continue
        if result.get("symbol") != symbol or result.get("action") != "close":
            continue
        ts_raw = entry.get("ts") or entry.get("timestamp")
        if not ts_raw:
            continue
        try:
            closed_at = datetime.fromisoformat(str(ts_raw).replace("Z", "+00:00")).replace(tzinfo=None)
        except (TypeError, ValueError):
            continue
        elapsed = now - closed_at
        remaining = timedelta(seconds=cooldown_seconds) - elapsed
        if remaining.total_seconds() > 0:
            return {
                "blocked": True,
                "reason": "classic_entry_cooldown",
                "cooldown_bars": cooldown_bars,
                "remaining_seconds": round(remaining.total_seconds(), 3),
                "last_close_at": str(ts_raw),
            }
        return None
    return None



def _extract_position_targets(existing, stop_loss_pct: float, take_profit_pct: float, broker=None) -> tuple[float, float]:
    """Extract SL/TP prices. Priority: position field > order meta > recalculate."""
    # 1) Read directly from position (set at open time)
    pos_sl = getattr(existing, "stop_loss_price", None)
    pos_tp = getattr(existing, "take_profit_price", None)
    if pos_sl and pos_tp and pos_sl > 0 and pos_tp > 0:
        return float(pos_sl), float(pos_tp)

    # 2) Fallback: scan order meta
    if broker is None:
        broker = PAPER_BROKER
    open_order = next((order for order in reversed(broker.orders) if order.position_id == existing.position_id and order.event_type == "open"), None)
    if open_order and open_order.meta_json:
        try:
            open_meta = json.loads(open_order.meta_json)
            raw_sl = open_meta.get("stop_loss_price")
            raw_tp = open_meta.get("take_profit_price")
            if raw_sl is not None and raw_tp is not None:
                return float(raw_sl), float(raw_tp)
        except (TypeError, ValueError, json.JSONDecodeError):
            pass

    # 3) Last resort: recalculate from current pct config
    return (
        calc_stop_loss_price(existing.entry_price, existing.side, stop_loss_pct),
        calc_take_profit_price(existing.entry_price, existing.side, take_profit_pct),
    )


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
    broker: Any = None,
    trade_mode: str = "paper",
) -> dict[str, Any]:
    if broker is None:
        broker = PAPER_BROKER
    result = broker.close_position(
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
    pnl = result.get("pnl", 0)
    logger.info("[%s] close @ %s (reason=%s, pnl=%.2f)", symbol, trigger_price, close_reason, pnl)
    if trade_mode == "live" and result.get("ok"):
        notify_close(symbol, close_reason, trigger_price, 0, pnl, close_reason)
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
    if bool(config.get("dry_run")):
        return {**payload, "dry_run": True}
    append_log({"ts": datetime.utcnow().isoformat(), "config": config, "result": payload})
    state = load_runner_state()
    save_runner_state({
        **state,
        "is_running": state.get("enabled", False),
        "last_run_at": datetime.utcnow().isoformat(),
        "last_result": payload,
        "last_error": None,
        "last_config": config,
        "loop_count": state.get("loop_count", 0) + 1,
        "trade_mode": config.get("trade_mode", state.get("trade_mode", "paper")),
    })
    return payload


def _prefetch_symbol_data(symbol: str, strategy_type: str, data_source: str, timeframe: str) -> dict[str, Any] | None:
    """Pre-fetch market data for a single symbol. Returns data dict or None on failure."""
    try:
        if strategy_type == "ict":
            df_15m, market_meta = get_ohlcv(symbol, "15m", source=data_source)
            df_1h, _ = get_ohlcv(symbol, "1h", source=data_source)
            df_4h, _ = get_ohlcv(symbol, "4h", source=data_source)
            if df_15m.empty or df_1h.empty or df_4h.empty:
                return None
            return {"df_15m": df_15m, "df_1h": df_1h, "df_4h": df_4h, "market_meta": market_meta}
        else:
            df, market_meta = get_ohlcv(symbol, timeframe, source=data_source)
            if df.empty:
                return None
            return {"df": df, "market_meta": market_meta}
    except MarketDataUnavailableError:
        return None
    except Exception:
        return None


def run_strategy_cycle(config: dict[str, Any]) -> dict[str, Any]:
    state = load_runner_state()
    trade_mode = config.get("trade_mode", "paper")
    dry_run = bool(config.get("dry_run"))
    guard = evaluate_runner_guards(trade_mode=trade_mode)

    if not dry_run and state.get("manual_resume_required") and guard["allowed"]:
        state["manual_resume_required"] = False
        state["halt_reason"] = None
        state["last_error"] = None
        save_runner_state(state)

    if not guard["allowed"]:
        logger.warning("Runner halted: %s", guard["halt_reason"])
        payload = {"ok": False, "action": "halted", "reason": guard["halt_reason"], "guard": guard}
        if dry_run:
            return {**payload, "dry_run": True}
        append_log({"ts": datetime.utcnow().isoformat(), "config": config, "result": payload})
        notify_guard_halt(guard["halt_reason"], guard.get("consecutive_loss_count", 0))
        save_runner_state({
            **state,
            "last_run_at": datetime.utcnow().isoformat(),
            "last_result": payload,
            "last_error": None,
            "last_config": config,
            "halt_reason": guard["halt_reason"],
            "manual_resume_required": True,
            # 保持 enabled，让前端知道机器人是"被暂停"而不是"未启动"
            "is_running": False,
            "enabled": state.get("enabled", False),
        })
        return payload

    symbols = config.get("symbols") or [config.get("symbol", "BTC_USDT")]
    symbol = symbols[0]
    timeframe = config.get("timeframe", "15m")
    leverage = int(config.get("leverage", 5))
    allocated_margin = float(config.get("allocated_margin", 1000))
    risk_per_trade_pct = float(config.get("risk_per_trade_pct", 0.01))
    stop_loss_pct = float(config.get("stop_loss_pct", 0.02))
    take_profit_pct = float(config.get("take_profit_pct", 0.05))
    data_source = config.get("data_source", "gate")
    fee_rate = float(config.get("fee_rate", 0.00015))
    slippage_rate = float(config.get("slippage_rate", 0.0001))
    strategy_type = config.get("strategy_type", "classic")
    direction_mode = str(config.get("direction_mode", "auto"))
    broker = get_broker(trade_mode)

    # Sync live positions from exchange before each cycle (handles restart recovery)
    if trade_mode == "live":
        try:
            live_positions = broker.sync_positions()
            logger.info("[LIVE-SYNC] Synced %d positions from Gate.io", len(live_positions))
        except Exception as exc:
            logger.error("[LIVE-SYNC] Failed to sync positions: %s", exc)

    if not dry_run:
        save_runner_state({
            **state,
            "is_running": True,
            "enabled": state.get("enabled", False),  # run-once ??????????? runner
            "last_error": None,
            "last_config": config,
            "halt_reason": None,
            "selected_symbols": symbols,
            "trade_mode": trade_mode,
        })

    try:
        # Phase 1: Parallel data fetch for all symbols
        data_map: dict[str, dict[str, Any] | None] = {}
        if len(symbols) > 1:
            with ThreadPoolExecutor(max_workers=len(symbols)) as executor:
                futures = {
                    executor.submit(_prefetch_symbol_data, sym, strategy_type, data_source, timeframe): sym
                    for sym in symbols
                }
                for future in as_completed(futures, timeout=30):
                    sym = futures[future]
                    try:
                        data_map[sym] = future.result(timeout=15)
                    except Exception as exc:
                        logger.warning("[%s] Data prefetch failed: %s", sym, exc)
                        data_map[sym] = None
        else:
            data_map[symbols[0]] = _prefetch_symbol_data(symbols[0], strategy_type, data_source, timeframe)

        # Phase 2: Serial trade execution (broker operations are not thread-safe)
        per_symbol_results: list[dict[str, Any]] = []
        for current_symbol in symbols:
            symbol_config = {**config, "symbol": current_symbol}
            pre_fetched = data_map.get(current_symbol)
            if pre_fetched is None:
                per_symbol_results.append({
                    "ok": True,
                    "symbol": current_symbol,
                    "action": "skip_data_unavailable",
                    "reason": "prefetch_timeout_or_unavailable",
                    "guard": guard,
                    "market_data": {"requested_source": data_source, "actual_source": "unavailable"},
                })
                continue
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
                direction_mode=direction_mode,
                broker=broker,
                pre_fetched_data=pre_fetched,
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
        logger.error("Runner cycle error: %s", exc, exc_info=True)
        payload = {"ok": False, "action": "error", "reason": str(exc)}
        if dry_run:
            return {**payload, "dry_run": True}
        append_log({"ts": datetime.utcnow().isoformat(), "config": config, "result": payload})
        notify_error("runner_cycle", str(exc))
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
    direction_mode: str = 'auto',
    broker: Any = None,
    pre_fetched_data: dict[str, Any] | None = None,
) -> dict[str, Any]:
    if broker is None:
        broker = PAPER_BROKER
    trade_mode = config.get("trade_mode", "paper")
    dry_run = bool(config.get("dry_run"))

    # ---- ICT 策略：多 timeframe 数据拉取 ----
    if strategy_type == "ict":
        if pre_fetched_data:
            df_15m = pre_fetched_data["df_15m"]
            df_1h = pre_fetched_data["df_1h"]
            df_4h = pre_fetched_data["df_4h"]
            market_meta = pre_fetched_data.get("market_meta", {})
        else:
            try:
                df_15m, market_meta = get_ohlcv(symbol, "15m", source=data_source)
                df_1h, _ = get_ohlcv(symbol, "1h", source=data_source)
                df_4h, _ = get_ohlcv(symbol, "4h", source=data_source)
            except MarketDataUnavailableError as exc:
                logger.warning("[%s] Market data unavailable: %s", symbol, exc)
                return {
                    "ok": True,
                    "symbol": symbol,
                    "action": "skip_data_unavailable",
                    "reason": str(exc),
                    "guard": guard,
                    "market_data": {"requested_source": data_source, "actual_source": "unavailable"},
                }
            if df_15m.empty or df_1h.empty or df_4h.empty:
                return {"ok": False, "symbol": symbol, "reason": "no_market_data", "market_data": market_meta}

        last_row = df_15m.iloc[-1]
        price = float(last_row["close"])
        candle_high = float(last_row["high"])
        candle_low = float(last_row["low"])

        bos_lookback = int(config.get("ict_bos_lookback", 20))
        risk_reward = float(config.get("ict_risk_reward", 2.5))
        lookback_eng_bars = int(config.get("ict_lookback_eng_bars", 80))
        min_fvg_width_pct = float(config.get("ict_min_fvg_width_pct", 0.0))
        require_trend = bool(config.get("ict_require_trend", True))
        fvg_max_bars = int(config.get("ict_fvg_max_bars", 100))
        fvg_tolerance_pct = float(config.get("ict_fvg_tolerance_pct", 0.03))
        signal, extra_meta = ict_generate_signal(
            df_4h, df_1h, df_15m,
            bos_lookback=bos_lookback,
            risk_reward=risk_reward,
            lookback_eng_bars=lookback_eng_bars,
            min_fvg_width_pct=min_fvg_width_pct,
            require_trend=require_trend,
            fvg_max_bars=fvg_max_bars,
            fvg_tolerance_pct=fvg_tolerance_pct,
        )

    # ---- 经典 / 海龟：单 timeframe ----
    else:
        if pre_fetched_data:
            df = pre_fetched_data["df"]
            market_meta = pre_fetched_data.get("market_meta", {})
        else:
            try:
                df, market_meta = get_ohlcv(symbol, timeframe, source=data_source)
            except MarketDataUnavailableError as exc:
                logger.warning("[%s] Market data unavailable: %s", symbol, exc)
                return {
                    "ok": True,
                    "symbol": symbol,
                    "action": "skip_data_unavailable",
                    "reason": str(exc),
                    "guard": guard,
                    "market_data": {"requested_source": data_source, "actual_source": "unavailable"},
                }
            if df.empty:
                return {"ok": False, "symbol": symbol, "reason": "no_market_data", "market_data": market_meta}

        last_row = df.iloc[-1]
        price = float(last_row["close"])
        candle_high = float(last_row["high"])
        candle_low = float(last_row["low"])

        if strategy_type == "turtle":
            signal, extra_meta = _run_turtle_signal(config, df, last_row)
        elif strategy_type == "macd_trend":
            signal, extra_meta = _run_macd_signal(config, df, last_row)
        elif strategy_type == "ifvg":
            signal, extra_meta = _run_ifvg_signal(config, df, last_row)
        else:
            signal, extra_meta = _run_classic_signal(config, df, last_row)

    original_signal = signal
    signal, direction_guard = _apply_direction_mode(signal, direction_mode)
    if direction_guard is not None:
        return {
            'ok': True,
            'symbol': symbol,
            'action': 'skip_direction_mode',
            'reason': 'signal_blocked_by_direction_mode',
            'signal': original_signal,
            'price': price,
            'guard': guard,
            'market_data': market_meta,
            'direction_guard': direction_guard,
        }

    existing = next((p for p in broker.positions if p.symbol == symbol), None)

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
        if dry_run:
            return {
                "ok": True,
                "dry_run": True,
                "symbol": symbol,
                "action": "would_close",
                "close_reason": "reverse_signal",
                "signal": signal,
                "price": price,
                "existing_position": {
                    "side": existing.side,
                    "qty": getattr(existing, "qty", None),
                    "entry_price": getattr(existing, "entry_price", None),
                },
                "guard": guard,
                "market_data": market_meta,
            }
        close_result = broker.close_position(
            symbol, price, source="runner",
            meta={"runner": True, "strategy_type": strategy_type, "close_reason": "reverse_signal", "signal": signal},
        )
        if config.get("trade_mode") == "live" and close_result.get("ok"):
            notify_close(symbol, existing.side, close_result.get("execution_price", price), existing.qty, close_result.get("pnl", 0), "reverse_signal")
        existing = None

    if strategy_type == "turtle" and existing is not None:
        turtle_sig = (extra_meta or {}).get("turtle_signal")
        should_exit = (existing.side == "long" and turtle_sig == "exit_long") or (existing.side == "short" and turtle_sig == "exit_short")
        if should_exit:
            if dry_run:
                return {
                    "ok": True,
                    "dry_run": True,
                    "symbol": symbol,
                    "action": "would_close",
                    "close_reason": "turtle_exit",
                    "signal": turtle_sig,
                    "price": price,
                    "existing_position": {
                        "side": existing.side,
                        "qty": getattr(existing, "qty", None),
                        "entry_price": getattr(existing, "entry_price", None),
                    },
                    "guard": guard,
                    "market_data": market_meta,
                }
            result = broker.close_position(
                symbol, price, source="runner",
                meta={"runner": True, "strategy_type": strategy_type, "close_reason": "turtle_exit", "turtle_signal": turtle_sig},
            )
            if config.get("trade_mode") == "live" and result.get("ok"):
                notify_close(symbol, existing.side, result.get("execution_price", price), existing.qty, result.get("pnl", 0), "turtle_exit")
            return {
                "ok": True, "symbol": symbol, "action": "close", "close_reason": "turtle_exit",
                "signal": turtle_sig, "price": price, "result": result, "guard": guard, "market_data": market_meta,
            }

    if signal in ("long", "short") and existing is None:
        if strategy_type == "classic":
            cooldown_guard = _classic_entry_cooldown_guard(config, symbol, timeframe)
            if cooldown_guard:
                return {
                    "ok": True,
                    "symbol": symbol,
                    "action": "skip_entry_cooldown",
                    "reason": "classic_entry_cooldown",
                    "signal": signal,
                    "price": price,
                    "cooldown_guard": cooldown_guard,
                    "guard": guard,
                    "market_data": market_meta,
                }

        liquidation_guard = validate_stop_loss_against_liquidation(leverage, stop_loss_pct)
        if not liquidation_guard["ok"]:
            detail = _build_liquidation_guard_message(
                leverage=leverage,
                stop_loss_pct=stop_loss_pct,
                liquidation_buffer_pct=liquidation_guard["liquidation_buffer_pct"],
            )
            logger.warning("[%s] entry rejected by liquidation guard: %s", symbol, detail)
            return {
                "ok": True,
                "symbol": symbol,
                "action": "rejected",
                "signal": signal,
                "price": price,
                "result": {
                    "ok": False,
                    "reason": "stop_loss_after_liquidation",
                    "detail": detail,
                    "risk": liquidation_guard,
                },
                "guard": guard,
                "market_data": market_meta,
            }

        if strategy_type == "turtle" and extra_meta and extra_meta.get("atr", 0) > 0:
            atr = extra_meta["atr"]
            sl_mult = float(config.get("turtle_sl_atr_multiplier", 2.0))
            tp_mult = float(config.get("turtle_tp_atr_multiplier", 3.0))
            if signal == "long":
                sl_price = price - sl_mult * atr
                tp_price = price + tp_mult * atr
            else:
                sl_price = price + sl_mult * atr
                tp_price = price - tp_mult * atr
            sizing = build_risk_sized_order(
                side=signal, account_equity=broker.equity, entry_price=price,
                leverage=leverage, risk_per_trade_pct=risk_per_trade_pct,
                stop_loss_pct=stop_loss_pct, take_profit_pct=take_profit_pct,
                allocated_margin_cap=allocated_margin,
            )
            sizing["stop_loss_price"] = sl_price
            sizing["take_profit_price"] = tp_price
        elif strategy_type in ("ict", "ifvg") and extra_meta and extra_meta.get("stop_loss_price"):
            sl_price = extra_meta["stop_loss_price"]
            tp_price = extra_meta["take_profit_price"]
            sizing = build_risk_sized_order(
                side=signal, account_equity=broker.equity, entry_price=price,
                leverage=leverage, risk_per_trade_pct=risk_per_trade_pct,
                stop_loss_pct=stop_loss_pct, take_profit_pct=take_profit_pct,
                allocated_margin_cap=allocated_margin,
            )
            sizing["stop_loss_price"] = sl_price
            sizing["take_profit_price"] = tp_price
        elif strategy_type == "macd_trend" and extra_meta and extra_meta.get("stop_loss_price"):
            sl_price = extra_meta["stop_loss_price"]
            # No fixed take-profit — trailing stop handles exit
            tp_price = price * 100 if signal == "long" else price * 0.001
            sizing = build_risk_sized_order(
                side=signal, account_equity=broker.equity, entry_price=price,
                leverage=leverage, risk_per_trade_pct=risk_per_trade_pct,
                stop_loss_pct=stop_loss_pct, take_profit_pct=take_profit_pct,
                allocated_margin_cap=allocated_margin,
            )
            sizing["stop_loss_price"] = sl_price
            sizing["take_profit_price"] = tp_price
        else:
            sizing = build_risk_sized_order(
                side=signal, account_equity=broker.equity, entry_price=price,
                leverage=leverage, risk_per_trade_pct=risk_per_trade_pct,
                stop_loss_pct=stop_loss_pct, take_profit_pct=take_profit_pct,
                allocated_margin_cap=allocated_margin,
            )

        effective_allocated_margin = sizing["effective_allocated_margin"]
        entry_limit = apply_entry_risk_limits(
            broker=broker,
            symbol=symbol,
            leverage=leverage,
            requested_margin=effective_allocated_margin,
            entry_price=price,
        )
        if not entry_limit["allowed"]:
            logger.warning("[%s] entry rejected by entry risk limits: %s", symbol, entry_limit.get("reason"))
            return {
                "ok": True,
                "symbol": symbol,
                "action": "rejected",
                "signal": signal,
                "price": price,
                "result": {
                    "ok": False,
                    "reason": entry_limit.get("reason", "entry_risk_limit_rejected"),
                    "risk": entry_limit,
                },
                "guard": guard,
                "market_data": market_meta,
            }
        effective_allocated_margin = float(entry_limit["adjusted_margin"])
        if price > 0 and leverage > 0:
            sizing["qty"] = (effective_allocated_margin * leverage) / price
        explicit_qty = sizing["qty"]
        if dry_run:
            return {
                "ok": True,
                "dry_run": True,
                "symbol": symbol,
                "action": "would_open",
                "signal": signal,
                "price": price,
                "result": {
                    "ok": True,
                    "symbol": symbol,
                    "side": signal,
                    "qty": explicit_qty,
                    "leverage": leverage,
                    "allocated_margin": allocated_margin,
                    "effective_allocated_margin": effective_allocated_margin,
                    "stop_loss_price": sizing["stop_loss_price"],
                    "take_profit_price": sizing["take_profit_price"],
                    "entry_risk_limits": entry_limit,
                },
                "guard": guard,
                "market_data": market_meta,
            }
        result = broker.place_order(
            symbol=symbol, side=signal, price=price, leverage=leverage,
            allocated_margin=effective_allocated_margin,
            stop_loss_price=sizing["stop_loss_price"], source="runner",
            meta={
                "runner": True, "strategy_type": strategy_type, "sizing_mode": "risk",
                "timeframe": timeframe, "data_source": market_meta.get("actual_source"),
                "allocated_margin": allocated_margin,
                "effective_allocated_margin": effective_allocated_margin,
                "entry_risk_limits": entry_limit,
                "risk_per_trade_pct": risk_per_trade_pct, "explicit_qty": explicit_qty,
                "stop_loss_pct": stop_loss_pct, "stop_loss_price": sizing["stop_loss_price"],
                "take_profit_pct": take_profit_pct, "take_profit_price": sizing["take_profit_price"],
                **({"atr": extra_meta.get("atr"), "turtle_signal": extra_meta.get("turtle_signal")} if extra_meta and strategy_type == "turtle" else {}),
                **({"ict_signal": extra_meta.get("ict_signal"), "trend_4h": extra_meta.get("trend_4h"), "fvg_top": extra_meta.get("fvg_top"), "fvg_bottom": extra_meta.get("fvg_bottom")} if extra_meta and strategy_type == "ict" else {}),
                **({"ifvg_signal": extra_meta.get("ifvg_signal"), "ifvg_bias": extra_meta.get("ifvg_bias"), "ifvg_top": extra_meta.get("ifvg_top"), "ifvg_bottom": extra_meta.get("ifvg_bottom"), "ifvg_session": extra_meta.get("ifvg_session")} if extra_meta and strategy_type == "ifvg" else {}),
            },
            fee_rate=fee_rate, slippage_rate=slippage_rate,
            qty=explicit_qty if explicit_qty > 0 else None,
        )
        action = "open" if result.get("ok") else "rejected"
        logger.info("[%s] %s %s @ %s (margin=%.0f, sl=%.1f)", symbol, action, signal, price, effective_allocated_margin, sizing["stop_loss_price"])

        # MACD 趋势策略：开仓后初始化 best_price 跟踪
        if result.get("ok") and strategy_type == "macd_trend" and extra_meta and extra_meta.get("best_price"):
            new_pos = next((p for p in broker.positions if p.symbol == symbol), None)
            if new_pos is not None:
                new_pos.best_price = float(extra_meta["best_price"])
        if trade_mode == "live" and str(result.get("error", "")).startswith("stop_loss_order_failed"):
            halt_reason = "实盘止损挂单失败，系统已尝试保护性平仓，请人工确认后再恢复机器人"
            save_runner_state({
                **load_runner_state(),
                "is_running": False,
                "enabled": True,
                "manual_resume_required": True,
                "halt_reason": halt_reason,
                "last_error": result.get("error"),
            })
            notify_guard_halt(halt_reason, guard.get("consecutive_loss_count", 0))
        if config.get("trade_mode") == "live" and result.get("ok"):
            exec_price = result.get("execution_price_actual", price)
            notify_open(symbol, signal, exec_price, explicit_qty, leverage)
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
        mark_result = (
            {"ok": True, "symbol": symbol, "mark_price": price, "dry_run": True}
            if dry_run else
            broker.update_mark_price(
                symbol, price, source="runner",
                meta={"runner": True, "strategy_type": strategy_type, "signal": signal, "mark_price": price},
                persist=False,
            )
        )
        stop_loss_price, take_profit_price = _extract_position_targets(existing, stop_loss_pct, take_profit_pct, broker=broker)

        # MACD 趋势策略：动态跟踪止损
        if strategy_type == "macd_trend":
            trailing_stop = _compute_trailing_stop(config, df, existing)
            if trailing_stop is not None:
                stop_loss_price = trailing_stop
            # MACD 策略不使用固定止盈，用一个极值代替
            if existing.side == "long":
                take_profit_price = price * 100
            else:
                take_profit_price = price * 0.001
            # best_price/bars_held 已更新，需要持久化
            if not dry_run:
                broker._persist()

        # 实盘：同步更新交易所端止损单
        if not dry_run and trade_mode == "live" and stop_loss_price and stop_loss_price > 0:
            try:
                broker.update_stop_loss(symbol, stop_loss_price)
            except Exception:
                pass  # non-blocking

        close_reason, trigger_price = _resolve_exit_trigger(existing, stop_loss_price, take_profit_price, candle_high, candle_low)

        if close_reason and trigger_price is not None:
            if dry_run:
                return {
                    "ok": True,
                    "dry_run": True,
                    "symbol": symbol,
                    "action": "would_close",
                    "close_reason": close_reason,
                    "signal": signal,
                    "price": price,
                    "trigger_price": trigger_price,
                    "stop_loss_price": stop_loss_price,
                    "take_profit_price": take_profit_price,
                    "guard": guard,
                    "market_data": market_meta,
                }
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
                broker=broker,
                trade_mode=config.get("trade_mode", "paper"),
            )

        return {
            "ok": True, "symbol": symbol, "action": "would_mark" if dry_run else "mark", "signal": signal, "price": price,
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
    trade_mode = state.get("trade_mode", "paper")
    state["guard"] = evaluate_runner_guards(trade_mode=trade_mode)
    state["last_run_config"] = state.get("last_config")
    state["current_strategy_config"] = load_strategy_config(state.get("last_config") or {})
    if state.get("selected_symbols"):
        state["current_strategy_config"]["symbols"] = state["selected_symbols"]
        state["current_strategy_config"]["symbol"] = state["selected_symbols"][0]
    state["trade_mode"] = state.get("trade_mode", "paper")
    state["live_mark_observer"] = {
        "refresh_interval_seconds": 3,
        "last_refresh_at": state.get("last_live_mark_refresh_at"),
        "last_prices": state.get("last_live_mark_prices"),
        "last_error": state.get("last_live_mark_error"),
    }
    return state


def set_runner_enabled(enabled: bool, symbols: list[str] | None = None, trade_mode: str = "paper") -> dict[str, Any]:
    state = load_runner_state()
    state["enabled"] = enabled
    state["trade_mode"] = trade_mode
    if symbols is not None:
        state["selected_symbols"] = symbols
    if not enabled:
        state["next_run_eta"] = None
        state["is_running"] = False
        closed_positions: list[dict[str, Any]] = []
        # 实盘模式暂停时不平仓，只停止策略循环
        if trade_mode == "paper":
            broker = get_broker(trade_mode)
            for position in list(broker.positions):
                result = broker.close_position(
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


def reset_runner_runtime_state(*, clear_history_logs: bool = True, trade_mode: str = "paper") -> dict[str, Any]:
    next_state = {
        **DEFAULT_RUNNER_STATE,
        "trade_mode": trade_mode,
    }
    if clear_history_logs:
        clear_logs()
    return save_runner_state(next_state)
