"""Integration tests for strategy signal → order → close full chain.

Uses PaperBroker with mock data — no external deps, no Gate API.
Run: python apps/api/tests/test_integration_chain.py
"""

import os
import sys
import unittest
from datetime import datetime, timedelta
from unittest.mock import patch

# Ensure project root on path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.paper.broker import PaperBroker
from app.services.market_data import generate_mock_ohlcv, MarketDataUnavailableError
from app.services.risk import build_risk_sized_order, calc_stop_loss_price, calc_take_profit_price


def _make_broker(balance: float = 10000.0) -> PaperBroker:
    """Create a clean broker, reset to avoid SQLite state bleed."""
    broker = PaperBroker(initial_balance=balance)
    broker.reset(initial_balance=balance)
    return broker


class TestPaperBrokerFullCycle(unittest.TestCase):
    """Open a position, update mark, close it, verify PnL."""

    def test_long_open_close_cycle(self):
        broker = _make_broker(10000)
        # open long
        result = broker.place_order(
            symbol="BTC_USDT", side="long", price=64000, leverage=5,
            allocated_margin=1000, stop_loss_price=62000,
            source="test", fee_rate=0.001, slippage_rate=0.0005,
        )
        self.assertTrue(result["ok"])
        self.assertEqual(len(broker.positions), 1)
        pos = broker.positions[0]
        self.assertEqual(pos.side, "long")
        self.assertAlmostEqual(pos.stop_loss_price, 62000)
        self.assertGreater(pos.qty, 0)

        # update mark to profit
        broker.update_mark_price("BTC_USDT", 66000, source="test")
        self.assertGreater(broker.equity, 10000)

        # close at profit
        close_result = broker.close_position("BTC_USDT", 66000, source="test")
        self.assertTrue(close_result["ok"])
        self.assertGreater(close_result["pnl"], 0)
        self.assertEqual(len(broker.positions), 0)

    def test_short_open_close_cycle(self):
        broker = _make_broker(10000)
        result = broker.place_order(
            symbol="ETH_USDT", side="short", price=3200, leverage=5,
            allocated_margin=500, stop_loss_price=3300,
            source="test", fee_rate=0.001, slippage_rate=0.0005,
        )
        self.assertTrue(result["ok"], f"place_order failed: {result}")
        pos = broker.positions[0]
        self.assertEqual(pos.side, "short")

        # close at profit (price dropped)
        close_result = broker.close_position("ETH_USDT", 3100, source="test")
        self.assertTrue(close_result["ok"])
        self.assertGreater(close_result["pnl"], 0)

    def test_close_nonexistent_returns_error(self):
        broker = _make_broker()
        result = broker.close_position("FAKE", 100, source="test")
        self.assertFalse(result["ok"])
        self.assertEqual(result["reason"], "position_not_found")


class TestRiskSizing(unittest.TestCase):
    """Verify risk-based order sizing and SL/TP calc."""

    def test_build_risk_sized_order_long(self):
        order = build_risk_sized_order(
            side="long", account_equity=10000, entry_price=64000,
            leverage=5, risk_per_trade_pct=0.01, stop_loss_pct=0.02,
            take_profit_pct=0.04,
        )
        self.assertAlmostEqual(order["stop_loss_price"], 64000 * 0.98)
        self.assertAlmostEqual(order["take_profit_price"], 64000 * 1.04)
        self.assertGreater(order["qty"], 0)
        self.assertGreater(order["effective_allocated_margin"], 0)

    def test_build_risk_sized_order_short(self):
        order = build_risk_sized_order(
            side="short", account_equity=10000, entry_price=3200,
            leverage=10, risk_per_trade_pct=0.01, stop_loss_pct=0.02,
            take_profit_pct=0.04,
        )
        self.assertAlmostEqual(order["stop_loss_price"], 3200 * 1.02)
        self.assertAlmostEqual(order["take_profit_price"], 3200 * 0.96)
        self.assertGreater(order["qty"], 0)

    def test_margin_cap_limits_allocation(self):
        order = build_risk_sized_order(
            side="long", account_equity=100000, entry_price=64000,
            leverage=20, risk_per_trade_pct=0.02, stop_loss_pct=0.01,
            take_profit_pct=0.02, allocated_margin_cap=500,
        )
        self.assertLessEqual(order["effective_allocated_margin"], 500)


class TestMockOHLCV(unittest.TestCase):
    """Verify mock data generation."""

    def test_generates_correct_periods(self):
        df = generate_mock_ohlcv("BTC_USDT", "15m", periods=50)
        self.assertEqual(len(df), 50)
        self.assertIn("close", df.columns)
        self.assertIn("timestamp", df.columns)

    def test_arbitrary_symbol_uses_hash(self):
        df = generate_mock_ohlcv("DOGE_USDT", "5m", periods=10)
        self.assertEqual(len(df), 10)
        # prices should be > 0
        self.assertTrue(all(df["close"] > 0))


class TestStrategySignalChain(unittest.TestCase):
    """Integration: strategy signal produces order via PaperBroker."""

    def _patched_cycle(self, signal, broker: PaperBroker, price: float = 64000.0):
        """Run a minimal strategy cycle with a mocked signal.

        signal can be a string (returns same every call) or a list of strings
        (consumed sequentially via side_effect).
        """
        from app.services.strategy_runner import _run_single_symbol_cycle

        mock_df = generate_mock_ohlcv("BTC_USDT", "15m", periods=100)

        if isinstance(signal, list):
            mock_signal = patch("app.services.strategy_runner._run_classic_signal", side_effect=[(s, None) for s in signal])
        else:
            mock_signal = patch("app.services.strategy_runner._run_classic_signal", return_value=(signal, None))

        with patch("app.services.strategy_runner.get_ohlcv", return_value=(mock_df, {"actual_source": "mock"})), \
             mock_signal, \
             patch("app.services.strategy_runner.evaluate_runner_guards", return_value={
                 "allowed": True, "halt_reason": None,
                 "consecutive_loss_count": 0, "daily_realized_pnl": 0.0,
                 "daily_loss_ratio": 0.0, "total_notional": 0.0, "exposure_ratio": 0.0,
             }):
            return _run_single_symbol_cycle(
                symbol="BTC_USDT",
                config={"strategy_type": "classic", "stop_loss_pct": 0.02, "take_profit_pct": 0.04,
                        "churn_guard_enabled": False},
                guard={"allowed": True},
                timeframe="15m",
                leverage=5,
                allocated_margin=1000,
                risk_per_trade_pct=0.01,
                stop_loss_pct=0.02,
                take_profit_pct=0.04,
                data_source="mock",
                fee_rate=0.001,
                slippage_rate=0.0005,
                strategy_type="classic",
                broker=broker,
            )

    def test_long_signal_opens_position(self):
        broker = _make_broker(10000)
        result = self._patched_cycle("long", broker)
        self.assertEqual(result["action"], "open")
        self.assertEqual(result["signal"], "long")
        self.assertEqual(len(broker.positions), 1)
        self.assertEqual(broker.positions[0].side, "long")

    def test_short_signal_opens_position(self):
        broker = _make_broker(10000)
        result = self._patched_cycle("short", broker)
        self.assertEqual(result["action"], "open")
        self.assertEqual(broker.positions[0].side, "short")

    def test_no_signal_idles(self):
        broker = _make_broker(10000)
        result = self._patched_cycle(None, broker)
        self.assertEqual(result["action"], "idle")
        self.assertEqual(len(broker.positions), 0)

    def test_same_side_signal_skips(self):
        broker = _make_broker(10000)
        # open first
        self._patched_cycle("long", broker)
        # same signal again
        result = self._patched_cycle("long", broker)
        self.assertEqual(result["action"], "skip_same_side")
        self.assertEqual(len(broker.positions), 1)

    def test_reverse_signal_closes_and_reopens(self):
        broker = _make_broker(10000)
        # open long on first cycle
        self._patched_cycle("long", broker)
        self.assertEqual(broker.positions[0].side, "long")
        # reverse to short on second cycle — should close long, open short
        self._patched_cycle("short", broker)
        self.assertEqual(broker.positions[0].side, "short")
        # should have close + open orders
        close_orders = [o for o in broker.orders if o.event_type == "close"]
        self.assertEqual(len(close_orders), 1)


class TestMarketDataUnavailable(unittest.TestCase):
    """Verify MarketDataUnavailableError blocks when allow_fallback=False."""

    def test_gate_source_raises_on_failure(self):
        from app.services.market_data import get_ohlcv
        with patch("app.services.market_data.fetch_gate_futures_candles", side_effect=Exception("connection refused")):
            with self.assertRaises(MarketDataUnavailableError):
                get_ohlcv("BTC_USDT", "15m", source="gate", allow_fallback=False)

    def test_gate_source_falls_back_when_allowed(self):
        from app.services.market_data import get_ohlcv
        with patch("app.services.market_data.fetch_gate_futures_candles", side_effect=Exception("timeout")):
            df, meta = get_ohlcv("BTC_USDT", "15m", source="gate", allow_fallback=True, periods=10)
            self.assertFalse(df.empty)
            self.assertEqual(meta["actual_source"], "mock")


class TestRunnerGuardIntegration(unittest.TestCase):
    """Risk guard blocks runner when limits exceeded."""

    def test_runner_halts_on_guard_block(self):
        from app.services.strategy_runner import run_strategy_cycle
        broker = _make_broker(10000)

        with patch("app.services.strategy_runner.evaluate_runner_guards", return_value={
            "allowed": False, "halt_reason": "max_consecutive_losses",
            "consecutive_loss_count": 5, "daily_realized_pnl": -500.0,
            "daily_loss_ratio": 0.05, "total_notional": 0.0, "exposure_ratio": 0.0,
        }), patch("app.services.strategy_runner.load_runner_state", return_value={}), \
             patch("app.services.strategy_runner.save_runner_state"), \
             patch("app.services.strategy_runner.append_log"):
            result = run_strategy_cycle({"symbol": "BTC_USDT", "strategy_type": "classic"})
            self.assertFalse(result["ok"])
            self.assertEqual(result["action"], "halted")
            self.assertEqual(result["reason"], "max_consecutive_losses")


class TestSLTPExtraction(unittest.TestCase):
    """Verify 3-tier SL/TP extraction priority."""

    def test_position_field_priority(self):
        from app.services.strategy_runner import _extract_position_targets
        from app.paper.broker import PaperPosition

        pos = PaperPosition(
            position_id="test1", symbol="BTC_USDT", side="long",
            leverage=5, qty=1.0, entry_price=64000, mark_price=64000,
            stop_loss_price=62000, take_profit_price=67000,
        )
        sl, tp = _extract_position_targets(pos, 0.02, 0.04)
        self.assertAlmostEqual(sl, 62000)
        self.assertAlmostEqual(tp, 67000)

    def test_order_meta_fallback(self):
        from app.services.strategy_runner import _extract_position_targets
        from app.paper.broker import PaperPosition, PaperOrder
        import json

        broker = _make_broker(10000)
        pos = PaperPosition(
            position_id="test2", symbol="BTC_USDT", side="long",
            leverage=5, qty=1.0, entry_price=64000, mark_price=64000,
            stop_loss_price=0.0, take_profit_price=0.0,
        )
        broker.orders.append(PaperOrder(
            position_id="test2", symbol="BTC_USDT", side="long",
            price=64000, qty=1.0, event_type="open",
            meta_json=json.dumps({"stop_loss_price": 61000, "take_profit_price": 68000}),
        ))
        sl, tp = _extract_position_targets(pos, 0.02, 0.04, broker=broker)
        self.assertAlmostEqual(sl, 61000)
        self.assertAlmostEqual(tp, 68000)

    def test_pct_recalc_fallback(self):
        from app.services.strategy_runner import _extract_position_targets
        from app.paper.broker import PaperPosition

        pos = PaperPosition(
            position_id="test3", symbol="BTC_USDT", side="long",
            leverage=5, qty=1.0, entry_price=64000, mark_price=64000,
            stop_loss_price=0.0, take_profit_price=0.0,
        )
        sl, tp = _extract_position_targets(pos, 0.02, 0.04)
        self.assertAlmostEqual(sl, 64000 * 0.98)
        self.assertAlmostEqual(tp, 64000 * 1.04)


class TestChurnGuard(unittest.TestCase):
    """Churn guard blocks premature reverse signals."""

    def test_blocks_reverse_within_threshold(self):
        from app.services.strategy_runner import _should_block_reverse_signal
        from app.paper.broker import PaperPosition

        pos = PaperPosition(
            position_id="cg1", symbol="BTC_USDT", side="long",
            leverage=5, qty=1.0, entry_price=64000, mark_price=64000,
        )
        config = {"churn_guard_enabled": True, "stop_loss_pct": 0.02}
        # price barely moved (< 1% of stop_loss_pct)
        blocked = _should_block_reverse_signal(config, pos, "short", 64100)
        self.assertTrue(blocked)

    def test_allows_reverse_after_sufficient_move(self):
        from app.services.strategy_runner import _should_block_reverse_signal
        from app.paper.broker import PaperPosition

        pos = PaperPosition(
            position_id="cg2", symbol="BTC_USDT", side="long",
            leverage=5, qty=1.0, entry_price=64000, mark_price=64000,
        )
        config = {"churn_guard_enabled": True, "stop_loss_pct": 0.02}
        # price moved > threshold
        blocked = _should_block_reverse_signal(config, pos, "short", 62000)
        self.assertFalse(blocked)


if __name__ == "__main__":
    unittest.main()
