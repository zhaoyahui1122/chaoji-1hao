from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import router
from app.services.db import init_db
from app.services.scheduler import ensure_scheduler_started, stop_scheduler

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
    init_db()
    ensure_scheduler_started()


@app.on_event("shutdown")
def on_shutdown():
    stop_scheduler()


@app.get("/health")
def health():
    return {"status": "ok"}
