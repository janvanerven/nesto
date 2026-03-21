import os

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

# Env vars must be set before importing app modules
os.environ.setdefault("SECRET_KEY", "a" * 64)
os.environ.setdefault("OIDC_ISSUER_URL", "https://auth.example.com")
os.environ.setdefault("OIDC_CLIENT_ID", "test-client")

from app.models.calendar_sync import CalendarConnection


@pytest.fixture
async def db():
    """Create an in-memory database for testing."""
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
    from app.database import Base

    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    session_factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with session_factory() as session:
        yield session

    await engine.dispose()


async def test_create_connection(db: AsyncSession):
    from app.services.calendar_connection_service import create_connection
    from app.schemas.calendar_sync import CalendarConnectionCreate

    data = CalendarConnectionCreate(
        name="Test Calendar",
        provider="caldav",
        server_url="https://caldav.example.com",
        calendar_url="https://caldav.example.com/user/calendar",
        username="testuser",
        password="testpass",
        color="#FF6B6B",
    )
    conn = await create_connection(db, "household-1", "user-1", data)

    assert conn.id is not None
    assert conn.name == "Test Calendar"
    assert conn.encrypted_password != "testpass"
    assert conn.enabled is True
    assert conn.error_count == 0


async def test_list_connections(db: AsyncSession):
    from app.services.calendar_connection_service import create_connection, list_connections
    from app.schemas.calendar_sync import CalendarConnectionCreate

    data = CalendarConnectionCreate(
        name="Cal 1",
        provider="caldav",
        server_url="https://caldav.example.com",
        calendar_url="https://caldav.example.com/cal1",
        username="user",
        password="pass",
    )
    await create_connection(db, "hh-1", "user-1", data)

    connections = await list_connections(db, "hh-1", "user-1")
    assert len(connections) == 1
    assert connections[0].name == "Cal 1"


async def test_delete_connection(db: AsyncSession):
    from app.services.calendar_connection_service import create_connection, delete_connection, list_connections
    from app.schemas.calendar_sync import CalendarConnectionCreate

    data = CalendarConnectionCreate(
        name="To Delete",
        provider="caldav",
        server_url="https://caldav.example.com",
        calendar_url="https://caldav.example.com/cal",
        username="user",
        password="pass",
    )
    conn = await create_connection(db, "hh-1", "user-1", data)
    await delete_connection(db, conn.id, "user-1")

    connections = await list_connections(db, "hh-1", "user-1")
    assert len(connections) == 0
