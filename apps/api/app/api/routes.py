from fastapi import APIRouter

from app.api.routes_backtest import router as backtest_router
from app.api.routes_dashboard import router as dashboard_router
from app.api.routes_strategy import router as strategy_router
from app.api.routes_paper import router as paper_router
from app.api.routes_runner import router as runner_router
from app.api.routes_history import router as history_router
from app.api.routes_market import router as market_router
from app.api.routes_live_account import router as live_account_router
from app.api.routes_export import router as export_router

router = APIRouter()
router.include_router(dashboard_router, prefix="/dashboard", tags=["dashboard"])
router.include_router(strategy_router, prefix="/strategy", tags=["strategy"])
router.include_router(backtest_router, prefix="/backtest", tags=["backtest"])
router.include_router(paper_router, prefix="/paper", tags=["paper"])
router.include_router(runner_router, prefix="/runner", tags=["runner"])
router.include_router(history_router, prefix="/history", tags=["history"])
router.include_router(market_router, prefix="/market", tags=["market"])
router.include_router(live_account_router, prefix="/live-account", tags=["live-account"])
router.include_router(export_router, prefix="/export", tags=["export"])
