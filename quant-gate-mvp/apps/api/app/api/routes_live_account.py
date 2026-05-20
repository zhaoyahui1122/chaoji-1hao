from fastapi import APIRouter, HTTPException

from app.schemas.live_account import LiveAccountConnectRequest
from app.services.live_account_service import connect_live_account, refresh_live_account
from app.services.live_account_session import get_live_account_session
from app.services.gate_live_account import fetch_contract_detail

router = APIRouter()


def _serialize_session(session: dict):
    return {
        "connected": session["connected"],
        "has_credentials": session["has_credentials"],
        "last_sync_at": session["last_sync_at"],
        "last_error": session["last_error"],
        "account": session["account"],
        "positions": session["positions"],
        "source": session["source"],
    }


@router.get("/status")
def get_live_account_status():
    return _serialize_session(get_live_account_session())


@router.post("/connect")
def connect_live_account_route(payload: LiveAccountConnectRequest):
    try:
        return _serialize_session(connect_live_account(payload.api_key, payload.api_secret))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.post("/refresh")
def refresh_live_account_route():
    try:
        return _serialize_session(refresh_live_account())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.get("/contract/{symbol}")
def get_contract_info(symbol: str):
    try:
        data = fetch_contract_detail(symbol)
        return {
            "contract": data.get("name"),
            "leverage_min": data.get("leverage_min", "1"),
            "leverage_max": data.get("leverage_max", "100"),
            "order_size_min": data.get("order_size_min"),
            "order_size_max": data.get("order_size_max"),
            "mark_price": data.get("mark_price"),
            "index_price": data.get("index_price"),
        }
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
