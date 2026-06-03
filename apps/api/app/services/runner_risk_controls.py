from __future__ import annotations

import os
from datetime import datetime, timedelta
from typing import Any

from app.core.log_config import get_logger
from app.core.settings import SETTINGS
from app.core.state import PAPER_BROKER, LIVE_BROKER
from app.services.runner_log_store import load_logs

logger = get_logger(__name__)


def _extract_pnl(entry: dict[str, Any]) -> float | None:
    """Extract pnl from a log entry, trying multiple known formats."""
    result = entry.get("result")
    if not isinstance(result, dict):
        return None

    # Format 1: action=close → result.result.pnl (broker close result)
    nested = result.get("result")
    if isinstance(nested, dict):
        pnl = nested.get("pnl")
        if pnl is not None:
            try:
                return float(pnl)
            except (TypeError, ValueError):
                pass

    # Format 2: pnl directly on the result dict
    pnl = result.get("pnl")
    if pnl is not None:
        try:
            return float(pnl)
        except (TypeError, ValueError):
            pass

    return None


def _is_trade_entry(entry: dict[str, Any]) -> bool:
    """Check if a log entry represents an actual trade (open/close), not a skip/idle/halt."""
    result = entry.get("result")
    if not isinstance(result, dict):
        return False
    action = result.get("action")
    return action in ("close", "open", "open_long", "open_short")


def evaluate_runner_guards(trade_mode: str = "paper") -> dict[str, Any]:
    broker = LIVE_BROKER if trade_mode == "live" else PAPER_BROKER
    logs = load_logs(limit=500)

    max_consec = int(os.environ.get("MAX_CONSECUTIVE_LOSSES", SETTINGS.max_consecutive_losses))
    max_daily_loss_ratio = float(os.environ.get("MAX_DAILY_LOSS_RATIO", SETTINGS.max_daily_loss_ratio))
    max_exposure = float(os.environ.get("MAX_TOTAL_EXPOSURE_RATIO", SETTINGS.max_total_exposure_ratio))
    max_dd = float(os.environ.get("MAX_DRAWDOWN_HALT_RATIO", SETTINGS.max_drawdown_halt_ratio))
    max_per_hour = int(os.environ.get("MAX_TRADES_PER_HOUR", SETTINGS.max_trades_per_hour))
    max_per_day = int(os.environ.get("MAX_TRADES_PER_DAY", SETTINGS.max_trades_per_day))

    # 连续亏损
    consec = 0
    trade_entries = [e for e in logs if _is_trade_entry(e)]
    for e in trade_entries:
        pnl = _extract_pnl(e)
        if pnl is None:
            break
        if pnl < 0:
            consec += 1
        else:
            break

    # 日内已实现盈亏
    today = datetime.utcnow().date()
    daily_pnl = 0.0
    for e in trade_entries:
        ts = e.get("ts") or e.get("timestamp")
        if ts:
            try:
                d = datetime.fromisoformat(str(ts)).date()
                if d != today:
                    continue
            except (ValueError, TypeError):
                continue
        pnl = _extract_pnl(e)
        if pnl is not None:
            daily_pnl += pnl

    initial = broker.get("initial_balance", 1000) if isinstance(broker, dict) else getattr(broker, "initial_balance", 1000)
    equity = broker.get("equity", initial) if isinstance(broker, dict) else getattr(broker, "equity", initial)
    if initial <= 0:
        initial = 1000

    daily_loss_ratio = abs(daily_pnl) / initial if daily_pnl < 0 else 0.0

    # 总敞口
    positions = broker.get("positions", []) if isinstance(broker, dict) else getattr(broker, "positions", [])
    total_notional = 0.0
    for p in positions:
        size = p.get("size", 0) if isinstance(p, dict) else getattr(p, "size", 0)
        price = p.get("entry_price", 0) if isinstance(p, dict) else getattr(p, "entry_price", 0)
        total_notional += abs(size * price)
    exposure_ratio = total_notional / initial if initial > 0 else 0.0

    # 回撤
    peak = broker.get("peak_equity", initial) if isinstance(broker, dict) else getattr(broker, "peak_equity", initial)
    if peak <= 0:
        peak = initial
    drawdown_pct = (peak - equity) / peak if peak > 0 else 0.0

    # 交易频率
    now = datetime.utcnow()
    hour_ago = now - timedelta(hours=1)
    day_start = datetime.combine(today, datetime.min.time())
    trades_hour = 0
    trades_day = 0
    for e in logs:
        if not _is_trade_entry(e):
            continue
        ts = e.get("ts") or e.get("timestamp")
        if ts:
            try:
                t = datetime.fromisoformat(str(ts))
                if t >= hour_ago:
                    trades_hour += 1
                if t >= day_start:
                    trades_day += 1
            except (ValueError, TypeError):
                pass

    # 判断是否放行
    halt_reason = None
    if consec >= max_consec:
        halt_reason = f"连亏{consec}笔 (上限{max_consec})"
    elif daily_loss_ratio >= max_daily_loss_ratio:
        halt_reason = f"日内亏损{daily_loss_ratio:.1%} (上限{max_daily_loss_ratio:.1%})"
    elif exposure_ratio >= max_exposure:
        halt_reason = f"敞口{exposure_ratio:.1%} (上限{max_exposure:.1%})"
    elif drawdown_pct >= max_dd:
        halt_reason = f"回撤{drawdown_pct:.1%} (上限{max_dd:.1%})"
    elif trades_hour >= max_per_hour:
        halt_reason = f"1小时{max_per_hour}笔已达上限"
    elif trades_day >= max_per_day:
        halt_reason = f"日内{max_per_day}笔已达上限"

    allowed = halt_reason is None

    return {
        "allowed": allowed,
        "halt_reason": halt_reason,
        "consecutive_loss_count": consec,
        "daily_realized_pnl": round(daily_pnl, 4),
        "daily_loss_ratio": round(daily_loss_ratio, 6),
        "total_notional": round(total_notional, 2),
        "exposure_ratio": round(exposure_ratio, 6),
        "current_drawdown_pct": round(drawdown_pct, 6),
        "trades_per_hour": trades_hour,
        "trades_per_day": trades_day,
        "max_trades_per_hour": max_per_hour,
        "max_trades_per_day": max_per_day,
    }
