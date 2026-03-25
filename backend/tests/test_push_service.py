import os
from unittest.mock import MagicMock, patch

os.environ.setdefault("SECRET_KEY", "a" * 64)
os.environ.setdefault("OIDC_ISSUER_URL", "https://auth.example.com")
os.environ.setdefault("OIDC_CLIENT_ID", "test-client")

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.database import Base
from app.models.household import Household, HouseholdMember
from app.models.notice import HouseholdNotice  # noqa: F401 — register with Base.metadata
from app.models.push_subscription import PushSubscription
from app.models.reminder_sent import ReminderSent  # noqa: F401
from app.models.user import User

USER_ID = "user-001"
HOUSEHOLD_ID = "hh-001"


async def _make_db():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    session = factory()
    session.add(User(id=USER_ID, email="jan@example.com", display_name="Jan"))
    session.add(Household(id=HOUSEHOLD_ID, name="Home", created_by=USER_ID))
    session.add(HouseholdMember(household_id=HOUSEHOLD_ID, user_id=USER_ID))
    session.add(PushSubscription(
        id="sub-001",
        user_id=USER_ID,
        endpoint="https://push.example.com/sub1",
        p256dh="abc123",
        auth="def456",
    ))
    await session.commit()
    return session, engine


async def test_send_push_skips_without_vapid():
    session, engine = await _make_db()
    try:
        from app.services.push_service import send_push_to_user
        count = await send_push_to_user(session, USER_ID, "Test", "Body", "/")
        assert count == 0
    finally:
        await session.close()
        await engine.dispose()


async def test_send_push_skips_no_subscriptions():
    session, engine = await _make_db()
    try:
        from app.services.push_service import send_push_to_user
        with patch("app.services.push_service.settings") as mock_settings:
            mock_settings.vapid_private_key = "fake-key"
            mock_settings.smtp_from = "test@example.com"
            count = await send_push_to_user(session, "no-such-user", "Test", "Body", "/")
        assert count == 0
    finally:
        await session.close()
        await engine.dispose()


async def test_send_push_success():
    session, engine = await _make_db()
    try:
        from app.services.push_service import send_push_to_user
        with (
            patch("app.services.push_service.settings") as mock_settings,
            patch("app.services.push_service._send_push_sync") as mock_sync,
        ):
            mock_settings.vapid_private_key = "fake-key"
            mock_settings.smtp_from = "test@example.com"
            count = await send_push_to_user(session, USER_ID, "Hello", "World", "/tasks")
        assert count == 1
        mock_sync.assert_called_once()
    finally:
        await session.close()
        await engine.dispose()


async def test_send_push_removes_expired_subscription():
    from pywebpush import WebPushException
    session, engine = await _make_db()
    try:
        from app.services.push_service import send_push_to_user

        expired_response = MagicMock()
        expired_response.status_code = 410

        def raise_410(*args, **kwargs):
            raise WebPushException("Gone", response=expired_response)

        with (
            patch("app.services.push_service.settings") as mock_settings,
            patch("app.services.push_service._send_push_sync", side_effect=raise_410),
        ):
            mock_settings.vapid_private_key = "fake-key"
            mock_settings.smtp_from = "test@example.com"
            count = await send_push_to_user(session, USER_ID, "Test", "Body", "/")

        await session.commit()  # flush → commit to persist the delete
        assert count == 0
        result = await session.execute(
            select(PushSubscription).where(PushSubscription.user_id == USER_ID)
        )
        assert result.scalar_one_or_none() is None
    finally:
        await session.close()
        await engine.dispose()
