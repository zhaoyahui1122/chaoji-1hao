from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import router
from app.core.log_config import setup_logging, get_logger
from app.services.db import init_db
from app.services.scheduler import ensure_scheduler_started, stop_scheduler

setup_logging()
logger = get_logger(__name__)

app = FastAPI(title="Quant Gate MVP API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)


@app.on_event("startup")
def on_startup():
    logger.info("Starting Quant Gate MVP API")
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
