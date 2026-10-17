import os
import uuid

# Env vars must be set before importing app modules
os.environ.setdefault("SECRET_KEY", "a" * 64)
os.environ.setdefault("OIDC_ISSUER_URL", "https://auth.example.com")
os.environ.setdefault("OIDC_CLIENT_ID", "test-client")

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.database import Base
from app.models.household import Household, HouseholdMember
from app.models.user import User

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

USER_ID = "test-user-001"
HOUSEHOLD_ID = "test-household-001"
OTHER_HOUSEHOLD_ID = "test-household-002"


@pytest.fixture
async def db_session():
    """Create an in-memory database with all tables and seed data."""
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    session_factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with session_factory() as session:
        # Seed user
        session.add(User(id=USER_ID, email="test@example.com", display_name="Test User"))
        # Seed household + membership
        session.add(Household(id=HOUSEHOLD_ID, name="Test Home", created_by=USER_ID))
        session.add(HouseholdMember(household_id=HOUSEHOLD_ID, user_id=USER_ID))
        # Seed a second household the user is NOT a member of
        session.add(Household(id=OTHER_HOUSEHOLD_ID, name="Other Home", created_by=USER_ID))
        await session.commit()
        yield session

    await engine.dispose()


@pytest.fixture
async def client(db_session: AsyncSession):
    """Create an HTTPX AsyncClient wired to the FastAPI app with auth + DB overrides."""
    from app.auth import get_current_user_id
    from app.database import get_db
    from app.main import app

    async def override_get_db():
        yield db_session

    async def override_get_current_user_id():
        return USER_ID

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_current_user_id] = override_get_current_user_id

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as ac:
        yield ac


async def test_create_list_with_kind_returns_kind(client):
    r = await client.post(f"/api/households/{HOUSEHOLD_ID}/lists", json={"name": "Weekly", "kind": "groceries"})
    assert r.status_code == 201 and r.json()["kind"] == "groceries"


async def test_list_endpoint_includes_kind(client):
    await client.post(f"/api/households/{HOUSEHOLD_ID}/lists", json={"name": "Trip", "kind": "packing"})
    r = await client.get(f"/api/households/{HOUSEHOLD_ID}/lists")
    assert [item["kind"] for item in r.json()] == ["packing"]


async def test_kind_defaults_to_other(client):
    r = await client.post(f"/api/households/{HOUSEHOLD_ID}/lists", json={"name": "Misc"})
    assert r.status_code == 201 and r.json()["kind"] == "other"


async def test_invalid_kind_rejected(client):
    r = await client.post(f"/api/households/{HOUSEHOLD_ID}/lists", json={"name": "X", "kind": "food"})
    assert r.status_code == 422


async def test_patch_kind(client):
    created = await client.post(f"/api/households/{HOUSEHOLD_ID}/lists", json={"name": "Gifts"})
    list_id = created.json()["id"]
    r = await client.patch(f"/api/households/{HOUSEHOLD_ID}/lists/{list_id}", json={"kind": "wishlist"})
    assert r.status_code == 200 and r.json()["kind"] == "wishlist"
