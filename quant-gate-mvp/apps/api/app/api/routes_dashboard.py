from fastapi import APIRouter

from app.core.settings import SETTINGS
from app.core.state import PAPER_BROKER, LIVE_BROKER, get_broker
from app.services.strategy_runner import get_runner_status
from app.services.live_account_session import get_live_account_session

router = APIRouter()


@router.get("")
def get_dashboard():
    runner_status = get_runner_status()
    trade_mode = runner_status.get("trade_mode", "paper")

    if trade_mode == "live":
        broker = LIVE_BROKER
        live_session = get_live_account_session()
        try:
            snapshot = broker.snapshot()
        except Exception:
            snapshot = {"account": {"equity": 0}, "positions": [], "orders": []}
        account_data = snapshot.get("account", {})
        positions_data = snapshot.get("positions", [])
        # 如果 live session 有真实账户数据，优先使用
        if live_session.get("connected") and live_session.get("account"):
            la = live_session["account"]
            account_data = {
                "equity": la.get("equity", account_data.get("equity", 0)),
                "available_balance": la.get("available_balance", 0),
                "margin_used": la.get("margin_used", 0),
                "unrealized_pnl": la.get("unrealized_pnl", 0),
                "realized_pnl": 0,
                "open_positions": len(positions_data),
            }
        return {
            "account": account_data,
            "positions": positions_data,
            "orders": snapshot.get("orders", []),
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
