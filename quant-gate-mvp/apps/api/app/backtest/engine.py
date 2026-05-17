from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import pandas as pd

from app.services.risk import build_risk_sized_order
from app.strategy.boll_rsi_ma import compute_indicators as classic_compute_indicators, generate_signal as classic_generate_signal
from app.strategy.turtle import prepare_signals as turtle_prepare_signals


@dataclass
class BacktestTrade:
    side: str
    entry_time: str
    exit_time: str
    entry_price: float
    exit_price: float
    qty: float
    gross_pnl: float
    fee: float
    pnl: float
    pnl_pct: float
    reason: str
    entry_slippage: float = 0.0
    exit_slippage: float = 0.0
    leverage: float = 1.0
    status: str = "closed"
    cumulative_fees: float = 0.0
    cumulative_slippage_cost: float = 0.0

    def to_dict(self) -> dict[str, Any]:
        return {
            "side": self.side,
            "entry_time": self.entry_time,
            "exit_time": self.exit_time,
            "entry_price": self.entry_price,
            "exit_price": self.exit_price,
            "qty": self.qty,
            "gross_pnl": self.gross_pnl,
            "fee": self.fee,
            "pnl": self.pnl,
            "pnl_pct": self.pnl_pct,
            "reason": self.reason,
            "entry_slippage": self.entry_slippage,
            "exit_slippage": self.exit_slippage,
            "leverage": self.leverage,
            "status": self.status,
            "cumulative_fees": self.cumulative_fees,
            "cumulative_slippage_cost": self.cumulative_slippage_cost,
        }


@dataclass
class BacktestResult:
    summary: dict[str, Any]
    equity_curve: list[dict[str, Any]]
    trades: list[dict[str, Any]]


class SimpleBacktester:
    def __init__(self, initial_balance: float = 10000):
        self.initial_balance = initial_balance

    @staticmethod
    def _apply_slippage(side: str, price: float, slippage_rate: float, is_close: bool = False) -> float:
        rate = max(float(slippage_rate or 0.0), 0.0)
        if side == "long":
            multiplier = 1 - rate if is_close else 1 + rate
        else:
            multiplier = 1 + rate if is_close else 1 - rate
        return float(price) * multiplier

    @staticmethod
    def _calc_fee(notional: float, fee_rate: float) -> float:
        return max(float(notional), 0.0) * max(float(fee_rate or 0.0), 0.0)

    def run(self, df: pd.DataFrame, config: dict[str, Any]) -> BacktestResult:
        strategy_type = config.get("strategy_type", "classic")

        if strategy_type == "turtle":
            return self._run_turtle(df, config)
        return self._run_classic(df, config)

    def _run_classic(self, df: pd.DataFrame, config: dict[str, Any]) -> BacktestResult:
        data = classic_compute_indicators(
            df,
            boll_period=config.get("boll_period", 20),
            boll_std=config.get("boll_std", 2.0),
            rsi_period=config.get("rsi_period", 14),
            ma_short=config.get("ma_short", 9),
            ma_long=config.get("ma_long", 21),
            macd_fast=config.get("macd_fast", 12),
            macd_slow=config.get("macd_slow", 26),
            macd_signal=config.get("macd_signal", 9),
            kdj_period=config.get("kdj_period", 9),
            kdj_signal_period=config.get("kdj_signal_period", 3),
        ).copy()

        balance = self.initial_balance
        equity_curve: list[dict[str, Any]] = []
        trades: list[BacktestTrade] = []
        position = None

        risk_per_trade_pct = float(config.get("risk_per_trade_pct", 0.01))
        stop_loss_pct = float(config.get("stop_loss_pct", 0.02))
        take_profit_pct = float(config.get("take_profit_pct", 0.04))
        fee_rate = float(config.get("fee_rate", 0.00015))
        slippage_rate = float(config.get("slippage_rate", 0.0001))

        for _, row in data.iterrows():
            price = float(row["close"])
            ts = str(row["timestamp"])
            signal = classic_generate_signal(
                row,
                rsi_oversold=float(config.get("rsi_oversold", 30)),
                rsi_overbought=float(config.get("rsi_overbought", 70)),
                use_boll=bool(config.get("use_boll", True)),
                use_rsi=bool(config.get("use_rsi", True)),
                use_ma=bool(config.get("use_ma", True)),
                use_macd=bool(config.get("use_macd", False)),
                use_kdj=bool(config.get("use_kdj", False)),
                kdj_overbought=float(config.get("kdj_overbought", 80)),
                kdj_oversold=float(config.get("kdj_oversold", 20)),
                min_signal_score=int(config.get("min_signal_score", 3)),
            )

            if position is None and signal in ("long", "short"):
                entry_price = self._apply_slippage(signal, price, slippage_rate, is_close=False)
                sizing = build_risk_sized_order(
                    side=signal,
                    account_equity=balance,
                    entry_price=entry_price,
                    leverage=1,
                    risk_per_trade_pct=risk_per_trade_pct,
                    stop_loss_pct=stop_loss_pct,
                    take_profit_pct=take_profit_pct,
                    allocated_margin_cap=None,
                )
                qty = sizing["qty"]
                if qty > 0:
                    entry_fee = self._calc_fee(entry_price * qty, fee_rate)
                    balance -= entry_fee
                    position = {
                        "side": signal,
                        "entry_time": ts,
                        "entry_price": entry_price,
                        "entry_fee": entry_fee,
                        "entry_slippage": entry_price - price if signal == "long" else price - entry_price,
                        "qty": qty,
                        "stop_price": sizing["stop_loss_price"],
                        "take_profit_price": sizing["take_profit_price"],
                    }

            elif position is not None:
                exit_reason = None
                if position["side"] == "long":
                    if price <= position["stop_price"]:
                        exit_reason = "stop_loss"
                    elif price >= position["take_profit_price"]:
                        exit_reason = "take_profit"
                    elif signal == "short":
                        exit_reason = "reverse_signal"
                    exit_price = self._apply_slippage("long", price, slippage_rate, is_close=True)
                    gross_pnl = (exit_price - position["entry_price"]) * position["qty"]
                else:
                    if price >= position["stop_price"]:
                        exit_reason = "stop_loss"
                    elif price <= position["take_profit_price"]:
                        exit_reason = "take_profit"
                    elif signal == "long":
                        exit_reason = "reverse_signal"
                    exit_price = self._apply_slippage("short", price, slippage_rate, is_close=True)
                    gross_pnl = (position["entry_price"] - exit_price) * position["qty"]

                if exit_reason:
                    exit_fee = self._calc_fee(exit_price * position["qty"], fee_rate)
                    total_fee = position["entry_fee"] + exit_fee
                    pnl = gross_pnl - total_fee
                    pnl_pct = pnl / balance if balance > 0 else 0
                    balance += gross_pnl - exit_fee
                    trades.append(
                        BacktestTrade(
                            side=position["side"],
                            entry_time=position["entry_time"],
                            exit_time=ts,
                            entry_price=position["entry_price"],
                            exit_price=exit_price,
                            qty=position["qty"],
                            gross_pnl=gross_pnl,
                            fee=total_fee,
                            pnl=pnl,
                            pnl_pct=pnl_pct,
                            reason=exit_reason,
                            entry_slippage=position["entry_slippage"],
                            exit_slippage=exit_price - price if position["side"] == "long" else price - exit_price,
                            leverage=float(config.get("leverage", 1)),
                            status="closed",
                            cumulative_fees=total_fee,
                            cumulative_slippage_cost=(position["entry_slippage"] + (exit_price - price if position["side"] == "long" else price - exit_price)) * position["qty"],
                        )
                    )
                    position = None

            unrealized = 0.0
            if position is not None:
                if position["side"] == "long":
                    mark_exit = self._apply_slippage("long", price, slippage_rate, is_close=True)
                    unrealized = (mark_exit - position["entry_price"]) * position["qty"] - self._calc_fee(mark_exit * position["qty"], fee_rate)
                else:
                    mark_exit = self._apply_slippage("short", price, slippage_rate, is_close=True)
                    unrealized = (position["entry_price"] - mark_exit) * position["qty"] - self._calc_fee(mark_exit * position["qty"], fee_rate)
            equity_curve.append({"timestamp": ts, "equity": balance + unrealized})

        return self._build_result(trades, equity_curve)

    def _run_turtle(self, df: pd.DataFrame, config: dict[str, Any]) -> BacktestResult:
        data = turtle_prepare_signals(df, config).copy()

        balance = self.initial_balance
        equity_curve: list[dict[str, Any]] = []
        trades: list[BacktestTrade] = []
        position = None

        risk_per_trade_pct = float(config.get("risk_per_trade_pct", 0.01))
        stop_loss_pct = float(config.get("stop_loss_pct", 0.02))
        take_profit_pct = float(config.get("take_profit_pct", 0.04))
        fee_rate = float(config.get("fee_rate", 0.00015))
        slippage_rate = float(config.get("slippage_rate", 0.0001))

        for _, row in data.iterrows():
            price = float(row["close"])
            ts = str(row["timestamp"])
            signal = row.get("signal")
            atr = float(row["atr"]) if not pd.isna(row.get("atr")) else 0.0

            # Entry signals
            if position is None and signal in ("long", "short"):
                entry_price = self._apply_slippage(signal, price, slippage_rate, is_close=False)
                # Always use percentage-based SL/TP (ATR-based was overriding user params)
                stop_loss_price = entry_price * (1 - stop_loss_pct) if signal == "long" else entry_price * (1 + stop_loss_pct)
                take_profit_price = entry_price * (1 + take_profit_pct) if signal == "long" else entry_price * (1 - take_profit_pct)

                sizing = build_risk_sized_order(
                    side=signal,
                    account_equity=balance,
                    entry_price=entry_price,
                    leverage=1,
                    risk_per_trade_pct=risk_per_trade_pct,
                    stop_loss_pct=stop_loss_pct,
                    take_profit_pct=take_profit_pct,
                    allocated_margin_cap=None,
                )
                qty = sizing["qty"]
                if qty > 0:
                    entry_fee = self._calc_fee(entry_price * qty, fee_rate)
                    balance -= entry_fee
                    position = {
                        "side": signal,
                        "entry_time": ts,
                        "entry_price": entry_price,
                        "entry_fee": entry_fee,
                        "entry_slippage": entry_price - price if signal == "long" else price - entry_price,
                        "qty": qty,
                        "stop_price": stop_loss_price,
                        "take_profit_price": take_profit_price,
                    }

            # Exit signals
            elif position is not None:
                exit_reason = None

                # Check turtle exit signal first (Donchian channel exit)
                if position["side"] == "long" and signal == "exit_long":
                    exit_reason = "turtle_exit"
                elif position["side"] == "short" and signal == "exit_short":
                    exit_reason = "turtle_exit"
                # Then check stop loss / take profit
                elif position["side"] == "long":
                    if price <= position["stop_price"]:
                        exit_reason = "stop_loss"
                    elif price >= position["take_profit_price"]:
                        exit_reason = "take_profit"
                else:
                    if price >= position["stop_price"]:
                        exit_reason = "stop_loss"
                    elif price <= position["take_profit_price"]:
                        exit_reason = "take_profit"

                if exit_reason:
                    if position["side"] == "long":
                        exit_price = self._apply_slippage("long", price, slippage_rate, is_close=True)
                        gross_pnl = (exit_price - position["entry_price"]) * position["qty"]
                    else:
                        exit_price = self._apply_slippage("short", price, slippage_rate, is_close=True)
                        gross_pnl = (position["entry_price"] - exit_price) * position["qty"]

                    exit_fee = self._calc_fee(exit_price * position["qty"], fee_rate)
                    total_fee = position["entry_fee"] + exit_fee
                    pnl = gross_pnl - total_fee
                    pnl_pct = pnl / balance if balance > 0 else 0
                    balance += gross_pnl - exit_fee
                    trades.append(
                        BacktestTrade(
                            side=position["side"],
                            entry_time=position["entry_time"],
                            exit_time=ts,
                            entry_price=position["entry_price"],
                            exit_price=exit_price,
                            qty=position["qty"],
                            gross_pnl=gross_pnl,
                            fee=total_fee,
                            pnl=pnl,
                            pnl_pct=pnl_pct,
                            reason=exit_reason,
                            entry_slippage=position["entry_slippage"],
                            exit_slippage=exit_price - price if position["side"] == "long" else price - exit_price,
                            leverage=float(config.get("leverage", 1)),
                            status="closed",
                            cumulative_fees=total_fee,
                            cumulative_slippage_cost=(position["entry_slippage"] + (exit_price - price if position["side"] == "long" else price - exit_price)) * position["qty"],
                        )
                    )
                    position = None

            unrealized = 0.0
            if position is not None:
                if position["side"] == "long":
                    mark_exit = self._apply_slippage("long", price, slippage_rate, is_close=True)
                    unrealized = (mark_exit - position["entry_price"]) * position["qty"] - self._calc_fee(mark_exit * position["qty"], fee_rate)
                else:
                    mark_exit = self._apply_slippage("short", price, slippage_rate, is_close=True)
                    unrealized = (position["entry_price"] - mark_exit) * position["qty"] - self._calc_fee(mark_exit * position["qty"], fee_rate)
            equity_curve.append({"timestamp": ts, "equity": balance + unrealized})

        return self._build_result(trades, equity_curve)

    def _build_result(self, trades: list[BacktestTrade], equity_curve: list[dict[str, Any]]) -> BacktestResult:
        wins = [t for t in trades if t.pnl > 0]
        total_return = ((equity_curve[-1]["equity"] - self.initial_balance) / self.initial_balance * 100) if equity_curve else 0.0
        total_gross_pnl = sum(t.gross_pnl for t in trades)
        total_fees = sum(t.fee for t in trades)
        total_slippage_cost = sum((t.entry_slippage + t.exit_slippage) * t.qty for t in trades)
        total_net_pnl = sum(t.pnl for t in trades)
        peak = self.initial_balance
        max_drawdown = 0.0
        for point in equity_curve:
            peak = max(peak, point["equity"])
            dd = (peak - point["equity"]) / peak if peak > 0 else 0.0
            max_drawdown = max(max_drawdown, dd)

        return BacktestResult(
            summary={
                "return_pct": round(total_return, 4),
                "max_drawdown_pct": round(max_drawdown * 100, 4),
                "win_rate_pct": round((len(wins) / len(trades) * 100), 4) if trades else 0.0,
                "trades": len(trades),
                "ending_equity": round(equity_curve[-1]["equity"], 4) if equity_curve else self.initial_balance,
                "gross_pnl": round(total_gross_pnl, 4),
                "fees": round(total_fees, 4),
                "slippage_cost": round(total_slippage_cost, 4),
                "net_pnl": round(total_net_pnl, 4),
                "total_gross_pnl": round(total_gross_pnl, 4),
                "total_fees": round(total_fees, 4),
                "total_slippage_cost": round(total_slippage_cost, 4),
                "total_net_pnl": round(total_net_pnl, 4),
            },
            equity_curve=equity_curve,
            trades=[t.to_dict() for t in trades],
        )
