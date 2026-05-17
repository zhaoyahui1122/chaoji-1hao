from fastapi import APIRouter

from app.core.settings import SETTINGS
from app.core.state import PAPER_BROKER
from app.services.strategy_runner import get_runner_status

router = APIRouter()


@router.get("")
def get_dashboard():
    snapshot = PAPER_BROKER.snapshot()
    return {
        **snapshot,
        "status": "paper-trading",
        "runner": get_runner_status(),
        "supported_symbols": ["BTC_USDT", "ETH_USDT"],
        "supported_timeframes": ["5m", "15m", "30m", "1h", "4h"],
        "defaults": SETTINGS.model_dump(),
    }
