from pydantic import BaseModel


class StrategySignal(BaseModel):
    side: str
    reason: str
    price: float
    timestamp: str
