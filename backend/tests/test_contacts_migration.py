import asyncio
import sqlite3
from pathlib import Path

from alembic import command
from alembic.config import Config

BACKEND_DIR = Path(__file__).resolve().parent.parent

BIRTHDAYS = [
    ("b-leap", "Leap", 2, 29, None, "2024-01-02 03:04:05", "2024-02-03 04:05:06"),
    ("b-full", "Full", 7, 14, 1985, "2023-05-06 07:08:09", "2023-06-07 08:09:10"),
]


def _config(db_path: Path) -> Config:
    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    cfg.set_main_option("sqlalchemy.url", f"sqlite+aiosqlite:///{db_path}")
    return cfg


def _rows(db_path: Path, sql: str) -> list[tuple]:
    with sqlite3.connect(db_path) as conn:
        return conn.execute(sql).fetchall()


def _tables(db_path: Path) -> set[str]:
    return {r[0] for r in _rows(db_path, "SELECT name FROM sqlite_master WHERE type='table'")}


async def test_migration_moves_birthdays_to_people(tmp_path):
    db_path = tmp_path / "m.db"
    cfg = _config(db_path)
    # env.py calls asyncio.run(), so run alembic outside the test's event loop.
    await asyncio.to_thread(command.upgrade, cfg, "b7c8d9e0f1a2")

    with sqlite3.connect(db_path) as conn:
        conn.execute("INSERT INTO users (id, email, display_name) VALUES ('u1', 'u@x', 'U')")
        conn.execute("INSERT INTO households (id, name, created_by) VALUES ('h1', 'Home', 'u1')")
        conn.executemany(
            "INSERT INTO birthdays (id, household_id, person_name, birth_month, birth_day, birth_year, "
            "created_by, created_at, updated_at) VALUES (?, 'h1', ?, ?, ?, ?, 'u1', ?, ?)",
            BIRTHDAYS,
        )

    await asyncio.to_thread(command.upgrade, cfg, "head")

    tables = _tables(db_path)
    assert "birthdays" not in tables
    assert {"people", "contact_addresses"} <= tables
    people = _rows(
        db_path,
        "SELECT id, name, birth_month, birth_day, birth_year, created_at, updated_at, "
        "household_id, created_by, address_id, phone, email, notes FROM people ORDER BY id",
    )
    assert people == [(*b, "h1", "u1", None, "", "", "") for b in sorted(BIRTHDAYS)]

    await asyncio.to_thread(command.downgrade, cfg, "-1")

    tables = _tables(db_path)
    assert "birthdays" in tables
    assert not {"people", "contact_addresses"} & tables
    rows = _rows(
        db_path,
        "SELECT id, person_name, birth_month, birth_day, birth_year, created_at, updated_at "
        "FROM birthdays ORDER BY id",
    )
    assert rows == sorted(BIRTHDAYS)
    indexes = {r[0] for r in _rows(db_path, "SELECT name FROM sqlite_master WHERE type='index'")}
    assert "ix_birthdays_household_id" in indexes
