import os

from dotenv import load_dotenv
if os.environ.get("QUANT_GATE_SKIP_DOTENV", "").strip().lower() not in {"1", "true", "yes", "on"}:
    load_dotenv()

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from app.api.routes import router
from app.core.log_config import setup_logging, get_logger
from app.core.rate_limit import limiter
from app.services.auth_service import (
    AuthConfigError,
    SESSION_COOKIE_NAME,
    load_auth_settings,
    parse_session_token,
)
from app.services.db import init_db
from app.services.scheduler import ensure_scheduler_started, stop_scheduler

setup_logging()
logger = get_logger(__name__)

app = FastAPI(title="Quant Gate MVP API", version="0.1.0")
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

_default_cors_origins = ",".join([
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:3002",
    "http://127.0.0.1:3002",
    "http://localhost:3100",
    "http://127.0.0.1:3100",
])
_cors_origins = [
    origin.strip()
    for origin in os.environ.get("CORS_ORIGINS", _default_cors_origins).split(",")
    if origin.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

EXEMPT_PATHS = {"/health", "/docs", "/openapi.json", "/auth/login", "/auth/session"}


@app.middleware("http")
async def session_auth(request: Request, call_next):
    if request.method.upper() == "OPTIONS":
        return await call_next(request)

    if request.url.path in EXEMPT_PATHS:
        return await call_next(request)

    settings = load_auth_settings(required=True)
    token = request.cookies.get(SESSION_COOKIE_NAME, "")
    payload = parse_session_token(token, settings.session_secret)
    if not payload:
        return JSONResponse(status_code=401, content={"detail": "Authentication required"})
    request.state.auth_user = payload.get("sub")
    return await call_next(request)


app.include_router(router)


@app.on_event("startup")
def on_startup():
    logger.info("Starting Quant Gate MVP API")
    try:
        load_auth_settings(required=True)
    except AuthConfigError as exc:
        logger.error("Authentication configuration invalid: %s", exc)
        raise RuntimeError(str(exc)) from exc
    init_db()
    ensure_scheduler_started()
    logger.info("Startup complete")


@app.on_event("shutdown")
def on_shutdown():
    logger.info("Shutting down")
    stop_scheduler()
    logger.info("Shutdown complete")


@app.get("/health")
def health():
    return {"status": "ok"}
