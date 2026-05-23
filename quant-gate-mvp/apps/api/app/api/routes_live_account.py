from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.schemas.live_account import LiveAccountConnectRequest
from app.services.live_account_service import connect_live_account, refresh_live_account
from app.services.live_account_session import get_live_account_session
from app.services.gate_live_account import fetch_contract_detail
from app.core.state import LIVE_BROKER

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


class LiveCloseRequest(BaseModel):
    symbol: str
    position_id: str | None = None


@router.post("/close")
def close_live_position(payload: LiveCloseRequest):
    try:
        LIVE_BROKER.sync_positions()
        target = next((p for p in LIVE_BROKER.positions if p.symbol == payload.symbol.upper()), None)
        price = target.mark_price if target else 0
        result = LIVE_BROKER.close_position(
            symbol=payload.symbol,
            price=price,
            source="manual",
            meta={"position_id": payload.position_id} if payload.position_id else None,
            position_id=payload.position_id,
        )
        refresh_live_account()
        return result
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.post("/close-all")
def close_all_live_positions():
    try:
        LIVE_BROKER.sync_positions()
        results = []
        for pos in LIVE_BROKER.positions:
            if pos.qty <= 0:
                continue
            try:
                result = LIVE_BROKER.close_position(
                    symbol=pos.symbol,
                    price=pos.mark_price,
                    source="manual",
                )
                results.append({"symbol": pos.symbol, "ok": result.get("ok", False)})
            except Exception as exc:
                results.append({"symbol": pos.symbol, "ok": False, "error": str(exc)})
        # 清空所有剩余挂单（含孤立条件单）
        try:
            from app.services.gate_live_account import _gate_private_request
            from app.services.gate_live_broker import GATE_FUTURES_PRICE_ORDERS_PATH
            api_key, api_secret = LIVE_BROKER._creds()
            _gate_private_request(
                "DELETE",
                f"{GATE_FUTURES_PRICE_ORDERS_PATH}?status=open",
                api_key=api_key,
                api_secret=api_secret,
            )
        except Exception:
            pass
        refresh_live_account()
        return {"ok": True, "results": results}
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
