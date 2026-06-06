from app.core.settings import SETTINGS
from app.paper.broker import PaperBroker


def test_paper_broker_default_initial_balance_follows_settings():
    assert SETTINGS.initial_balance == 1000
    assert PaperBroker.__dataclass_fields__["initial_balance"].default == SETTINGS.initial_balance
