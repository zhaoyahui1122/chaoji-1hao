from app.core.settings import SETTINGS
from app.paper.broker import PaperBroker
from app.services.gate_live_broker import GateLiveBroker

PAPER_BROKER = PaperBroker(initial_balance=SETTINGS.initial_balance)
LIVE_BROKER = GateLiveBroker()


def get_broker(trade_mode: str = "paper"):
    """Return the appropriate broker based on trade mode."""
    if trade_mode == "live":
        return LIVE_BROKER
    return PAPER_BROKER
