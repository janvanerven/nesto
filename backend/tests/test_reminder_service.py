import os
import uuid
from datetime import date, datetime, timedelta

os.environ.setdefault("SECRET_KEY", "a" * 64)
os.environ.setdefault("OIDC_ISSUER_URL", "https://auth.example.com")
os.environ.setdefault("OIDC_CLIENT_ID", "test-client")

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.database import Base
from app.models.event import Event
from app.models.household import Household, HouseholdMember
from app.models.reminder_sent import ReminderSent
from app.models.task import Task
from app.models.user import User

USER_ID = "user-001"
HOUSEHOLD_ID = "hh-001"


@pytest.fixture
async def db():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with factory() as session:
        session.add(User(id=USER_ID, email="jan@example.com", display_name="Jan",
                         reminders_tasks=True, reminders_events=True))
        session.add(Household(id=HOUSEHOLD_ID, name="Home", created_by=USER_ID))
        session.add(HouseholdMember(household_id=HOUSEHOLD_ID, user_id=USER_ID))
        await session.commit()
        yield session
    await engine.dispose()


@pytest.mark.asyncio
async def test_already_sent_false_initially(db):
    from app.services.reminder_service import _already_sent
    result = await _already_sent(db, "task", "task-1", date.today())
    assert result is False


@pytest.mark.asyncio
async def test_record_sent_marks_as_sent(db):
    from app.services.reminder_service import _already_sent, _record_sent
    await _record_sent(db, "task", "task-1", date.today())
    assert await _already_sent(db, "task", "task-1", date.today()) is True


@pytest.mark.asyncio
async def test_different_channel_not_deduplicated(db):
    from app.services.reminder_service import _already_sent, _record_sent
    await _record_sent(db, "task", "task-1", date.today(), channel="email")
    assert await _already_sent(db, "task", "task-1", date.today(), channel="push") is False


@pytest.mark.asyncio
async def test_run_task_reminders_skips_without_smtp(db):
    from app.services.reminder_service import run_task_reminders
    # smtp_host is not set in test env — should return 0 immediately
    count = await run_task_reminders(db)
    assert count == 0


@pytest.mark.asyncio
async def test_cleanup_removes_old_records(db):
    from app.services.reminder_service import _record_sent, cleanup_old_reminders
    from sqlalchemy import select
    old_date = date.today() - timedelta(days=40)
    await _record_sent(db, "task", "old-task", old_date)
    await cleanup_old_reminders(db, days=30)
    result = await db.execute(select(ReminderSent).where(ReminderSent.entity_id == "old-task"))
    assert result.scalar_one_or_none() is None
