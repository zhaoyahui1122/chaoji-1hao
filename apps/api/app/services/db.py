from __future__ import annotations

import json
import os
from contextlib import contextmanager
from typing import Any

import psycopg2
import psycopg2.extras
import psycopg2.pool

_pool: psycopg2.pool.ThreadedConnectionPool | None = None


def get_pool() -> psycopg2.pool.ThreadedConnectionPool:
    global _pool
    if _pool is None:
        dsn = os.environ.get("DATABASE_URL", "")
        if not dsn:
            raise RuntimeError(
                "DATABASE_URL environment variable is not set. "
                "Set it to a PostgreSQL connection string (e.g. from Supabase)."
            )
        _pool = psycopg2.pool.ThreadedConnectionPool(
            minconn=2,
            maxconn=10,
            dsn=dsn,
        )
    return _pool


class _ConnWrapper:
    """Wraps a psycopg2 connection to mimic sqlite3.Connection interface.

    Allows existing code using conn.execute()/fetchone()/fetchall()/commit()
    to work unchanged against PostgreSQL.
    """

    def __init__(self, conn):
        self._conn = conn
        self._cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    @property
    def row_factory(self):
        return None

    @row_factory.setter
    def row_factory(self, _val):
        pass  # No-op: RealDictCursor always returns dict-like rows

    def execute(self, sql, params=None):
        self._cur.execute(sql.replace("?", "%s"), params)
        return self

    def executemany(self, sql, param_list):
        # Replace ? with %s for each call
        self._cur.executemany(sql.replace("?", "%s"), param_list)
        return self

    def fetchone(self):
        return self._cur.fetchone()

    def fetchall(self):
        return self._cur.fetchall()

    @property
    def lastrowid(self):
        # Use a fresh cursor to avoid disrupting the main cursor's state
        with self._conn.cursor() as tmp:
            tmp.execute("SELECT lastval()")
            row = tmp.fetchone()
            return row[0] if row else None

    def commit(self):
        self._conn.commit()

    def rollback(self):
        self._conn.rollback()

    def close(self):
        self._cur.close()
        self._conn.close()

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        if exc_type:
            self._conn.rollback()
        else:
            self._conn.commit()
        return False


@contextmanager
def get_conn():
    pool = get_pool()
    raw = pool.getconn()
    wrapper = _ConnWrapper(raw)
    try:
        yield wrapper
        wrapper.commit()
    except Exception:
        wrapper.rollback()
        raise
    finally:
        pool.putconn(raw)


def _column_exists(conn, table: str, column: str) -> bool:
    conn.execute(
        "SELECT 1 FROM information_schema.columns WHERE table_name = %s AND column_name = %s",
        (table, column),
    )
    return conn.fetchone() is not None


def init_db() -> None:
    with get_conn() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS kv_store (
                namespace TEXT NOT NULL,
                key TEXT NOT NULL,
                value_json TEXT NOT NULL,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY(namespace, key)
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS paper_positions (
                id SERIAL PRIMARY KEY,
                position_id TEXT,
                symbol TEXT NOT NULL,
                side TEXT NOT NULL,
                leverage INTEGER NOT NULL,
                qty DOUBLE PRECISION NOT NULL,
                entry_price DOUBLE PRECISION NOT NULL,
                mark_price DOUBLE PRECISION NOT NULL,
                status TEXT NOT NULL DEFAULT 'open',
                opened_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                closed_at TIMESTAMP,
                close_price DOUBLE PRECISION,
                realized_pnl DOUBLE PRECISION
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS paper_orders (
                id SERIAL PRIMARY KEY,
                position_id TEXT,
                symbol TEXT NOT NULL,
                side TEXT NOT NULL,
                price DOUBLE PRECISION NOT NULL,
                qty DOUBLE PRECISION NOT NULL,
                status TEXT NOT NULL,
                event_type TEXT NOT NULL DEFAULT 'open',
                source TEXT NOT NULL DEFAULT 'manual',
                meta_json TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS paper_account_snapshots (
                id SERIAL PRIMARY KEY,
                initial_balance DOUBLE PRECISION NOT NULL,
                realized_pnl DOUBLE PRECISION NOT NULL,
                equity DOUBLE PRECISION NOT NULL,
                available_balance DOUBLE PRECISION NOT NULL,
                margin_used DOUBLE PRECISION NOT NULL,
                margin_ratio DOUBLE PRECISION NOT NULL,
                unrealized_pnl DOUBLE PRECISION NOT NULL,
                open_positions INTEGER NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS strategy_snapshots (
                id SERIAL PRIMARY KEY,
                config_json TEXT NOT NULL,
                label TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS drawdown_tracker (
                id INTEGER PRIMARY KEY,
                peak_equity DOUBLE PRECISION NOT NULL,
                max_drawdown_pct DOUBLE PRECISION NOT NULL DEFAULT 0,
                peak_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
            """
        )

        # Migration: add columns that were added after initial schema
        if not _column_exists(conn, "paper_positions", "position_id"):
            conn.execute("ALTER TABLE paper_positions ADD COLUMN position_id TEXT")
        if not _column_exists(conn, "paper_positions", "fee_rate"):
            conn.execute("ALTER TABLE paper_positions ADD COLUMN fee_rate DOUBLE PRECISION NOT NULL DEFAULT 0.0005")
        if not _column_exists(conn, "paper_positions", "slippage_rate"):
            conn.execute("ALTER TABLE paper_positions ADD COLUMN slippage_rate DOUBLE PRECISION NOT NULL DEFAULT 0.0002")
        if not _column_exists(conn, "paper_positions", "entry_fee"):
            conn.execute("ALTER TABLE paper_positions ADD COLUMN entry_fee DOUBLE PRECISION NOT NULL DEFAULT 0")
        if not _column_exists(conn, "paper_positions", "cumulative_fees"):
            conn.execute("ALTER TABLE paper_positions ADD COLUMN cumulative_fees DOUBLE PRECISION NOT NULL DEFAULT 0")
        if not _column_exists(conn, "paper_positions", "entry_slippage_cost"):
            conn.execute("ALTER TABLE paper_positions ADD COLUMN entry_slippage_cost DOUBLE PRECISION NOT NULL DEFAULT 0")
        if not _column_exists(conn, "paper_positions", "exit_slippage_cost"):
            conn.execute("ALTER TABLE paper_positions ADD COLUMN exit_slippage_cost DOUBLE PRECISION NOT NULL DEFAULT 0")
        if not _column_exists(conn, "paper_positions", "cumulative_slippage_cost"):
            conn.execute("ALTER TABLE paper_positions ADD COLUMN cumulative_slippage_cost DOUBLE PRECISION NOT NULL DEFAULT 0")
        if not _column_exists(conn, "paper_orders", "event_type"):
            conn.execute("ALTER TABLE paper_orders ADD COLUMN event_type TEXT NOT NULL DEFAULT 'open'")
        if not _column_exists(conn, "paper_orders", "position_id"):
            conn.execute("ALTER TABLE paper_orders ADD COLUMN position_id TEXT")
        if not _column_exists(conn, "paper_orders", "source"):
            conn.execute("ALTER TABLE paper_orders ADD COLUMN source TEXT NOT NULL DEFAULT 'manual'")
        if not _column_exists(conn, "paper_orders", "meta_json"):
            conn.execute("ALTER TABLE paper_orders ADD COLUMN meta_json TEXT")
        if not _column_exists(conn, "paper_positions", "stop_loss_price"):
            conn.execute("ALTER TABLE paper_positions ADD COLUMN stop_loss_price DOUBLE PRECISION NOT NULL DEFAULT 0")
        if not _column_exists(conn, "paper_positions", "take_profit_price"):
            conn.execute("ALTER TABLE paper_positions ADD COLUMN take_profit_price DOUBLE PRECISION NOT NULL DEFAULT 0")
        if not _column_exists(conn, "paper_positions", "trade_mode"):
            conn.execute("ALTER TABLE paper_positions ADD COLUMN trade_mode TEXT NOT NULL DEFAULT 'paper'")
        if not _column_exists(conn, "paper_account_snapshots", "trade_mode"):
            conn.execute("ALTER TABLE paper_account_snapshots ADD COLUMN trade_mode TEXT NOT NULL DEFAULT 'paper'")
        if not _column_exists(conn, "paper_orders", "trade_mode"):
            conn.execute("ALTER TABLE paper_orders ADD COLUMN trade_mode TEXT NOT NULL DEFAULT 'paper'")


def load_kv(namespace: str, key: str, default: Any) -> Any:
    init_db()
    with get_conn() as conn:
        conn.execute(
            "SELECT value_json FROM kv_store WHERE namespace = %s AND key = %s",
            (namespace, key),
        )
        row = conn.fetchone()
    if not row:
        return default
    try:
        return json.loads(row["value_json"])
    except Exception:
        return default


def save_kv(namespace: str, key: str, value: Any) -> Any:
    init_db()
    payload = json.dumps(value, ensure_ascii=False)
    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO kv_store(namespace, key, value_json, updated_at)
            VALUES (%s, %s, %s, CURRENT_TIMESTAMP)
            ON CONFLICT(namespace, key)
            DO UPDATE SET value_json = EXCLUDED.value_json, updated_at = CURRENT_TIMESTAMP
            """,
            (namespace, key, payload),
        )
    return value
