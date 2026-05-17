from app.core.settings import SETTINGS
from app.paper.broker import PaperBroker

PAPER_BROKER = PaperBroker(initial_balance=SETTINGS.initial_balance)
