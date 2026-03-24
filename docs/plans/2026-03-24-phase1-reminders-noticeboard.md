# Phase 1: Email Reminders + Notice Board — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add task/event email reminders and a household notice board so Nesto speaks to users and gives the household a shared communication layer.

**Architecture:** One Alembic migration adds all new tables and columns. Backend splits into two independent tracks: a reminder service (scheduler + email) and a notice service (CRUD + API). Frontend adds a `/notices` route with its own bottom nav tab. All tasks after Task 1 fan out in parallel batches.

**Tech Stack:** FastAPI, SQLAlchemy 2.0 async, aiosmtplib (already in `digest_service.py`), React 19, TanStack Router, TanStack Query, Tailwind CSS v4, Framer Motion.

---

## Parallelism Map

```
Task 1: DB Migration
    │
    ├─── Batch A (parallel) ────────────────────────────────────────────────┐
    │    Task 2: HouseholdNotice + ReminderSent ORM models                  │
    │    Task 6: reminder_service.py                                         │
    │    Task 9: Extend user schema + auth endpoint                          │
    │                                                                        │
    ├─── Batch B (after Batch A, parallel) ─────────────────────────────────┤
    │    Task 3: notice_service.py                                           │
    │    Task 7: Scheduler wired into main.py                                │
    │                                                                        │
    ├─── Batch C (after Batch B, parallel) ─────────────────────────────────┤
    │    Task 4: notices router                                              │
    │    Task 8: Tests for reminder_service.py                               │
    │    Task 13: Frontend notification settings section                     │
    │                                                                        │
    ├─── Batch D (after Task 4, parallel) ──────────────────────────────────┤
    │    Task 5: Tests for notices API                                       │
    │    Task 10: Frontend notices API hooks                                 │
    │                                                                        │
    └─── Batch E (after Batch D, parallel) ─────────────────────────────────┘
         Task 11: Notice board route + bottom nav tab
         Task 12: Create notice sheet component
```

**After every task:** invoke the appropriate reviewer before moving to the next batch.
- Backend tasks → `everything-claude-code:python-reviewer`
- Frontend tasks → `everything-claude-code:typescript-reviewer`
- Migration → `everything-claude-code:database-reviewer`

---

## Task 1: DB Migration

**Files:**
- Create: `backend/alembic/versions/c1d2e3f4a5b6_add_reminders_and_notices.py`

**Step 1: Get current alembic head**

```bash
cd backend && python -m alembic heads
```

Note the revision hash — it becomes `down_revision` in the new file.

**Step 2: Create the migration file**

```python
"""add reminders_sent and household_notices tables

Revision ID: c1d2e3f4a5b6
Revises: <paste head hash from step 1>
Create Date: 2026-03-24 12:00:00.000000
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = 'c1d2e3f4a5b6'
down_revision: Union[str, Sequence[str], None] = '<head hash>'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # reminders_sent — deduplication table for email/push reminders
    op.create_table('reminders_sent',
        sa.Column('id', sa.Text(), nullable=False),
        sa.Column('entity_type', sa.Text(), nullable=False),   # "task" or "event"
        sa.Column('entity_id', sa.Text(), nullable=False),
        sa.Column('occurrence_date', sa.Date(), nullable=False),
        sa.Column('channel', sa.Text(), nullable=False, server_default='email'),
        sa.Column('sent_at', sa.DateTime(), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('entity_type', 'entity_id', 'occurrence_date', 'channel',
                            name='uq_reminders_sent_dedup'),
    )
    op.create_index('ix_reminders_sent_entity', 'reminders_sent', ['entity_type', 'entity_id'])
    op.create_index('ix_reminders_sent_sent_at', 'reminders_sent', ['sent_at'])

    # household_notices — the notice board
    op.create_table('household_notices',
        sa.Column('id', sa.Text(), nullable=False),
        sa.Column('household_id', sa.Text(), nullable=False),
        sa.Column('author_id', sa.Text(), nullable=False),
        sa.Column('content', sa.Text(), nullable=False),
        sa.Column('pinned', sa.Boolean(), nullable=False, server_default='0'),
        sa.Column('created_at', sa.DateTime(), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['household_id'], ['households.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['author_id'], ['users.id'], ),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_household_notices_household_id', 'household_notices', ['household_id'])

    # users: add reminder preference columns
    op.add_column('users', sa.Column('reminders_tasks', sa.Boolean(), nullable=False, server_default='1'))
    op.add_column('users', sa.Column('reminders_events', sa.Boolean(), nullable=False, server_default='1'))

    # households: add timezone column (IANA tz string, e.g. "Europe/Amsterdam")
    op.add_column('households', sa.Column('timezone', sa.Text(), nullable=False, server_default='UTC'))


def downgrade() -> None:
    op.drop_column('households', 'timezone')
    op.drop_column('users', 'reminders_events')
    op.drop_column('users', 'reminders_tasks')
    op.drop_index('ix_household_notices_household_id', table_name='household_notices')
    op.drop_table('household_notices')
    op.drop_index('ix_reminders_sent_sent_at', table_name='reminders_sent')
    op.drop_index('ix_reminders_sent_entity', table_name='reminders_sent')
    op.drop_table('reminders_sent')
```

**Step 3: Run migration**

```bash
cd backend && python -m alembic upgrade head
```

Expected: "Running upgrade <prev> -> c1d2e3f4a5b6"

**Step 4: Commit**

```bash
git add backend/alembic/versions/c1d2e3f4a5b6_add_reminders_and_notices.py
git commit -m "feat(db): add reminders_sent and household_notices tables"
```

→ **Review:** `everything-claude-code:database-reviewer`

---

## BATCH A — Run Tasks 2, 6, 9 in parallel

---

## Task 2: ORM Models — HouseholdNotice + ReminderSent

**Files:**
- Create: `backend/app/models/notice.py`
- Create: `backend/app/models/reminder_sent.py`
- Modify: `backend/app/models/household.py` (add `timezone` to `Household`)
- Modify: `backend/app/models/user.py` (add `reminders_tasks`, `reminders_events`)

**Step 1: Create `backend/app/models/notice.py`**

```python
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class HouseholdNotice(Base):
    __tablename__ = "household_notices"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    household_id: Mapped[str] = mapped_column(
        Text, ForeignKey("households.id", ondelete="CASCADE"), nullable=False
    )
    author_id: Mapped[str] = mapped_column(Text, ForeignKey("users.id"), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    pinned: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="0")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
```

**Step 2: Create `backend/app/models/reminder_sent.py`**

```python
from datetime import date, datetime

from sqlalchemy import Date, DateTime, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class ReminderSent(Base):
    __tablename__ = "reminders_sent"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    entity_type: Mapped[str] = mapped_column(Text, nullable=False)   # "task" or "event"
    entity_id: Mapped[str] = mapped_column(Text, nullable=False)
    occurrence_date: Mapped[date] = mapped_column(Date, nullable=False)
    channel: Mapped[str] = mapped_column(Text, nullable=False, default="email")
    sent_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    __table_args__ = (
        UniqueConstraint(
            "entity_type", "entity_id", "occurrence_date", "channel",
            name="uq_reminders_sent_dedup",
        ),
    )
```

**Step 3: Modify `backend/app/models/household.py`**

Add `timezone` to the `Household` class after `created_by`:

```python
    timezone: Mapped[str] = mapped_column(Text, nullable=False, default="UTC", server_default="UTC")
```

**Step 4: Modify `backend/app/models/user.py`**

Add after `email_digest_weekly`:

```python
    reminders_tasks: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="1")
    reminders_events: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="1")
```

**Step 5: Verify models load without error**

```bash
cd backend && python -c "from app.models.notice import HouseholdNotice; from app.models.reminder_sent import ReminderSent; print('OK')"
```

Expected: `OK`

**Step 6: Commit**

```bash
git add backend/app/models/notice.py backend/app/models/reminder_sent.py \
        backend/app/models/household.py backend/app/models/user.py
git commit -m "feat(models): add HouseholdNotice, ReminderSent, timezone + reminder prefs"
```

→ **Review:** `everything-claude-code:python-reviewer`

---

## Task 6: reminder_service.py

**Files:**
- Create: `backend/app/services/reminder_service.py`

**Context:** Tasks store `due_date` as a `Date` (no time component) — reminders fire on the *morning of* the due date. Events store `start_time` as a `DateTime` — reminders fire ~1 hour before. The scheduler runs every 15 minutes; it uses the `reminders_sent` table to deduplicate.

**Step 1: Create `backend/app/services/reminder_service.py`**

```python
import logging
import uuid
from datetime import date, datetime, timedelta, timezone

import aiosmtplib
from email.message import EmailMessage
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.event import Event
from app.models.household import Household, HouseholdMember
from app.models.reminder_sent import ReminderSent
from app.models.task import Task
from app.models.user import User

logger = logging.getLogger(__name__)


async def _already_sent(db: AsyncSession, entity_type: str, entity_id: str,
                        occurrence_date: date, channel: str = "email") -> bool:
    result = await db.execute(
        select(ReminderSent).where(
            ReminderSent.entity_type == entity_type,
            ReminderSent.entity_id == entity_id,
            ReminderSent.occurrence_date == occurrence_date,
            ReminderSent.channel == channel,
        )
    )
    return result.scalar_one_or_none() is not None


async def _record_sent(db: AsyncSession, entity_type: str, entity_id: str,
                       occurrence_date: date, channel: str = "email") -> None:
    db.add(ReminderSent(
        id=str(uuid.uuid4()),
        entity_type=entity_type,
        entity_id=entity_id,
        occurrence_date=occurrence_date,
        channel=channel,
    ))
    await db.commit()


async def _send_email(to: str, subject: str, body: str) -> None:
    msg = EmailMessage()
    msg["From"] = settings.smtp_from or settings.smtp_user or "nesto@localhost"
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content(body)

    await aiosmtplib.send(
        msg,
        hostname=settings.smtp_host,
        port=settings.smtp_port,
        username=settings.smtp_user or None,
        password=settings.smtp_password or None,
        use_tls=settings.smtp_use_tls,
    )


async def _get_user(db: AsyncSession, user_id: str) -> User | None:
    result = await db.execute(select(User).where(User.id == user_id))
    return result.scalar_one_or_none()


async def run_task_reminders(db: AsyncSession) -> int:
    """Send morning-of email reminders for tasks due today.

    Returns the number of emails sent.
    """
    if not settings.smtp_host:
        return 0

    today = date.today()
    sent = 0

    result = await db.execute(
        select(Task).where(
            Task.due_date == today,
            Task.status != "done",
        )
    )
    tasks = result.scalars().all()

    for task in tasks:
        if await _already_sent(db, "task", task.id, today):
            continue

        # Determine recipient: assigned_to if set, else created_by
        recipient_id = task.assigned_to or task.created_by
        user = await _get_user(db, recipient_id)
        if not user or not user.reminders_tasks:
            await _record_sent(db, "task", task.id, today)  # skip, don't retry
            continue

        try:
            await _record_sent(db, "task", task.id, today)  # stamp before send
            await _send_email(
                to=user.email,
                subject=f"Reminder: {task.title}",
                body=f"Hi {user.first_name or user.display_name},\n\n"
                     f"This is a reminder that '{task.title}' is due today.\n\n"
                     f"— Nesto",
            )
            sent += 1
            logger.info("Task reminder sent: task=%s user=%s", task.id, user.email)
        except Exception:
            logger.exception("Failed to send task reminder for task %s", task.id)

    return sent


async def run_event_reminders(db: AsyncSession) -> int:
    """Send ~1-hour-before email reminders for upcoming events.

    Returns the number of emails sent.
    """
    if not settings.smtp_host:
        return 0

    now = datetime.now(timezone.utc).replace(tzinfo=None)  # naive UTC to match DB
    window_start = now + timedelta(minutes=45)
    window_end = now + timedelta(minutes=75)
    sent = 0

    result = await db.execute(
        select(Event).where(
            Event.start_time >= window_start,
            Event.start_time <= window_end,
        )
    )
    events = result.scalars().all()

    for event in events:
        occurrence_date = event.start_time.date()
        if await _already_sent(db, "event", event.id, occurrence_date):
            continue

        # Collect all household members who have event reminders enabled
        members_result = await db.execute(
            select(User).join(
                HouseholdMember,
                HouseholdMember.user_id == User.id,
            ).where(
                HouseholdMember.household_id == event.household_id,
                User.reminders_events == True,
            )
        )
        users = members_result.scalars().all()

        await _record_sent(db, "event", event.id, occurrence_date)  # stamp before sends

        for user in users:
            try:
                start_local = event.start_time.strftime("%H:%M")
                await _send_email(
                    to=user.email,
                    subject=f"Starting soon: {event.title}",
                    body=f"Hi {user.first_name or user.display_name},\n\n"
                         f"'{event.title}' starts at {start_local} today.\n\n"
                         f"— Nesto",
                )
                sent += 1
                logger.info("Event reminder sent: event=%s user=%s", event.id, user.email)
            except Exception:
                logger.exception("Failed to send event reminder for event %s to %s", event.id, user.email)

    return sent


async def run_reminders(db: AsyncSession) -> int:
    """Run all reminder types. Called by the scheduler every 15 minutes."""
    task_count = await run_task_reminders(db)
    event_count = await run_event_reminders(db)
    return task_count + event_count


async def cleanup_old_reminders(db: AsyncSession, days: int = 30) -> None:
    """Delete reminder records older than `days` days to prevent unbounded growth."""
    from datetime import timedelta
    from sqlalchemy import delete
    cutoff = date.today() - timedelta(days=days)
    await db.execute(
        delete(ReminderSent).where(ReminderSent.occurrence_date < cutoff)
    )
    await db.commit()
```

**Step 2: Verify it imports cleanly**

```bash
cd backend && python -c "from app.services.reminder_service import run_reminders; print('OK')"
```

Expected: `OK`

**Step 3: Commit**

```bash
git add backend/app/services/reminder_service.py
git commit -m "feat(reminders): add reminder_service with task + event email reminders"
```

→ **Review:** `everything-claude-code:python-reviewer`

---

## Task 9: Extend user schema + auth endpoint for notification prefs

**Files:**
- Modify: `backend/app/schemas/user.py`

**Step 1: Add `reminders_tasks` and `reminders_events` to both schema classes**

In `backend/app/schemas/user.py`, add to `UserResponse`:

```python
    reminders_tasks: bool
    reminders_events: bool
```

Add to `UserUpdate`:

```python
    reminders_tasks: bool | None = None
    reminders_events: bool | None = None
```

**Step 2: Verify the auth router already handles PATCH /api/auth/me generically**

Read `backend/app/routers/auth.py` and confirm that the `update_me` endpoint patches fields from `UserUpdate` onto the User model. If it iterates `model_dump(exclude_unset=True)`, the new fields are automatically supported — no router changes needed.

**Step 3: Commit**

```bash
git add backend/app/schemas/user.py
git commit -m "feat(user): add reminders_tasks + reminders_events to user schema"
```

→ **Review:** `everything-claude-code:python-reviewer`

---

## BATCH B — Run Tasks 3 and 7 in parallel (after Batch A)

---

## Task 3: notice_service.py

**Files:**
- Create: `backend/app/services/notice_service.py`
- Create: `backend/app/schemas/notice.py`

**Step 1: Create `backend/app/schemas/notice.py`**

```python
from datetime import datetime

from pydantic import BaseModel, Field


class NoticeCreate(BaseModel):
    content: str = Field(min_length=1, max_length=500)


class NoticePatch(BaseModel):
    content: str | None = Field(default=None, min_length=1, max_length=500)
    pinned: bool | None = None


class NoticeResponse(BaseModel):
    id: str
    household_id: str
    author_id: str
    content: str
    pinned: bool
    created_at: datetime
    updated_at: datetime | None

    model_config = {"from_attributes": True}
```

**Step 2: Create `backend/app/services/notice_service.py`**

```python
import uuid
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.household import Household
from app.models.notice import HouseholdNotice
from app.schemas.notice import NoticeCreate, NoticePatch, NoticeResponse


async def list_notices(
    db: AsyncSession, household_id: str, limit: int = 20, offset: int = 0
) -> list[NoticeResponse]:
    result = await db.execute(
        select(HouseholdNotice)
        .where(HouseholdNotice.household_id == household_id)
        .order_by(HouseholdNotice.pinned.desc(), HouseholdNotice.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    notices = result.scalars().all()
    return [NoticeResponse.model_validate(n) for n in notices]


async def create_notice(
    db: AsyncSession, household_id: str, author_id: str, body: NoticeCreate
) -> NoticeResponse:
    notice = HouseholdNotice(
        id=str(uuid.uuid4()),
        household_id=household_id,
        author_id=author_id,
        content=body.content.strip(),
    )
    db.add(notice)
    await db.commit()
    await db.refresh(notice)
    return NoticeResponse.model_validate(notice)


async def patch_notice(
    db: AsyncSession,
    notice_id: str,
    household_id: str,
    user_id: str,
    body: NoticePatch,
) -> NoticeResponse:
    result = await db.execute(
        select(HouseholdNotice).where(
            HouseholdNotice.id == notice_id,
            HouseholdNotice.household_id == household_id,
        )
    )
    notice = result.scalar_one_or_none()
    if not notice:
        raise HTTPException(status_code=404, detail="Notice not found")

    # Content edits are author-only
    if body.content is not None:
        if notice.author_id != user_id:
            raise HTTPException(status_code=403, detail="Only the author can edit content")
        notice.content = body.content.strip()
        notice.updated_at = datetime.now(timezone.utc).replace(tzinfo=None)

    # Any member can pin/unpin
    if body.pinned is not None:
        notice.pinned = body.pinned

    await db.commit()
    await db.refresh(notice)
    return NoticeResponse.model_validate(notice)


async def delete_notice(
    db: AsyncSession, notice_id: str, household_id: str, user_id: str
) -> None:
    result = await db.execute(
        select(HouseholdNotice).where(
            HouseholdNotice.id == notice_id,
            HouseholdNotice.household_id == household_id,
        )
    )
    notice = result.scalar_one_or_none()
    if not notice:
        raise HTTPException(status_code=404, detail="Notice not found")

    # Check if user is author or household admin (household.created_by)
    household_result = await db.execute(
        select(Household).where(Household.id == household_id)
    )
    household = household_result.scalar_one_or_none()
    is_admin = household and household.created_by == user_id

    if notice.author_id != user_id and not is_admin:
        raise HTTPException(status_code=403, detail="Only the author or household admin can delete this notice")

    await db.delete(notice)
    await db.commit()
```

**Step 3: Verify imports**

```bash
cd backend && python -c "from app.services.notice_service import list_notices; print('OK')"
```

**Step 4: Commit**

```bash
git add backend/app/schemas/notice.py backend/app/services/notice_service.py
git commit -m "feat(notices): add notice schema + notice_service"
```

→ **Review:** `everything-claude-code:python-reviewer`

---

## Task 7: Wire reminder scheduler into main.py

**Files:**
- Modify: `backend/app/main.py`

**Step 1: Add the reminder scheduler loop**

In `backend/app/main.py`, add this function after `_calendar_sync_loop`:

```python
async def _reminder_scheduler_loop():
    """Background loop that sends task/event email reminders every 15 minutes."""
    while True:
        try:
            await asyncio.sleep(900)  # 15 minutes
            from app.services.reminder_service import run_reminders, cleanup_old_reminders
            async with async_session() as db:
                sent = await run_reminders(db)
                if sent:
                    logger.info("Reminder scheduler: %d reminder(s) sent", sent)
            # Weekly cleanup: run on Sundays only to avoid overhead
            now = datetime.now(timezone.utc)
            if now.weekday() == 6:
                async with async_session() as db:
                    await cleanup_old_reminders(db)
        except asyncio.CancelledError:
            break
        except Exception:
            logger.exception("Reminder scheduler error")
```

**Step 2: Register the task in `lifespan`**

In the `lifespan` function, after the existing `sync_task = asyncio.create_task(...)` line, add:

```python
    reminder_task = asyncio.create_task(_reminder_scheduler_loop())
    logger.info("Reminder scheduler started (every 15 minutes)")
```

And in the shutdown block, add:

```python
    reminder_task.cancel()
    try:
        await reminder_task
    except asyncio.CancelledError:
        pass
```

**Step 3: Verify the app starts**

```bash
cd backend && python -c "from app.main import app; print('OK')"
```

Expected: `OK`

**Step 4: Commit**

```bash
git add backend/app/main.py
git commit -m "feat(reminders): wire reminder scheduler into main.py lifespan"
```

→ **Review:** `everything-claude-code:python-reviewer`

---

## BATCH C — Run Tasks 4, 8, 13 in parallel (after Batch B)

---

## Task 4: Notices router

**Files:**
- Create: `backend/app/routers/notices.py`
- Modify: `backend/app/main.py` (register router)

**Step 1: Create `backend/app/routers/notices.py`**

```python
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user_id
from app.database import get_db
from app.schemas.notice import NoticeCreate, NoticePatch, NoticeResponse
from app.services.household_service import get_household
from app.services import notice_service as svc

router = APIRouter(prefix="/api/households/{household_id}/notices", tags=["notices"])


@router.get("", response_model=list[NoticeResponse])
async def list_notices(
    household_id: str,
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    await get_household(db, household_id, user_id)
    return await svc.list_notices(db, household_id, limit=limit, offset=offset)


@router.post("", response_model=NoticeResponse, status_code=201)
async def create_notice(
    household_id: str,
    body: NoticeCreate,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    await get_household(db, household_id, user_id)
    return await svc.create_notice(db, household_id, user_id, body)


@router.patch("/{notice_id}", response_model=NoticeResponse)
async def patch_notice(
    household_id: str,
    notice_id: str,
    body: NoticePatch,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    await get_household(db, household_id, user_id)
    return await svc.patch_notice(db, notice_id, household_id, user_id, body)


@router.delete("/{notice_id}", status_code=204)
async def delete_notice(
    household_id: str,
    notice_id: str,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    await get_household(db, household_id, user_id)
    await svc.delete_notice(db, notice_id, household_id, user_id)
```

**Step 2: Register in `backend/app/main.py`**

Add to the import line:

```python
from app.routers import auth, birthdays, calendar_sync, documents, events, households, loyalty_cards, notices, shopping_lists, tasks
```

Add below the birthdays router registration:

```python
app.include_router(notices.router)
```

**Step 3: Verify the app starts and route appears**

```bash
cd backend && python -c "from app.main import app; routes = [r.path for r in app.routes]; print([r for r in routes if 'notice' in r])"
```

Expected: `['/api/households/{household_id}/notices', ...]`

**Step 4: Commit**

```bash
git add backend/app/routers/notices.py backend/app/main.py
git commit -m "feat(notices): add notices router with CRUD endpoints"
```

→ **Review:** `everything-claude-code:python-reviewer`

---

## Task 8: Tests for reminder_service.py

**Files:**
- Create: `backend/tests/test_reminder_service.py`

**Step 1: Write failing tests**

```python
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
```

**Step 2: Run tests (expect failures — SMTP skips are expected passes)**

```bash
cd backend && pytest tests/test_reminder_service.py -v
```

Expected: All 5 tests PASS (SMTP tests skip cleanly since no smtp_host is set).

**Step 3: Commit**

```bash
git add backend/tests/test_reminder_service.py
git commit -m "test(reminders): add tests for reminder_service deduplication + cleanup"
```

→ **Review:** `everything-claude-code:python-reviewer`

---

## Task 13: Frontend — Notification settings section

**Files:**
- Modify: `frontend/src/routes/settings.tsx`

**Step 1: Read the current settings page**

Read `frontend/src/routes/settings.tsx` to understand where digest toggles are currently rendered (search for `email_digest_daily`). Note the exact pattern used for toggle rows.

**Step 2: Extend the API types in the frontend**

In `frontend/src/api/auth.ts` (or wherever `User` type is defined), add:

```typescript
reminders_tasks: boolean
reminders_events: boolean
```

Verify `UserUpdate` (the PATCH body type) also includes these as optional booleans.

**Step 3: Add the "Alerts & Reminders" section to the settings page**

Find the section that renders the daily/weekly digest toggles. Add a new section directly above it:

```tsx
{/* Alerts & Reminders */}
<section>
  <h2 className="text-sm font-semibold text-text-muted uppercase tracking-wide mb-3">
    Alerts & Reminders
  </h2>
  <div className="bg-surface-2 rounded-2xl divide-y divide-text/5">
    <label className="flex items-center justify-between px-4 py-3.5 cursor-pointer">
      <div>
        <p className="text-sm font-medium text-text">Task reminders</p>
        <p className="text-xs text-text-muted mt-0.5">Email on the morning a task is due</p>
      </div>
      <input
        type="checkbox"
        className="sr-only peer"
        checked={user?.reminders_tasks ?? true}
        onChange={(e) => updateUser({ reminders_tasks: e.target.checked })}
      />
      <div className="w-11 h-6 bg-text/10 peer-checked:bg-primary rounded-full relative transition-colors after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:w-5 after:h-5 after:bg-white after:rounded-full after:transition-all peer-checked:after:translate-x-5" />
    </label>
    <label className="flex items-center justify-between px-4 py-3.5 cursor-pointer">
      <div>
        <p className="text-sm font-medium text-text">Event reminders</p>
        <p className="text-xs text-text-muted mt-0.5">Email 1 hour before an event starts</p>
      </div>
      <input
        type="checkbox"
        className="sr-only peer"
        checked={user?.reminders_events ?? true}
        onChange={(e) => updateUser({ reminders_events: e.target.checked })}
      />
      <div className="w-11 h-6 bg-text/10 peer-checked:bg-primary rounded-full relative transition-colors after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:w-5 after:h-5 after:bg-white after:rounded-full after:transition-all peer-checked:after:translate-x-5" />
    </label>
  </div>
</section>
```

Use the same `updateUser` mutation that the digest toggles use. Match the existing styling pattern exactly.

**Step 4: Commit**

```bash
git add frontend/src/routes/settings.tsx frontend/src/api/auth.ts
git commit -m "feat(settings): add alerts & reminders toggles for task + event reminders"
```

→ **Review:** `everything-claude-code:typescript-reviewer`

---

## BATCH D — Run Tasks 5 and 10 in parallel (after Task 4)

---

## Task 5: Tests for notices API

**Files:**
- Create: `backend/tests/test_notices.py`

**Step 1: Write tests**

```python
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


@pytest.fixture
async def other_client(db_session):
    from app.auth import get_current_user_id
    from app.database import get_db
    from app.main import app

    async def override_db():
        yield db_session

    async def override_auth():
        return OTHER_USER_ID

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


async def test_other_user_cannot_edit_content(client, other_client):
    r = await client.post(f"/api/households/{HOUSEHOLD_ID}/notices", json={"content": "Original"})
    notice_id = r.json()["id"]
    r2 = await other_client.patch(
        f"/api/households/{HOUSEHOLD_ID}/notices/{notice_id}",
        json={"content": "Hacked"}
    )
    assert r2.status_code == 403


async def test_author_can_delete_own_notice(client):
    r = await client.post(f"/api/households/{HOUSEHOLD_ID}/notices", json={"content": "Delete me"})
    notice_id = r.json()["id"]
    r2 = await client.delete(f"/api/households/{HOUSEHOLD_ID}/notices/{notice_id}")
    assert r2.status_code == 204


async def test_non_author_non_admin_cannot_delete(other_client, client):
    r = await client.post(f"/api/households/{HOUSEHOLD_ID}/notices", json={"content": "Mine"})
    notice_id = r.json()["id"]
    r2 = await other_client.delete(f"/api/households/{HOUSEHOLD_ID}/notices/{notice_id}")
    assert r2.status_code == 403


async def test_pagination(client):
    for i in range(5):
        await client.post(f"/api/households/{HOUSEHOLD_ID}/notices", json={"content": f"Notice {i}"})
    r = await client.get(f"/api/households/{HOUSEHOLD_ID}/notices?limit=2&offset=0")
    assert len(r.json()) == 2
    r2 = await client.get(f"/api/households/{HOUSEHOLD_ID}/notices?limit=2&offset=2")
    assert len(r2.json()) == 2
```

**Step 2: Run tests**

```bash
cd backend && pytest tests/test_notices.py -v
```

Expected: All tests PASS.

**Step 3: Commit**

```bash
git add backend/tests/test_notices.py
git commit -m "test(notices): add API tests for household notices CRUD"
```

→ **Review:** `everything-claude-code:python-reviewer`

---

## Task 10: Frontend — Notices API hooks

**Files:**
- Create: `frontend/src/api/notices.ts`

**Step 1: Create `frontend/src/api/notices.ts`**

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch, hasToken } from './client'

export interface Notice {
  id: string
  household_id: string
  author_id: string
  content: string
  pinned: boolean
  created_at: string
  updated_at: string | null
}

export interface NoticeCreate {
  content: string
}

export interface NoticePatch {
  content?: string
  pinned?: boolean
}

export function useNotices(householdId: string, params?: { limit?: number; offset?: number }) {
  const query = new URLSearchParams()
  if (params?.limit) query.set('limit', String(params.limit))
  if (params?.offset) query.set('offset', String(params.offset))
  const qs = query.toString() ? `?${query}` : ''

  return useQuery({
    queryKey: ['notices', householdId, params],
    queryFn: () => apiFetch<Notice[]>(`/households/${householdId}/notices${qs}`),
    enabled: !!householdId && hasToken(),
  })
}

export function useCreateNotice(householdId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: NoticeCreate) =>
      apiFetch<Notice>(`/households/${householdId}/notices`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notices', householdId] }),
  })
}

export function usePatchNotice(householdId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ noticeId, ...patch }: NoticePatch & { noticeId: string }) =>
      apiFetch<Notice>(`/households/${householdId}/notices/${noticeId}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notices', householdId] }),
  })
}

export function useDeleteNotice(householdId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (noticeId: string) =>
      apiFetch<void>(`/households/${householdId}/notices/${noticeId}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notices', householdId] }),
  })
}
```

**Step 2: Verify TypeScript compiles**

```bash
cd frontend && npx tsc --noEmit 2>&1 | head -20
```

Expected: No errors related to notices.ts.

**Step 3: Commit**

```bash
git add frontend/src/api/notices.ts
git commit -m "feat(notices): add React Query hooks for household notices API"
```

→ **Review:** `everything-claude-code:typescript-reviewer`

---

## BATCH E — Run Tasks 11 and 12 in parallel (after Batch D)

---

## Task 11: Notice board route + bottom nav tab

**Files:**
- Create: `frontend/src/routes/notices.tsx`
- Modify: `frontend/src/components/layout/bottom-nav.tsx`

**Step 1: Create `frontend/src/routes/notices.tsx`**

The TanStack Router file-based routing uses the filename as the path. Create a route file at `frontend/src/routes/notices.tsx`:

```tsx
import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuthStore } from '@/stores/auth-store'
import { useNotices, usePatchNotice, useDeleteNotice } from '@/api/notices'
import type { Notice } from '@/api/notices'
import { Fab } from '@/components/ui'
import { CreateNoticeSheet } from '@/components/notices/create-notice-sheet'

export const Route = createFileRoute('/notices')({
  component: NoticeBoardPage,
})

function NoticeBoardPage() {
  const { householdId, userId } = useAuthStore()
  const [offset, setOffset] = useState(0)
  const [sheetOpen, setSheetOpen] = useState(false)
  const limit = 20

  const { data: notices = [], isLoading } = useNotices(householdId ?? '', { limit, offset })
  const patchNotice = usePatchNotice(householdId ?? '')
  const deleteNotice = useDeleteNotice(householdId ?? '')

  if (!householdId) return null

  return (
    <div className="min-h-screen bg-background pb-32">
      <div className="max-w-lg mx-auto px-4 pt-6">
        <h1 className="text-2xl font-bold text-text mb-6">Notice Board</h1>

        {isLoading && (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-20 bg-surface rounded-2xl animate-pulse" />
            ))}
          </div>
        )}

        {!isLoading && notices.length === 0 && (
          <div className="text-center py-16">
            <p className="text-text-muted text-base">No notes yet.</p>
            <p className="text-text-muted text-sm mt-1">Post the first one for your household.</p>
          </div>
        )}

        <AnimatePresence initial={false}>
          {notices.map((notice) => (
            <NoticeCard
              key={notice.id}
              notice={notice}
              currentUserId={userId ?? ''}
              onPin={(pinned) => patchNotice.mutate({ noticeId: notice.id, pinned })}
              onDelete={() => deleteNotice.mutate(notice.id)}
            />
          ))}
        </AnimatePresence>

        {notices.length === limit && (
          <button
            className="w-full py-3 text-sm text-primary font-medium"
            onClick={() => setOffset((o) => o + limit)}
          >
            Load more
          </button>
        )}
      </div>

      <Fab onClick={() => setSheetOpen(true)} />
      <CreateNoticeSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        householdId={householdId}
      />
    </div>
  )
}

function NoticeCard({
  notice,
  currentUserId,
  onPin,
  onDelete,
}: {
  notice: Notice
  currentUserId: string
  onPin: (pinned: boolean) => void
  onDelete: () => void
}) {
  const isAuthor = notice.author_id === currentUserId
  const date = new Date(notice.created_at).toLocaleDateString('en', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      className={`bg-surface rounded-2xl p-4 mb-3 ${notice.pinned ? 'ring-2 ring-primary/30' : ''}`}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <p className="text-text text-sm leading-relaxed flex-1">{notice.content}</p>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => onPin(!notice.pinned)}
            className={`p-1.5 rounded-full transition-colors ${notice.pinned ? 'text-primary' : 'text-text-muted hover:text-text'}`}
            title={notice.pinned ? 'Unpin' : 'Pin'}
          >
            {/* Pin icon */}
            <svg width="16" height="16" viewBox="0 0 24 24" fill={notice.pinned ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
            </svg>
          </button>
          {isAuthor && (
            <button
              onClick={onDelete}
              className="p-1.5 rounded-full text-text-muted hover:text-red-500 transition-colors"
              title="Delete"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 6h18M19 6l-1 14H6L5 6M8 6V4h8v2" />
              </svg>
            </button>
          )}
        </div>
      </div>
      <p className="text-xs text-text-muted">{date}{notice.pinned ? ' · Pinned' : ''}</p>
    </motion.div>
  )
}
```

**Step 2: Add Notice Board tab to bottom nav**

In `frontend/src/components/layout/bottom-nav.tsx`, replace the `tabs` array:

```tsx
const tabs = [
  { to: '/' as const, label: 'Home', icon: HomeIcon },
  { to: '/tasks' as const, label: 'Reminders', icon: CheckIcon },
  { to: '/calendar' as const, label: 'Calendar', icon: CalendarIcon },
  { to: '/lists' as const, label: 'Lists', icon: ListIcon },
  { to: '/notices' as const, label: 'Board', icon: BoardIcon },
  { to: '/more' as const, label: 'More', icon: MoreIcon },
]
```

Add the `BoardIcon` component at the end of the file:

```tsx
function BoardIcon({ active }: { active: boolean }) {
  return (
    <svg
      width="24" height="24" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      className={active ? 'text-primary' : 'text-text-muted'}
    >
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
      <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" />
    </svg>
  )
}
```

**Step 3: Check TanStack Router route tree is updated**

TanStack Router with file-based routing auto-generates the route tree. Verify:

```bash
cd frontend && npx tsc --noEmit 2>&1 | grep -i notice
```

If the route tree isn't auto-generated, run `npm run dev` briefly to trigger route tree generation, then re-run the TypeScript check.

**Step 4: Commit**

```bash
git add frontend/src/routes/notices.tsx frontend/src/components/layout/bottom-nav.tsx
git commit -m "feat(notices): add notice board route and bottom nav tab"
```

→ **Review:** `everything-claude-code:typescript-reviewer`

---

## Task 12: Create notice sheet component

**Files:**
- Create: `frontend/src/components/notices/create-notice-sheet.tsx`

**Step 1: Create the directory and component**

```bash
mkdir -p frontend/src/components/notices
```

```tsx
// frontend/src/components/notices/create-notice-sheet.tsx
import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Button } from '@/components/ui'
import { useCreateNotice } from '@/api/notices'
import { useScrollLock } from '@/utils/use-scroll-lock'

const MAX_CHARS = 500
const COUNTER_THRESHOLD = 400

interface CreateNoticeSheetProps {
  open: boolean
  onClose: () => void
  householdId: string
}

export function CreateNoticeSheet({ open, onClose, householdId }: CreateNoticeSheetProps) {
  const [content, setContent] = useState('')
  const createNotice = useCreateNotice(householdId)

  useScrollLock(open)

  const charsLeft = MAX_CHARS - content.length
  const showCounter = content.length > COUNTER_THRESHOLD

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!content.trim()) return
    createNotice.mutate(
      { content: content.trim() },
      {
        onSuccess: () => {
          setContent('')
          onClose()
        },
      }
    )
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/30 z-40"
            onClick={onClose}
          />
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="fixed bottom-0 left-0 right-0 bg-surface rounded-t-3xl p-6 pb-[env(safe-area-inset-bottom)] z-50 max-w-lg mx-auto"
          >
            <div className="w-12 h-1.5 bg-text/10 rounded-full mx-auto mb-6" />
            <h2 className="text-xl font-bold text-text mb-4">Post a note</h2>

            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <div className="relative">
                <textarea
                  autoFocus
                  value={content}
                  onChange={(e) => setContent(e.target.value.slice(0, MAX_CHARS))}
                  rows={4}
                  placeholder="Something for the household..."
                  className="w-full px-4 py-3 rounded-[var(--radius-input)] border-2 border-text/10 bg-surface text-text text-base placeholder:text-text-muted/50 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all duration-200 resize-none"
                />
                {showCounter && (
                  <span
                    className={`absolute bottom-2 right-3 text-xs font-medium ${
                      charsLeft <= 50 ? 'text-red-500' : 'text-orange-500'
                    }`}
                  >
                    {charsLeft}
                  </span>
                )}
              </div>

              <Button
                type="submit"
                disabled={!content.trim() || createNotice.isPending}
              >
                {createNotice.isPending ? 'Posting...' : 'Post note'}
              </Button>
            </form>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
```

**Step 2: Verify TypeScript**

```bash
cd frontend && npx tsc --noEmit 2>&1 | head -20
```

Expected: No errors.

**Step 3: Commit**

```bash
git add frontend/src/components/notices/create-notice-sheet.tsx
git commit -m "feat(notices): add create notice bottom sheet component"
```

→ **Review:** `everything-claude-code:typescript-reviewer`

---

## Final integration check

**Step 1: Run all backend tests**

```bash
cd backend && pytest tests/ -v
```

Expected: All tests PASS.

**Step 2: TypeScript full check**

```bash
cd frontend && npx tsc --noEmit
```

Expected: 0 errors.

**Step 3: Final commit (if any cleanup needed)**

```bash
git add -p  # stage only what's changed
git commit -m "chore: phase 1 integration cleanup"
```

---

## What's NOT in this plan (Phase 2)

- PWA push notifications (requires VAPID setup + service worker)
- Browser notification permission flow
- Push triggers on notice creation
- `push_subscriptions` table

These are covered in the Phase 2 plan.
