import os

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from app.api.routes import router
from app.core.log_config import setup_logging, get_logger
from app.core.rate_limit import limiter
from app.services.db import init_db
from app.services.scheduler import ensure_scheduler_started, stop_scheduler

setup_logging()
logger = get_logger(__name__)

API_SECRET_KEY = os.environ.get("API_SECRET_KEY", "")

app = FastAPI(title="Quant Gate MVP API", version="0.1.0")
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

_cors_origins = os.environ.get("CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

EXEMPT_PATHS = {"/health", "/docs", "/openapi.json"}


@app.middleware("http")
async def api_key_auth(request: Request, call_next):
    if not API_SECRET_KEY or request.url.path in EXEMPT_PATHS:
        return await call_next(request)
    provided_key = request.headers.get("X-API-Key", "")
    if provided_key != API_SECRET_KEY:
        return JSONResponse(status_code=401, content={"detail": "Invalid or missing API key"})
    return await call_next(request)

app.include_router(router)


@app.on_event("startup")
def on_startup():
    logger.info("Starting Quant Gate MVP API")
    if not API_SECRET_KEY:
        logger.warning("API_SECRET_KEY 未设置 — 所有接口无认证保护！生产环境请务必设置该环境变量")
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
