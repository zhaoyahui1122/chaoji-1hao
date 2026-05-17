from fastapi import APIRouter, HTTPException
from typing import Literal

from app.services.gate_market_data import fetch_gate_futures_candles, fetch_gate_futures_ticker

router = APIRouter()

Symbol = Literal["BTC_USDT", "ETH_USDT"]


@router.get("/ticker/{symbol}")
def get_market_ticker(symbol: Symbol):
    try:
        return fetch_gate_futures_ticker(symbol)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"failed_to_fetch_market_ticker: {exc}") from exc


@router.get("/candles/{symbol}")
def get_market_candles(symbol: Symbol, timeframe: str = "15m", limit: int = 120):
    try:
        df = fetch_gate_futures_candles(symbol, timeframe=timeframe, limit=limit)
        return {
            "symbol": symbol,
            "timeframe": timeframe,
            "items": df.to_dict(orient="records") if not df.empty else [],
        }
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"failed_to_fetch_market_candles: {exc}") from exc
