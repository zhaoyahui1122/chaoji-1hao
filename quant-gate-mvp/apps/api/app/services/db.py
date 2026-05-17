from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Any

BASE_DIR = Path(__file__).resolve().parents[4]
STATE_DIR = BASE_DIR / "state"
STATE_DIR.mkdir(parents=True, exist_ok=True)
DB_PATH = STATE_DIR / "quant_gate.db"


def _column_exists(conn: sqlite3.Connection, table: str, column: str) -> bool:
    rows = conn.execute(f"PRAGMA table_info({table})").fetchall()
    return any(row[1] == column for row in rows)


def get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    with get_conn() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS kv_store (
                namespace TEXT NOT NULL,
                key TEXT NOT NULL,
                value_json TEXT NOT NULL,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY(namespace, key)
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS paper_positions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                position_id TEXT,
                symbol TEXT NOT NULL,
                side TEXT NOT NULL,
                leverage INTEGER NOT NULL,
                qty REAL NOT NULL,
                entry_price REAL NOT NULL,
                mark_price REAL NOT NULL,
                status TEXT NOT NULL DEFAULT 'open',
                opened_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                closed_at DATETIME,
                close_price REAL,
                realized_pnl REAL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS paper_orders (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                position_id TEXT,
                symbol TEXT NOT NULL,
                side TEXT NOT NULL,
                price REAL NOT NULL,
                qty REAL NOT NULL,
                status TEXT NOT NULL,
                event_type TEXT NOT NULL DEFAULT 'open',
                source TEXT NOT NULL DEFAULT 'manual',
                meta_json TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS paper_account_snapshots (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                initial_balance REAL NOT NULL,
                realized_pnl REAL NOT NULL,
                equity REAL NOT NULL,
                available_balance REAL NOT NULL,
                margin_used REAL NOT NULL,
                margin_ratio REAL NOT NULL,
                unrealized_pnl REAL NOT NULL,
                open_positions INTEGER NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        if not _column_exists(conn, "paper_positions", "position_id"):
            conn.execute("ALTER TABLE paper_positions ADD COLUMN position_id TEXT")
        if not _column_exists(conn, "paper_positions", "fee_rate"):
            conn.execute("ALTER TABLE paper_positions ADD COLUMN fee_rate REAL NOT NULL DEFAULT 0.0005")
        if not _column_exists(conn, "paper_positions", "slippage_rate"):
            conn.execute("ALTER TABLE paper_positions ADD COLUMN slippage_rate REAL NOT NULL DEFAULT 0.0002")
        if not _column_exists(conn, "paper_positions", "entry_fee"):
            conn.execute("ALTER TABLE paper_positions ADD COLUMN entry_fee REAL NOT NULL DEFAULT 0")
        if not _column_exists(conn, "paper_positions", "cumulative_fees"):
            conn.execute("ALTER TABLE paper_positions ADD COLUMN cumulative_fees REAL NOT NULL DEFAULT 0")
        if not _column_exists(conn, "paper_positions", "entry_slippage_cost"):
            conn.execute("ALTER TABLE paper_positions ADD COLUMN entry_slippage_cost REAL NOT NULL DEFAULT 0")
        if not _column_exists(conn, "paper_positions", "exit_slippage_cost"):
            conn.execute("ALTER TABLE paper_positions ADD COLUMN exit_slippage_cost REAL NOT NULL DEFAULT 0")
        if not _column_exists(conn, "paper_positions", "cumulative_slippage_cost"):
            conn.execute("ALTER TABLE paper_positions ADD COLUMN cumulative_slippage_cost REAL NOT NULL DEFAULT 0")
        if not _column_exists(conn, "paper_orders", "event_type"):
            conn.execute("ALTER TABLE paper_orders ADD COLUMN event_type TEXT NOT NULL DEFAULT 'open'")
        if not _column_exists(conn, "paper_orders", "position_id"):
            conn.execute("ALTER TABLE paper_orders ADD COLUMN position_id TEXT")
        if not _column_exists(conn, "paper_orders", "source"):
            conn.execute("ALTER TABLE paper_orders ADD COLUMN source TEXT NOT NULL DEFAULT 'manual'")
        if not _column_exists(conn, "paper_orders", "meta_json"):
            conn.execute("ALTER TABLE paper_orders ADD COLUMN meta_json TEXT")
        conn.commit()


def load_kv(namespace: str, key: str, default: Any) -> Any:
    init_db()
    with get_conn() as conn:
        row = conn.execute(
            "SELECT value_json FROM kv_store WHERE namespace = ? AND key = ?",
            (namespace, key),
        ).fetchone()
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
            VALUES (?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(namespace, key)
            DO UPDATE SET value_json = excluded.value_json, updated_at = CURRENT_TIMESTAMP
            """,
            (namespace, key, payload),
        )
        conn.commit()
    return value
