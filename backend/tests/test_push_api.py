import os
from urllib.parse import quote

os.environ.setdefault("SECRET_KEY", "a" * 64)
os.environ.setdefault("OIDC_ISSUER_URL", "https://auth.example.com")
os.environ.setdefault("OIDC_CLIENT_ID", "test-client")

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from httpx import ASGITransport, AsyncClient

from app.database import Base
from app.models.household import Household, HouseholdMember
from app.models.notice import HouseholdNotice  # noqa: F401 — register with Base.metadata
from app.models.push_subscription import PushSubscription
from app.models.reminder_sent import ReminderSent  # noqa: F401
from app.models.user import User

USER_ID = "user-001"


async def _make_client():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    session = factory()
    session.add(User(id=USER_ID, email="jan@example.com", display_name="Jan"))
    await session.commit()

    from app.auth import get_current_user_id
    from app.database import get_db
    from app.main import app

    async def override_db():
        yield session

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_current_user_id] = lambda: USER_ID

    client = AsyncClient(transport=ASGITransport(app=app), base_url="http://test")
    return client, session, engine


async def _teardown(client, session, engine):
    await client.aclose()
    from app.auth import get_current_user_id
    from app.database import get_db
    from app.main import app
    app.dependency_overrides.pop(get_db, None)
    app.dependency_overrides.pop(get_current_user_id, None)
    await session.close()
    await engine.dispose()


async def test_save_push_subscription():
    client, session, engine = await _make_client()
    try:
        r = await client.post("/api/auth/me/push-subscription", json={
            "endpoint": "https://push.example.com/sub1",
            "p256dh": "abc123",
            "auth": "def456",
        })
        assert r.status_code == 204
        result = await session.execute(
            select(PushSubscription).where(PushSubscription.user_id == USER_ID)
        )
        sub = result.scalar_one_or_none()
        assert sub is not None
        assert sub.endpoint == "https://push.example.com/sub1"
    finally:
        await _teardown(client, session, engine)


async def test_save_push_subscription_upserts():
    client, session, engine = await _make_client()
    try:
        payload = {"endpoint": "https://push.example.com/sub1", "p256dh": "aaa", "auth": "bbb"}
        await client.post("/api/auth/me/push-subscription", json=payload)
        updated = {**payload, "p256dh": "ccc", "auth": "ddd"}
        r = await client.post("/api/auth/me/push-subscription", json=updated)
        assert r.status_code == 204
        result = await session.execute(
            select(PushSubscription).where(PushSubscription.user_id == USER_ID)
        )
        subs = result.scalars().all()
        assert len(subs) == 1
        assert subs[0].p256dh == "ccc"
    finally:
        await _teardown(client, session, engine)


async def test_save_push_subscription_rejects_non_https():
    client, session, engine = await _make_client()
    try:
        r = await client.post("/api/auth/me/push-subscription", json={
            "endpoint": "http://push.example.com/sub1",
            "p256dh": "abc",
            "auth": "def",
        })
        assert r.status_code == 422
    finally:
        await _teardown(client, session, engine)


async def test_delete_push_subscription():
    client, session, engine = await _make_client()
    try:
        endpoint = "https://push.example.com/sub1"
        await client.post("/api/auth/me/push-subscription", json={
            "endpoint": endpoint, "p256dh": "abc", "auth": "def",
        })
        r = await client.delete(f"/api/auth/me/push-subscription?endpoint={quote(endpoint, safe='')}")
        assert r.status_code == 204
        result = await session.execute(
            select(PushSubscription).where(PushSubscription.user_id == USER_ID)
        )
        assert result.scalar_one_or_none() is None
    finally:
        await _teardown(client, session, engine)


async def test_delete_nonexistent_subscription_is_idempotent():
    client, session, engine = await _make_client()
    try:
        endpoint = "https://push.example.com/not-exist"
        r = await client.delete(f"/api/auth/me/push-subscription?endpoint={quote(endpoint, safe='')}")
        assert r.status_code == 204
    finally:
        await _teardown(client, session, engine)
