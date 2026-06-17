from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel

from app.services.auth_service import (
    AuthenticationError,
    SESSION_COOKIE_NAME,
    SESSION_TTL_SECONDS,
    authenticate,
    create_operation_token,
    create_session_token,
    get_cookie_secure,
    load_auth_settings,
    parse_session_token,
    register_session_token,
    revoke_session_token,
)

router = APIRouter()


class LoginRequest(BaseModel):
    username: str
    password: str


class OperationTokenRequest(BaseModel):
    action: str


@router.post("/login")
def login(payload: LoginRequest, response: Response):
    try:
        settings = authenticate(payload.username.strip(), payload.password)
    except AuthenticationError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc

    token = create_session_token(settings.admin_username, settings.session_secret, ttl_seconds=SESSION_TTL_SECONDS)
    register_session_token(token, settings.session_secret)
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=token,
        httponly=True,
        samesite="lax",
        secure=get_cookie_secure(),
        max_age=SESSION_TTL_SECONDS,
        path="/",
    )
    return {"authenticated": True, "username": settings.admin_username}


@router.post("/logout")
def logout(request: Request, response: Response):
    settings = load_auth_settings(required=False)
    if settings:
        revoke_session_token(request.cookies.get(SESSION_COOKIE_NAME, ""), settings.session_secret)
    response.delete_cookie(
        key=SESSION_COOKIE_NAME,
        path="/",
        httponly=True,
        samesite="lax",
        secure=get_cookie_secure(),
    )
    return {"authenticated": False}


@router.post("/operation-token")
def operation_token(payload: OperationTokenRequest, request: Request):
    settings = load_auth_settings(required=True)
    session_token = request.cookies.get(SESSION_COOKIE_NAME, "")
    session_payload = parse_session_token(session_token, settings.session_secret)
    if not session_payload:
        raise HTTPException(status_code=401, detail="Authentication required")
    token = create_operation_token(
        payload.action,
        settings.session_secret,
        session_jti=str(session_payload.get("jti") or ""),
    )
    return {"operation_token": token, "action": payload.action}


@router.get("/session")
def get_session(request: Request):
    settings = load_auth_settings(required=False)
    if not settings:
        return {"authenticated": False}
    current_user = getattr(request.state, "auth_user", None)
    if not current_user:
        token = request.cookies.get(SESSION_COOKIE_NAME, "")
        payload = parse_session_token(token, settings.session_secret)
        current_user = payload.get("sub") if payload else None
    if current_user:
        return {"authenticated": True, "username": current_user}
    return {"authenticated": False}
