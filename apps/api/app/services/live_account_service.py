from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from app.services.gate_live_account import fetch_futures_account, fetch_futures_positions
from app.services.live_account_session import (
    get_live_account_session,
    set_live_account_credentials,
    set_live_account_error,
    set_live_account_snapshot,
)


def _to_float(value: Any, default: float = 0.0) -> float:
    try:
        if value is None or value == "":
            return default
        return float(value)
    except (TypeError, ValueError):
        return default


def _resolve_side(position_raw: dict[str, Any]) -> str:
    mode = str(position_raw.get("mode") or "").lower()
    size = _to_float(position_raw.get("size"))
    if size < 0:
        return "short"
    if mode == "short":
        return "short"
    return "long"


def build_live_account_snapshot(account_raw: dict[str, Any], positions_raw: list[dict[str, Any]]) -> dict[str, Any]:
    normalized_positions = []
    unrealized_pnl_total = 0.0
    margin_used_total = 0.0

    for item in positions_raw:
        size = abs(_to_float(item.get("size")))
        if size == 0:
            continue
        unrealized_pnl = _to_float(item.get("unrealised_pnl") or item.get("unrealized_pnl"))
        margin_used = _to_float(item.get("margin") or item.get("position_margin") or item.get("initial_margin"))
        normalized = {
            "symbol": str(item.get("contract") or ""),
            "side": _resolve_side(item),
            "leverage": int(_to_float(item.get("leverage"), default=0)),
            "size": size,
            "entry_price": _to_float(item.get("entry_price")),
            "mark_price": _to_float(item.get("mark_price")),
            "unrealized_pnl": unrealized_pnl,
            "margin": margin_used,
            "liq_price": _to_float(item.get("liq_price")),
        }
        unrealized_pnl_total += unrealized_pnl
        margin_used_total += margin_used
        normalized_positions.append(normalized)

    account = {
        "equity": _to_float(account_raw.get("total") or account_raw.get("equity")),
        "available_balance": _to_float(account_raw.get("available") or account_raw.get("available_balance")),
        "margin_used": _to_float(account_raw.get("position_margin") or account_raw.get("margin_used"), default=margin_used_total),
        "unrealized_pnl": _to_float(account_raw.get("unrealised_pnl") or account_raw.get("unrealized_pnl"), default=unrealized_pnl_total),
    }

    if account["margin_used"] == 0.0 and margin_used_total > 0:
        account["margin_used"] = margin_used_total
    if account["unrealized_pnl"] == 0.0 and unrealized_pnl_total != 0.0:
        account["unrealized_pnl"] = unrealized_pnl_total

    return {
        "account": account,
        "positions": normalized_positions,
    }


def connect_live_account(api_key: str, api_secret: str) -> dict[str, Any]:
    set_live_account_credentials(api_key=api_key, api_secret=api_secret)
    account_raw = fetch_futures_account(api_key=api_key, api_secret=api_secret)
    positions_raw = fetch_futures_positions(api_key=api_key, api_secret=api_secret)
    snapshot = build_live_account_snapshot(account_raw=account_raw, positions_raw=positions_raw)
    last_sync_at = datetime.now(timezone.utc).isoformat()
    return set_live_account_snapshot(snapshot["account"], snapshot["positions"], last_sync_at=last_sync_at)


def refresh_live_account() -> dict[str, Any]:
    session = get_live_account_session()
    api_key = session.get("api_key")
    api_secret = session.get("api_secret")
    if not api_key or not api_secret:
        raise ValueError("live_account_not_connected")

    try:
        account_raw = fetch_futures_account(api_key=api_key, api_secret=api_secret)
        positions_raw = fetch_futures_positions(api_key=api_key, api_secret=api_secret)
        snapshot = build_live_account_snapshot(account_raw=account_raw, positions_raw=positions_raw)
        last_sync_at = datetime.now(timezone.utc).isoformat()
        return set_live_account_snapshot(snapshot["account"], snapshot["positions"], last_sync_at=last_sync_at)
    except Exception as exc:
        set_live_account_error(str(exc))
        raise
