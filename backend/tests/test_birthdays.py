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

    app.dependency_overrides.clear()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

BASE_URL = f"/api/households/{HOUSEHOLD_ID}/birthdays"


async def _create_birthday(client: AsyncClient, **overrides) -> dict:
    payload = {
        "person_name": "Alice",
        "birth_month": 6,
        "birth_day": 15,
        "birth_year": 1990,
    }
    payload.update(overrides)
    resp = await client.post(BASE_URL, json=payload)
    assert resp.status_code == 201, resp.text
    return resp.json()


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


async def test_crud_happy_path(client: AsyncClient):
    """1. CRUD happy path — create, list, update, delete."""
    # Create
    data = await _create_birthday(client, person_name="Bob", birth_month=3, birth_day=25, birth_year=1985)
    birthday_id = data["id"]
    assert data["person_name"] == "Bob"
    assert data["birth_month"] == 3
    assert data["birth_day"] == 25
    assert data["birth_year"] == 1985
    assert data["age"] is not None  # born 1985, should have an age

    # List
    resp = await client.get(BASE_URL)
    assert resp.status_code == 200
    items = resp.json()
    assert any(b["id"] == birthday_id for b in items)

    # Update
    resp = await client.patch(f"{BASE_URL}/{birthday_id}", json={"person_name": "Bobby"})
    assert resp.status_code == 200
    assert resp.json()["person_name"] == "Bobby"

    # Delete
    resp = await client.delete(f"{BASE_URL}/{birthday_id}")
    assert resp.status_code == 204

    # Verify deleted
    resp = await client.get(BASE_URL)
    assert resp.status_code == 200
    assert not any(b["id"] == birthday_id for b in resp.json())


async def test_birthday_without_birth_year(client: AsyncClient):
    """2. Birthday without birth_year — age should be null."""
    data = await _create_birthday(client, person_name="Ageless", birth_month=1, birth_day=1, birth_year=None)
    assert data["birth_year"] is None
    assert data["age"] is None


async def test_clear_birth_year_to_null(client: AsyncClient):
    """3. Clear birth_year to null — PATCH with birth_year: null should work."""
    data = await _create_birthday(client, person_name="ClearYear", birth_year=1995)
    birthday_id = data["id"]
    assert data["birth_year"] == 1995
    assert data["age"] is not None

    resp = await client.patch(f"{BASE_URL}/{birthday_id}", json={"birth_year": None})
    assert resp.status_code == 200
    updated = resp.json()
    assert updated["birth_year"] is None
    assert updated["age"] is None


async def test_invalid_day_for_month(client: AsyncClient):
    """4. Invalid day for month — Feb 30 should return 422."""
    resp = await client.post(BASE_URL, json={
        "person_name": "Invalid",
        "birth_month": 2,
        "birth_day": 30,
    })
    assert resp.status_code == 422


async def test_feb29_with_non_leap_year(client: AsyncClient):
    """5. Feb 29 with non-leap year — birth_year=1990 should return 422."""
    resp = await client.post(BASE_URL, json={
        "person_name": "BadLeap",
        "birth_month": 2,
        "birth_day": 29,
        "birth_year": 1990,
    })
    assert resp.status_code == 422


async def test_feb29_without_year(client: AsyncClient):
    """6. Feb 29 without year — should be accepted (leap day birthdays exist)."""
    data = await _create_birthday(client, person_name="LeapDay", birth_month=2, birth_day=29, birth_year=None)
    assert data["birth_month"] == 2
    assert data["birth_day"] == 29
    assert data["birth_year"] is None


async def test_feb29_with_leap_year(client: AsyncClient):
    """7. Feb 29 with leap year — birth_year=2000 should be accepted."""
    data = await _create_birthday(client, person_name="LeapYear", birth_month=2, birth_day=29, birth_year=2000)
    assert data["birth_month"] == 2
    assert data["birth_day"] == 29
    assert data["birth_year"] == 2000


async def test_cross_field_update_jan31_to_feb(client: AsyncClient):
    """8. Cross-field update validation — create with Jan 31, PATCH month to 2 should return 422."""
    data = await _create_birthday(client, person_name="Jan31", birth_month=1, birth_day=31, birth_year=None)
    birthday_id = data["id"]

    resp = await client.patch(f"{BASE_URL}/{birthday_id}", json={"birth_month": 2})
    assert resp.status_code == 422


async def test_cross_field_update_apr30_day_to_31(client: AsyncClient):
    """9. Cross-field update validation — create with Apr 30, PATCH day to 31 should return 422."""
    data = await _create_birthday(client, person_name="Apr30", birth_month=4, birth_day=30, birth_year=None)
    birthday_id = data["id"]

    resp = await client.patch(f"{BASE_URL}/{birthday_id}", json={"birth_day": 31})
    assert resp.status_code == 422


async def test_household_isolation(client: AsyncClient):
    """10. Household isolation — accessing birthday via wrong household_id should return 404."""
    # Create in the correct household
    data = await _create_birthday(client, person_name="Isolated")
    birthday_id = data["id"]

    other_url = f"/api/households/{OTHER_HOUSEHOLD_ID}/birthdays"

    # Listing from the wrong household should 404 (user is not a member)
    resp = await client.get(other_url)
    assert resp.status_code == 404

    # Creating in the wrong household should 404
    resp = await client.post(other_url, json={
        "person_name": "Hacked",
        "birth_month": 1,
        "birth_day": 1,
    })
    assert resp.status_code == 404

    # PATCH via wrong household should 404
    resp = await client.patch(f"{other_url}/{birthday_id}", json={"person_name": "Hacked"})
    assert resp.status_code == 404

    # DELETE via wrong household should 404
    resp = await client.delete(f"{other_url}/{birthday_id}")
    assert resp.status_code == 404
