from fastapi import APIRouter

from app.core.settings import SETTINGS
from app.core.state import PAPER_BROKER, LIVE_BROKER, get_broker
from app.services.strategy_runner import get_runner_status
from app.services.live_account_session import get_live_account_session
from app.services.gate_live_account import _gate_private_request

router = APIRouter()

GATE_FUTURES_PRICE_ORDERS_PATH = "/api/v4/futures/usdt/price_orders"


def _fetch_live_sl_tp(api_key: str, api_secret: str, positions: list[dict]) -> dict[str, dict[str, float]]:
    """Fetch exchange conditional orders and extract SL/TP per contract."""
    try:
        resp = _gate_private_request(
            "GET", GATE_FUTURES_PRICE_ORDERS_PATH,
            api_key=api_key, api_secret=api_secret,
            query_string="status=open",
        )
    except Exception:
        return {}
    if not isinstance(resp, list):
        return {}
    # Build mark price lookup from positions
    mark_by_contract: dict[str, tuple[float, str]] = {}
    for p in positions:
        c = p.get("symbol", "")
        if c:
            mark_by_contract[c] = (p.get("mark_price", 0), p.get("side", ""))

    result: dict[str, dict[str, float]] = {}
    for co in resp:
        contract = str(co.get("initial", {}).get("contract", "") or co.get("contract", ""))
        trigger = float(co.get("trigger", {}).get("price", 0) or 0)
        if not contract or trigger <= 0:
            continue
        entry = result.setdefault(contract, {})
        mark_info = mark_by_contract.get(contract)
        if mark_info:
            mark_price, side = mark_info
            if side == "short":
                # Short: SL is above mark (trigger > mark), TP is below mark
                if trigger > mark_price:
                    entry["sl"] = trigger
                else:
                    entry["tp"] = trigger
            else:
                # Long: SL is below mark (trigger < mark), TP is above mark
                if trigger < mark_price:
                    entry["sl"] = trigger
                else:
                    entry["tp"] = trigger
        else:
            # No position info, use rule as fallback
            rule = int(co.get("trigger", {}).get("rule", 0) or 0)
            if rule == 1:
                entry.setdefault("sl", trigger)
            else:
                entry.setdefault("tp", trigger)
    return result


@router.get("")
def get_dashboard():
    runner_status = get_runner_status()
    trade_mode = runner_status.get("trade_mode", "paper")

    if trade_mode == "live":
        live_session = get_live_account_session()
        if live_session.get("connected") and live_session.get("account"):
            account_data = live_session["account"]
            positions_data = [
                {**p, "qty": p.get("size", 0)}
                for p in live_session.get("positions", [])
                if p.get("size", 0) > 0
            ]
            # 拉取交易所条件单止损止盈
            api_key = live_session.get("api_key")
            api_secret = live_session.get("api_secret")
            if api_key and api_secret:
                sl_tp = _fetch_live_sl_tp(api_key, api_secret, positions_data)
                for pos in positions_data:
                    contract = pos.get("symbol", "")
                    if contract in sl_tp:
                        pos["stop_loss_price"] = sl_tp[contract].get("sl")
                        pos["take_profit_price"] = sl_tp[contract].get("tp")
        else:
            account_data = {"equity": 0, "available_balance": 0, "margin_used": 0, "unrealized_pnl": 0}
            positions_data = []
        return {
            "account": account_data,
            "positions": positions_data,
            "orders": [],
            "status": "live-trading",
            "trade_mode": trade_mode,
            "runner": runner_status,
            "supported_symbols": ["BTC_USDT", "ETH_USDT"],
            "supported_timeframes": ["5m", "15m", "30m", "1h", "4h"],
            "defaults": SETTINGS.model_dump(),
        }

    snapshot = PAPER_BROKER.snapshot()
    return {
        **snapshot,
        "status": "paper-trading",
        "trade_mode": trade_mode,
        "runner": runner_status,
        "supported_symbols": ["BTC_USDT", "ETH_USDT"],
        "supported_timeframes": ["5m", "15m", "30m", "1h", "4h"],
        "defaults": SETTINGS.model_dump(),
    }
