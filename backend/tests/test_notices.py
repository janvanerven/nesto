import os
import uuid

os.environ.setdefault("SECRET_KEY", "a" * 64)
os.environ.setdefault("OIDC_ISSUER_URL", "https://auth.example.com")
os.environ.setdefault("OIDC_CLIENT_ID", "test-client")

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.database import Base
from app.models.household import Household, HouseholdMember
from app.models.notice import HouseholdNotice  # must import to register with Base.metadata
from app.models.reminder_sent import ReminderSent  # noqa: F401
from app.models.user import User

USER_ID = "user-001"
OTHER_USER_ID = "user-002"
HOUSEHOLD_ID = "hh-001"


@pytest.fixture
async def db_session():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with factory() as session:
        session.add(User(id=USER_ID, email="jan@example.com", display_name="Jan"))
        session.add(User(id=OTHER_USER_ID, email="other@example.com", display_name="Other"))
        session.add(Household(id=HOUSEHOLD_ID, name="Home", created_by=USER_ID))
        session.add(HouseholdMember(household_id=HOUSEHOLD_ID, user_id=USER_ID))
        session.add(HouseholdMember(household_id=HOUSEHOLD_ID, user_id=OTHER_USER_ID))
        await session.commit()
        yield session
    await engine.dispose()


@pytest.fixture
async def client(db_session):
    from app.auth import get_current_user_id
    from app.database import get_db
    from app.main import app

    async def override_db():
        yield db_session

    async def override_auth():
        return USER_ID

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_current_user_id] = override_auth
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c
    app.dependency_overrides.clear()




async def test_list_notices_empty(client):
    r = await client.get(f"/api/households/{HOUSEHOLD_ID}/notices")
    assert r.status_code == 200
    assert r.json() == []


async def test_create_notice(client):
    r = await client.post(f"/api/households/{HOUSEHOLD_ID}/notices",
                          json={"content": "Don't forget milk"})
    assert r.status_code == 201
    data = r.json()
    assert data["content"] == "Don't forget milk"
    assert data["author_id"] == USER_ID
    assert data["pinned"] is False


async def test_create_notice_too_long(client):
    r = await client.post(f"/api/households/{HOUSEHOLD_ID}/notices",
                          json={"content": "x" * 501})
    assert r.status_code == 422


async def test_pinned_notices_appear_first(client):
    await client.post(f"/api/households/{HOUSEHOLD_ID}/notices", json={"content": "First"})
    r2 = await client.post(f"/api/households/{HOUSEHOLD_ID}/notices", json={"content": "Second"})
    notice_id = r2.json()["id"]
    await client.patch(f"/api/households/{HOUSEHOLD_ID}/notices/{notice_id}", json={"pinned": True})
    r = await client.get(f"/api/households/{HOUSEHOLD_ID}/notices")
    assert r.json()[0]["id"] == notice_id  # pinned notice is first


async def test_other_user_cannot_edit_content(client):
    r = await client.post(f"/api/households/{HOUSEHOLD_ID}/notices", json={"content": "Original"})
    notice_id = r.json()["id"]
    # Switch auth to OTHER_USER_ID for this request
    from app.auth import get_current_user_id
    from app.main import app
    app.dependency_overrides[get_current_user_id] = lambda: OTHER_USER_ID
    r2 = await client.patch(
        f"/api/households/{HOUSEHOLD_ID}/notices/{notice_id}",
        json={"content": "Hacked"}
    )
    app.dependency_overrides[get_current_user_id] = lambda: USER_ID
    assert r2.status_code == 403


async def test_author_can_delete_own_notice(client):
    r = await client.post(f"/api/households/{HOUSEHOLD_ID}/notices", json={"content": "Delete me"})
    notice_id = r.json()["id"]
    r2 = await client.delete(f"/api/households/{HOUSEHOLD_ID}/notices/{notice_id}")
    assert r2.status_code == 204


async def test_non_author_non_admin_cannot_delete(client):
    r = await client.post(f"/api/households/{HOUSEHOLD_ID}/notices", json={"content": "Mine"})
    notice_id = r.json()["id"]
    # Switch auth to OTHER_USER_ID (non-author, non-admin)
    from app.auth import get_current_user_id
    from app.main import app
    app.dependency_overrides[get_current_user_id] = lambda: OTHER_USER_ID
    r2 = await client.delete(f"/api/households/{HOUSEHOLD_ID}/notices/{notice_id}")
    app.dependency_overrides[get_current_user_id] = lambda: USER_ID
    assert r2.status_code == 403


async def test_pagination(client):
    for i in range(5):
        await client.post(f"/api/households/{HOUSEHOLD_ID}/notices", json={"content": f"Notice {i}"})
    r = await client.get(f"/api/households/{HOUSEHOLD_ID}/notices?limit=2&offset=0")
    assert len(r.json()) == 2
    r2 = await client.get(f"/api/households/{HOUSEHOLD_ID}/notices?limit=2&offset=2")
    assert len(r2.json()) == 2
