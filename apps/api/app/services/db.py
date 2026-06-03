from __future__ import annotations

import json
import os
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Any

# ── Detect backend ──────────────────────────────────────────────
DATABASE_URL = os.environ.get("DATABASE_URL", "")
_USE_PG = DATABASE_URL.startswith("postgresql://")

if _USE_PG:
    import psycopg2
    import psycopg2.extras
    import psycopg2.pool
    _pool: psycopg2.pool.ThreadedConnectionPool | None = None
else:
    BASE_DIR = Path(__file__).resolve().parents[4]
    STATE_DIR = Path(os.environ.get("STATE_DIR", str(BASE_DIR / "state")))
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    DB_PATH = STATE_DIR / "quant_gate.db"


# ── PostgreSQL backend ──────────────────────────────────────────

def _pg_get_pool() -> psycopg2.pool.ThreadedConnectionPool:
    global _pool
    if _pool is None:
        _pool = psycopg2.pool.ThreadedConnectionPool(
            minconn=2, maxconn=10, dsn=DATABASE_URL,
        )
    return _pool


class _PgConnWrapper:
    def __init__(self, conn):
        self._conn = conn
        self._cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    @property
    def row_factory(self):
        return None

    @row_factory.setter
    def row_factory(self, _val):
        pass

    def execute(self, sql, params=None):
        self._cur.execute(sql.replace("?", "%s"), params)
        return self

    def executemany(self, sql, param_list):
        self._cur.executemany(sql.replace("?", "%s"), param_list)
        return self

    def fetchone(self):
        return self._cur.fetchone()

    def fetchall(self):
        return self._cur.fetchall()

    @property
    def lastrowid(self):
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
def _pg_get_conn():
    pool = _pg_get_pool()
    raw = pool.getconn()
    wrapper = _PgConnWrapper(raw)
    try:
        yield wrapper
        wrapper.commit()
    except Exception:
        wrapper.rollback()
        raise
    finally:
        pool.putconn(raw)


# ── SQLite backend ──────────────────────────────────────────────

class _SqliteConnWrapper:
    """Wraps sqlite3.Connection to match _PgConnWrapper interface."""

    def __init__(self, conn):
        self._conn = conn
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA busy_timeout=5000")

    @property
    def row_factory(self):
        return self._conn.row_factory

    @row_factory.setter
    def row_factory(self, val):
        self._conn.row_factory = val

    def execute(self, sql, params=None):
        self._cur = self._conn.execute(sql, params or ())
        return self

    def executemany(self, sql, param_list):
        self._cur = self._conn.executemany(sql, param_list)
        return self

    def fetchone(self):
        return self._cur.fetchone()

    def fetchall(self):
        return self._cur.fetchall()

    @property
    def lastrowid(self):
        return self._cur.lastrowid

    def commit(self):
        self._conn.commit()

    def rollback(self):
        self._conn.rollback()

    def close(self):
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
def _sqlite_get_conn():
    raw = sqlite3.connect(DB_PATH, timeout=10)
    wrapper = _SqliteConnWrapper(raw)
    try:
        yield wrapper
        wrapper.commit()
    except Exception:
        wrapper.rollback()
        raise
    finally:
        raw.close()


# ── Unified API ─────────────────────────────────────────────────

def get_conn():
    if _USE_PG:
        return _pg_get_conn()
    return _sqlite_get_conn()


def _column_exists(conn, table: str, column: str) -> bool:
    if _USE_PG:
        conn.execute(
            "SELECT 1 FROM information_schema.columns WHERE table_name = %s AND column_name = %s",
            (table, column),
        )
        return conn.fetchone() is not None
    else:
        rows = conn.execute(f"PRAGMA table_info({table})").fetchall()
        return any(row[1] == column for row in rows)


def _col_type(name: str) -> str:
    """Return column type appropriate for the current backend."""
    if _USE_PG:
        mapping = {
            "SERIAL": "SERIAL",
            "DATETIME": "TIMESTAMP",
            "REAL": "DOUBLE PRECISION",
        }
        return mapping.get(name, name)
    mapping = {
        "SERIAL": "INTEGER PRIMARY KEY AUTOINCREMENT",
        "DATETIME": "DATETIME",
        "REAL": "REAL",
    }
    return mapping.get(name, name)


def init_db() -> None:
    serial = _col_type("SERIAL")
    dt = _col_type("DATETIME")
    real = _col_type("REAL")

    with get_conn() as conn:
        conn.execute(
            f"""
            CREATE TABLE IF NOT EXISTS kv_store (
                namespace TEXT NOT NULL,
                key TEXT NOT NULL,
                value_json TEXT NOT NULL,
                updated_at {dt} DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY(namespace, key)
            )
            """
        )
        conn.execute(
            f"""
            CREATE TABLE IF NOT EXISTS paper_positions (
                id {serial},
                position_id TEXT,
                symbol TEXT NOT NULL,
                side TEXT NOT NULL,
                leverage INTEGER NOT NULL,
                qty {real} NOT NULL,
                entry_price {real} NOT NULL,
                mark_price {real} NOT NULL,
                status TEXT NOT NULL DEFAULT 'open',
                opened_at {dt} DEFAULT CURRENT_TIMESTAMP,
                closed_at {dt},
                close_price {real},
                realized_pnl {real}
            )
            """
        )
        conn.execute(
            f"""
            CREATE TABLE IF NOT EXISTS paper_orders (
                id {serial},
                position_id TEXT,
                symbol TEXT NOT NULL,
                side TEXT NOT NULL,
                price {real} NOT NULL,
                qty {real} NOT NULL,
                status TEXT NOT NULL,
                event_type TEXT NOT NULL DEFAULT 'open',
                source TEXT NOT NULL DEFAULT 'manual',
                meta_json TEXT,
                created_at {dt} DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        conn.execute(
            f"""
            CREATE TABLE IF NOT EXISTS paper_account_snapshots (
                id {serial},
                initial_balance {real} NOT NULL,
                realized_pnl {real} NOT NULL,
                equity {real} NOT NULL,
                available_balance {real} NOT NULL,
                margin_used {real} NOT NULL,
                margin_ratio {real} NOT NULL,
                unrealized_pnl {real} NOT NULL,
                open_positions INTEGER NOT NULL,
                created_at {dt} DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        conn.execute(
            f"""
            CREATE TABLE IF NOT EXISTS strategy_snapshots (
                id {serial},
                config_json TEXT NOT NULL,
                label TEXT,
                created_at {dt} DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        conn.execute(
            f"""
            CREATE TABLE IF NOT EXISTS drawdown_tracker (
                id INTEGER PRIMARY KEY,
                peak_equity {real} NOT NULL,
                max_drawdown_pct {real} NOT NULL DEFAULT 0,
                peak_date {dt} DEFAULT CURRENT_TIMESTAMP
            )
            """
        )

        # Migration: add columns added after initial schema
        for table, column, col_def in [
            ("paper_positions", "position_id", "TEXT"),
            ("paper_positions", "fee_rate", f"{real} NOT NULL DEFAULT 0.0005"),
            ("paper_positions", "slippage_rate", f"{real} NOT NULL DEFAULT 0.0002"),
            ("paper_positions", "entry_fee", f"{real} NOT NULL DEFAULT 0"),
            ("paper_positions", "cumulative_fees", f"{real} NOT NULL DEFAULT 0"),
            ("paper_positions", "entry_slippage_cost", f"{real} NOT NULL DEFAULT 0"),
            ("paper_positions", "exit_slippage_cost", f"{real} NOT NULL DEFAULT 0"),
            ("paper_positions", "cumulative_slippage_cost", f"{real} NOT NULL DEFAULT 0"),
            ("paper_orders", "event_type", "TEXT NOT NULL DEFAULT 'open'"),
            ("paper_orders", "position_id", "TEXT"),
            ("paper_orders", "source", "TEXT NOT NULL DEFAULT 'manual'"),
            ("paper_orders", "meta_json", "TEXT"),
            ("paper_positions", "stop_loss_price", f"{real} NOT NULL DEFAULT 0"),
            ("paper_positions", "take_profit_price", f"{real} NOT NULL DEFAULT 0"),
            ("paper_positions", "trade_mode", "TEXT NOT NULL DEFAULT 'paper'"),
            ("paper_account_snapshots", "trade_mode", "TEXT NOT NULL DEFAULT 'paper'"),
            ("paper_orders", "trade_mode", "TEXT NOT NULL DEFAULT 'paper'"),
        ]:
            if not _column_exists(conn, table, column):
                conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {col_def}")

        if not _USE_PG:
            conn.commit()


def load_kv(namespace: str, key: str, default: Any) -> Any:
    init_db()
    with get_conn() as conn:
        conn.execute(
            "SELECT value_json FROM kv_store WHERE namespace = ? AND key = ?",
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
        if _USE_PG:
            conn.execute(
                """
                INSERT INTO kv_store(namespace, key, value_json, updated_at)
                VALUES (?, ?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(namespace, key)
                DO UPDATE SET value_json = EXCLUDED.value_json, updated_at = CURRENT_TIMESTAMP
                """,
                (namespace, key, payload),
            )
        else:
            conn.execute(
                """
                INSERT INTO kv_store(namespace, key, value_json, updated_at)
                VALUES (?, ?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(namespace, key)
                DO UPDATE SET value_json = excluded.value_json, updated_at = CURRENT_TIMESTAMP
                """,
                (namespace, key, payload),
            )
            conn.commit()
    return value
