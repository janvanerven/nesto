# Calendar Sync Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add .ics subscription feed export and CalDAV client import for calendar sync.

**Architecture:** Nesto serves a per-user .ics feed URL for export (token-authenticated, no OIDC). For import, a background asyncio task polls CalDAV servers every 5 minutes using the `caldav` library, storing events in a separate `external_events` table. External events are expanded server-side (RRULE) and displayed read-only in the calendar view.

**Tech Stack:** `caldav`, `icalendar`, `cryptography` (backend); no new frontend deps.

**Design doc:** `docs/plans/2026-03-21-calendar-sync-design.md`

---

### Task 1: Add backend dependencies

**Files:**
- Modify: `backend/pyproject.toml:6-17`

**Step 1: Add new dependencies**

Add to the `dependencies` list in `pyproject.toml`:

```toml
    "caldav>=1.4.0",
    "icalendar>=6.0.0",
    "cryptography>=43.0.0",
```

These go after the existing `aiosmtplib` line (line 16).

**Step 2: Install dependencies**

Run: `cd backend && pip install -e .`
Expected: Successfully installed caldav, icalendar, cryptography and their transitive deps.

**Step 3: Verify imports work**

Run: `cd backend && python -c "import caldav; import icalendar; from cryptography.fernet import Fernet; print('OK')"`
Expected: `OK`

**Step 4: Commit**

```bash
git add backend/pyproject.toml
git commit -m "chore: add caldav, icalendar, cryptography dependencies"
```

---

### Task 2: Create data models

**Files:**
- Create: `backend/app/models/calendar_sync.py`
- Modify: `backend/app/models/__init__.py:1-18`
- Modify: `backend/app/models/household.py:18-23`

**Step 1: Create CalendarConnection and ExternalEvent models**

Create `backend/app/models/calendar_sync.py`:

```python
from datetime import datetime

import sqlalchemy as sa
from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class CalendarConnection(Base):
    __tablename__ = "calendar_connections"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    user_id: Mapped[str] = mapped_column(Text, ForeignKey("users.id"), nullable=False)
    household_id: Mapped[str] = mapped_column(Text, ForeignKey("households.id"), nullable=False)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    provider: Mapped[str] = mapped_column(Text, nullable=False)
    server_url: Mapped[str] = mapped_column(Text, nullable=False)
    calendar_url: Mapped[str] = mapped_column(Text, nullable=False)
    username: Mapped[str] = mapped_column(Text, nullable=False)
    encrypted_password: Mapped[str] = mapped_column(Text, nullable=False)
    color: Mapped[str] = mapped_column(Text, nullable=False)
    sync_token: Mapped[str | None] = mapped_column(Text, nullable=True)
    last_synced_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=sa.text("1"))
    error_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default=sa.text("0"))
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class ExternalEvent(Base):
    __tablename__ = "external_events"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    connection_id: Mapped[str] = mapped_column(
        Text, ForeignKey("calendar_connections.id", ondelete="CASCADE"), nullable=False
    )
    caldav_uid: Mapped[str] = mapped_column(Text, nullable=False)
    caldav_etag: Mapped[str | None] = mapped_column(Text, nullable=True)
    caldav_href: Mapped[str | None] = mapped_column(Text, nullable=True)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    start_time: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    end_time: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    all_day: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=sa.text("0"))
    location: Mapped[str | None] = mapped_column(Text, nullable=True)
    recurrence_rule: Mapped[str | None] = mapped_column(Text, nullable=True)
    timezone: Mapped[str | None] = mapped_column(Text, nullable=True)
    raw_ical: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())
```

**Step 2: Add feed_token to HouseholdMember**

In `backend/app/models/household.py`, add after line 23 (`joined_at`):

```python
    feed_token: Mapped[str | None] = mapped_column(Text, nullable=True, unique=True)
```

Add `Text` to the import on line 3 if not already there (it's already imported).

**Step 3: Update models/__init__.py**

Add imports for the new models:

```python
from app.models.calendar_sync import CalendarConnection, ExternalEvent
```

And add `"CalendarConnection"` and `"ExternalEvent"` to `__all__`.

**Step 4: Commit**

```bash
git add backend/app/models/calendar_sync.py backend/app/models/household.py backend/app/models/__init__.py
git commit -m "feat: add CalendarConnection, ExternalEvent models and feed_token column"
```

---

### Task 3: Create Alembic migration

**Files:**
- Create: `backend/alembic/versions/<auto>_add_calendar_sync_tables.py`

**Step 1: Generate migration**

Run: `cd backend && alembic revision --autogenerate -m "add calendar sync tables"`

**Step 2: Review the generated migration**

Verify it creates:
- `calendar_connections` table with all columns
- `external_events` table with all columns and `CASCADE` on `connection_id` FK
- `feed_token` column on `household_members`
- Indexes on `calendar_connections.user_id`, `calendar_connections.household_id`, `external_events.connection_id`, `external_events.caldav_uid`

If indexes are missing from auto-generation, add them manually:

```python
op.create_index('ix_calendar_connections_user_id', 'calendar_connections', ['user_id'])
op.create_index('ix_calendar_connections_household_id', 'calendar_connections', ['household_id'])
op.create_index('ix_external_events_connection_id', 'external_events', ['connection_id'])
```

**Step 3: Run migration**

Run: `cd backend && alembic upgrade head`
Expected: No errors.

**Step 4: Verify tables exist**

Run: `cd backend && python -c "import sqlite3; c=sqlite3.connect('data/nesto.db'); print([t[0] for t in c.execute(\"SELECT name FROM sqlite_master WHERE type='table'\").fetchall()])"`
Expected: List includes `calendar_connections` and `external_events`.

**Step 5: Commit**

```bash
git add backend/alembic/versions/
git commit -m "feat: add calendar sync migration"
```

---

### Task 4: Create credential encryption utility

**Files:**
- Create: `backend/app/services/crypto_service.py`
- Test: `backend/tests/test_crypto_service.py`

**Step 1: Write the failing test**

Create `backend/tests/test_crypto_service.py`:

```python
import os

import pytest


@pytest.fixture(autouse=True)
def set_secret_key(monkeypatch):
    monkeypatch.setenv("SECRET_KEY", "a" * 64)
    monkeypatch.setenv("OIDC_ISSUER_URL", "https://auth.example.com")
    monkeypatch.setenv("OIDC_CLIENT_ID", "test-client")


def test_encrypt_decrypt_roundtrip():
    from app.services.crypto_service import decrypt_password, encrypt_password

    password = "my-caldav-password-123!"
    encrypted = encrypt_password(password)
    assert encrypted != password
    assert decrypt_password(encrypted) == password


def test_decrypt_with_wrong_key_fails():
    from app.services.crypto_service import encrypt_password

    encrypted = encrypt_password("secret")

    # Simulating key change is hard without mocking, so just verify the encrypted
    # value is not plaintext and is a valid Fernet token (starts with gAAAAA)
    assert encrypted.startswith("gAAAAA")
```

**Step 2: Run test to verify it fails**

Run: `cd backend && pytest tests/test_crypto_service.py -v`
Expected: FAIL with `ModuleNotFoundError`

**Step 3: Write the implementation**

Create `backend/app/services/crypto_service.py`:

```python
import base64

from cryptography.fernet import Fernet
from cryptography.hazmat.primitives.hashes import SHA256
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

from app.config import settings


def _get_fernet() -> Fernet:
    key_bytes = settings.secret_key.encode()
    derived = HKDF(
        algorithm=SHA256(),
        length=32,
        salt=b"nesto-caldav",
        info=b"credential-encryption",
    ).derive(key_bytes)
    fernet_key = base64.urlsafe_b64encode(derived)
    return Fernet(fernet_key)


def encrypt_password(plaintext: str) -> str:
    return _get_fernet().encrypt(plaintext.encode()).decode()


def decrypt_password(ciphertext: str) -> str:
    return _get_fernet().decrypt(ciphertext.encode()).decode()
```

**Step 4: Run test to verify it passes**

Run: `cd backend && pytest tests/test_crypto_service.py -v`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/app/services/crypto_service.py backend/tests/test_crypto_service.py
git commit -m "feat: add credential encryption utility using HKDF + Fernet"
```

---

### Task 5: Create backend schemas

**Files:**
- Create: `backend/app/schemas/calendar_sync.py`

**Step 1: Create schemas**

Create `backend/app/schemas/calendar_sync.py`:

```python
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator


class CalendarConnectionCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    provider: Literal["icloud", "nextcloud", "caldav"] = "caldav"
    server_url: str = Field(min_length=1, max_length=2000)
    calendar_url: str = Field(min_length=1, max_length=2000)
    username: str = Field(min_length=1, max_length=500)
    password: str = Field(min_length=1, max_length=500)
    color: str = Field(default="#6C5CE7", max_length=7)

    @field_validator("server_url", "calendar_url")
    @classmethod
    def validate_https(cls, v: str) -> str:
        if not v.startswith("https://"):
            raise ValueError("URL must use HTTPS")
        return v

    @field_validator("color")
    @classmethod
    def validate_color(cls, v: str) -> str:
        if not v.startswith("#") or len(v) != 7:
            raise ValueError("Color must be a hex color like #6C5CE7")
        return v


class CalendarConnectionUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    color: str | None = Field(default=None, max_length=7)
    enabled: bool | None = None
    password: str | None = Field(default=None, min_length=1, max_length=500)

    @field_validator("color")
    @classmethod
    def validate_color(cls, v: str | None) -> str | None:
        if v is not None and (not v.startswith("#") or len(v) != 7):
            raise ValueError("Color must be a hex color like #6C5CE7")
        return v


class CalendarConnectionResponse(BaseModel):
    id: str
    user_id: str
    household_id: str
    name: str
    provider: str
    server_url: str
    calendar_url: str
    username: str
    color: str
    sync_token: str | None
    last_synced_at: datetime | None
    enabled: bool
    error_count: int
    last_error: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


class ExternalEventResponse(BaseModel):
    id: str
    connection_id: str
    title: str
    description: str | None
    start_time: datetime
    end_time: datetime
    all_day: bool
    location: str | None
    source_calendar_name: str
    source_calendar_color: str
    provider: str

    model_config = {"from_attributes": True}


class FeedTokenResponse(BaseModel):
    token: str
    url: str
```

**Step 2: Commit**

```bash
git add backend/app/schemas/calendar_sync.py
git commit -m "feat: add calendar sync Pydantic schemas"
```

---

### Task 6: Create calendar connection service

**Files:**
- Create: `backend/app/services/calendar_connection_service.py`
- Test: `backend/tests/test_calendar_connection_service.py`

**Step 1: Write the failing test**

Create `backend/tests/test_calendar_connection_service.py`:

```python
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
```

**Step 2: Run test to verify it fails**

Run: `cd backend && pytest tests/test_calendar_connection_service.py -v`
Expected: FAIL with `ModuleNotFoundError`

**Step 3: Write the implementation**

Create `backend/app/services/calendar_connection_service.py`:

```python
import uuid

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.calendar_sync import CalendarConnection, ExternalEvent
from app.schemas.calendar_sync import CalendarConnectionCreate, CalendarConnectionUpdate
from app.services.crypto_service import encrypt_password


_UPDATABLE_FIELDS = {"name", "color", "enabled"}


async def list_connections(
    db: AsyncSession, household_id: str, user_id: str
) -> list[CalendarConnection]:
    result = await db.execute(
        select(CalendarConnection)
        .where(
            CalendarConnection.household_id == household_id,
            CalendarConnection.user_id == user_id,
        )
        .order_by(CalendarConnection.created_at.asc())
    )
    return list(result.scalars().all())


async def create_connection(
    db: AsyncSession, household_id: str, user_id: str, data: CalendarConnectionCreate
) -> CalendarConnection:
    conn = CalendarConnection(
        id=str(uuid.uuid4()),
        household_id=household_id,
        user_id=user_id,
        name=data.name,
        provider=data.provider,
        server_url=data.server_url,
        calendar_url=data.calendar_url,
        username=data.username,
        encrypted_password=encrypt_password(data.password),
        color=data.color,
    )
    db.add(conn)
    await db.commit()
    await db.refresh(conn)
    return conn


async def update_connection(
    db: AsyncSession, connection_id: str, user_id: str, data: CalendarConnectionUpdate
) -> CalendarConnection:
    result = await db.execute(
        select(CalendarConnection).where(
            CalendarConnection.id == connection_id,
            CalendarConnection.user_id == user_id,
        )
    )
    conn = result.scalar_one_or_none()
    if not conn:
        raise HTTPException(status_code=404, detail="Calendar connection not found")

    updates = data.model_dump(exclude_unset=True)

    if "password" in updates:
        conn.encrypted_password = encrypt_password(updates.pop("password"))

    for key, value in updates.items():
        if key in _UPDATABLE_FIELDS:
            setattr(conn, key, value)

    await db.commit()
    await db.refresh(conn)
    return conn


async def delete_connection(db: AsyncSession, connection_id: str, user_id: str) -> None:
    result = await db.execute(
        select(CalendarConnection).where(
            CalendarConnection.id == connection_id,
            CalendarConnection.user_id == user_id,
        )
    )
    conn = result.scalar_one_or_none()
    if not conn:
        raise HTTPException(status_code=404, detail="Calendar connection not found")

    # Delete all external events for this connection
    events_result = await db.execute(
        select(ExternalEvent).where(ExternalEvent.connection_id == connection_id)
    )
    for event in events_result.scalars().all():
        await db.delete(event)

    await db.delete(conn)
    await db.commit()


async def get_connection(db: AsyncSession, connection_id: str) -> CalendarConnection:
    result = await db.execute(
        select(CalendarConnection).where(CalendarConnection.id == connection_id)
    )
    conn = result.scalar_one_or_none()
    if not conn:
        raise HTTPException(status_code=404, detail="Calendar connection not found")
    return conn
```

**Step 4: Run test to verify it passes**

Run: `cd backend && pytest tests/test_calendar_connection_service.py -v`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/app/services/calendar_connection_service.py backend/tests/test_calendar_connection_service.py
git commit -m "feat: add calendar connection CRUD service"
```

---

### Task 7: Create .ics feed service

**Files:**
- Create: `backend/app/services/feed_service.py`
- Test: `backend/tests/test_feed_service.py`

**Step 1: Write the failing test**

Create `backend/tests/test_feed_service.py`:

```python
import os

os.environ.setdefault("SECRET_KEY", "a" * 64)
os.environ.setdefault("OIDC_ISSUER_URL", "https://auth.example.com")
os.environ.setdefault("OIDC_CLIENT_ID", "test-client")

from datetime import datetime


def test_event_to_ical_basic():
    from app.services.feed_service import _event_to_vevent

    class FakeEvent:
        id = "event-1"
        title = "Team standup"
        description = "Daily sync"
        start_time = datetime(2026, 3, 21, 9, 0)
        end_time = datetime(2026, 3, 21, 9, 30)
        all_day = False
        recurrence_rule = None
        recurrence_interval = 1
        recurrence_end = None

    vevent = _event_to_vevent(FakeEvent())
    ical_str = vevent.to_ical().decode()

    assert "Team standup" in ical_str
    assert "event-1@nesto" in ical_str
    assert "DTSTART" in ical_str


def test_event_to_ical_recurring():
    from app.services.feed_service import _event_to_vevent
    from datetime import date

    class FakeEvent:
        id = "event-2"
        title = "Weekly review"
        description = None
        start_time = datetime(2026, 3, 21, 14, 0)
        end_time = datetime(2026, 3, 21, 15, 0)
        all_day = False
        recurrence_rule = "weekly"
        recurrence_interval = 1
        recurrence_end = date(2026, 6, 1)

    vevent = _event_to_vevent(FakeEvent())
    ical_str = vevent.to_ical().decode()

    assert "RRULE:FREQ=WEEKLY" in ical_str
    assert "UNTIL=" in ical_str


def test_event_to_ical_allday():
    from app.services.feed_service import _event_to_vevent

    class FakeEvent:
        id = "event-3"
        title = "Holiday"
        description = None
        start_time = datetime(2026, 3, 21, 0, 0)
        end_time = datetime(2026, 3, 21, 23, 59, 59)
        all_day = True
        recurrence_rule = None
        recurrence_interval = 1
        recurrence_end = None

    vevent = _event_to_vevent(FakeEvent())
    ical_str = vevent.to_ical().decode()

    assert "Holiday" in ical_str
```
**Step 2: Run test to verify it fails**

Run: `cd backend && pytest tests/test_feed_service.py -v`
Expected: FAIL with `ModuleNotFoundError`

**Step 3: Write the implementation**

Create `backend/app/services/feed_service.py`:

```python
import secrets
from datetime import date, datetime

from icalendar import Calendar, Event as ICalEvent, vRecur
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.event import Event
from app.models.household import HouseholdMember


RRULE_FREQ_MAP = {
    "daily": "DAILY",
    "weekly": "WEEKLY",
    "monthly": "MONTHLY",
    "yearly": "YEARLY",
}


def _event_to_vevent(event) -> ICalEvent:
    vevent = ICalEvent()
    vevent.add("uid", f"{event.id}@nesto")
    vevent.add("summary", event.title)
    if event.description:
        vevent.add("description", event.description)

    if event.all_day:
        vevent.add("dtstart", event.start_time.date())
        # For all-day events, DTEND is exclusive (day after)
        end_date = event.end_time.date()
        from datetime import timedelta
        vevent.add("dtend", end_date + timedelta(days=1))
    else:
        vevent.add("dtstart", event.start_time)
        vevent.add("dtend", event.end_time)

    if event.recurrence_rule and event.recurrence_rule in RRULE_FREQ_MAP:
        rrule: dict = {"freq": RRULE_FREQ_MAP[event.recurrence_rule]}
        if event.recurrence_interval > 1:
            rrule["interval"] = event.recurrence_interval
        if event.recurrence_end:
            end = event.recurrence_end
            if isinstance(end, date) and not isinstance(end, datetime):
                rrule["until"] = datetime(end.year, end.month, end.day, 23, 59, 59)
            else:
                rrule["until"] = end
        vevent.add("rrule", rrule)

    return vevent


async def generate_feed(db: AsyncSession, user_id: str, household_id: str) -> str:
    result = await db.execute(
        select(Event).where(
            Event.household_id == household_id,
            (Event.assigned_to == user_id) | (Event.assigned_to.is_(None)),
        )
    )
    events = result.scalars().all()

    cal = Calendar()
    cal.add("prodid", "-//Nesto//Calendar//EN")
    cal.add("version", "2.0")
    cal.add("x-wr-calname", "Nesto")

    for event in events:
        cal.add_component(_event_to_vevent(event))

    return cal.to_ical().decode()


async def get_or_create_feed_token(db: AsyncSession, user_id: str, household_id: str) -> str:
    result = await db.execute(
        select(HouseholdMember).where(
            HouseholdMember.user_id == user_id,
            HouseholdMember.household_id == household_id,
        )
    )
    member = result.scalar_one_or_none()
    if not member:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Household membership not found")

    if not member.feed_token:
        member.feed_token = secrets.token_urlsafe(48)
        await db.commit()
        await db.refresh(member)

    return member.feed_token


async def regenerate_feed_token(db: AsyncSession, user_id: str, household_id: str) -> str:
    result = await db.execute(
        select(HouseholdMember).where(
            HouseholdMember.user_id == user_id,
            HouseholdMember.household_id == household_id,
        )
    )
    member = result.scalar_one_or_none()
    if not member:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Household membership not found")

    member.feed_token = secrets.token_urlsafe(48)
    await db.commit()
    await db.refresh(member)
    return member.feed_token


async def resolve_feed_token(db: AsyncSession, token: str) -> tuple[str, str] | None:
    """Returns (user_id, household_id) for the given feed token, or None."""
    result = await db.execute(
        select(HouseholdMember).where(HouseholdMember.feed_token == token)
    )
    member = result.scalar_one_or_none()
    if not member:
        return None
    return member.user_id, member.household_id
```

**Step 4: Run test to verify it passes**

Run: `cd backend && pytest tests/test_feed_service.py -v`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/app/services/feed_service.py backend/tests/test_feed_service.py
git commit -m "feat: add .ics feed generation service"
```

---

### Task 8: Create CalDAV sync service

**Files:**
- Create: `backend/app/services/calendar_sync_service.py`

This is the core sync engine. It uses the `caldav` library (synchronous, wrapped in `asyncio.to_thread()`) and `icalendar` for parsing.

**Step 1: Write the implementation**

Create `backend/app/services/calendar_sync_service.py`:

```python
import logging
import uuid
from datetime import datetime, timezone

import caldav
from icalendar import Calendar
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.calendar_sync import CalendarConnection, ExternalEvent
from app.services.crypto_service import decrypt_password

logger = logging.getLogger(__name__)

MAX_RAW_ICAL_SIZE = 65536  # 64KB
MAX_CONSECUTIVE_ERRORS = 10


def _parse_vevent(vevent_component, connection_id: str) -> dict | None:
    """Parse an iCalendar VEVENT component into a dict for ExternalEvent."""
    try:
        uid = str(vevent_component.get("uid", ""))
        if not uid:
            return None

        summary = str(vevent_component.get("summary", "Untitled"))
        description = vevent_component.get("description")
        if description:
            description = str(description)

        dtstart = vevent_component.get("dtstart")
        dtend = vevent_component.get("dtend")
        if not dtstart:
            return None

        dtstart_val = dtstart.dt
        all_day = not isinstance(dtstart_val, datetime)

        if all_day:
            start_time = datetime(dtstart_val.year, dtstart_val.month, dtstart_val.day, 0, 0, 0)
            if dtend:
                dtend_val = dtend.dt
                # iCal DTEND for all-day is exclusive, so subtract a day
                from datetime import timedelta
                end_date = dtend_val - timedelta(days=1)
                end_time = datetime(end_date.year, end_date.month, end_date.day, 23, 59, 59)
            else:
                end_time = datetime(dtstart_val.year, dtstart_val.month, dtstart_val.day, 23, 59, 59)
        else:
            start_time = dtstart_val.replace(tzinfo=None) if dtstart_val.tzinfo else dtstart_val
            if dtend:
                dtend_val = dtend.dt
                end_time = dtend_val.replace(tzinfo=None) if dtend_val.tzinfo else dtend_val
            else:
                end_time = start_time

        # Extract timezone
        tz = None
        if hasattr(dtstart_val, "tzinfo") and dtstart_val.tzinfo:
            tz = str(dtstart_val.tzinfo)

        # Extract location
        location = vevent_component.get("location")
        if location:
            location = str(location)

        # Extract RRULE
        rrule = vevent_component.get("rrule")
        rrule_str = None
        if rrule:
            rrule_str = rrule.to_ical().decode()

        return {
            "connection_id": connection_id,
            "caldav_uid": uid,
            "title": summary[:500],
            "description": description[:5000] if description else None,
            "start_time": start_time,
            "end_time": end_time,
            "all_day": all_day,
            "location": location[:500] if location else None,
            "recurrence_rule": rrule_str,
            "timezone": tz,
        }
    except Exception as e:
        logger.warning("Failed to parse VEVENT: %s", e)
        return None


def _fetch_events_sync(
    server_url: str, calendar_url: str, username: str, password: str
) -> list[tuple[str, str, str | None]]:
    """Synchronous CalDAV fetch. Returns list of (uid, ical_data, href)."""
    client = caldav.DAVClient(url=server_url, username=username, password=password)
    calendar = caldav.Calendar(client=client, url=calendar_url)

    events = calendar.events()
    result = []
    for event in events:
        ical_data = event.data
        href = str(event.url) if event.url else None
        etag = event.extra_data.get("getetag") if hasattr(event, "extra_data") else None

        # Parse UID from ical data
        try:
            cal = Calendar.from_ical(ical_data)
            for component in cal.walk():
                if component.name == "VEVENT":
                    uid = str(component.get("uid", ""))
                    if uid:
                        result.append((uid, ical_data, href))
                    break
        except Exception as e:
            logger.warning("Failed to parse event from %s: %s", href, e)

    return result


async def sync_connection(db: AsyncSession, connection: CalendarConnection) -> None:
    """Sync a single CalDAV connection."""
    try:
        password = decrypt_password(connection.encrypted_password)
    except Exception:
        connection.error_count += 1
        connection.last_error = "Failed to decrypt password — re-enter your CalDAV password"
        await db.commit()
        return

    try:
        events_data = await __import__("asyncio").to_thread(
            _fetch_events_sync,
            connection.server_url,
            connection.calendar_url,
            connection.username,
            password,
        )
    except Exception as e:
        logger.warning("CalDAV fetch failed for connection %s: %s", connection.id, e)
        connection.error_count += 1
        connection.last_error = str(e)[:500]
        if connection.error_count >= MAX_CONSECUTIVE_ERRORS:
            connection.enabled = False
            logger.warning("Disabled connection %s after %d errors", connection.id, MAX_CONSECUTIVE_ERRORS)
        await db.commit()
        return

    # Get existing external events for this connection
    existing_result = await db.execute(
        select(ExternalEvent).where(ExternalEvent.connection_id == connection.id)
    )
    existing_by_uid = {e.caldav_uid: e for e in existing_result.scalars().all()}

    seen_uids = set()

    for uid, ical_data, href in events_data:
        seen_uids.add(uid)

        try:
            cal = Calendar.from_ical(ical_data)
        except Exception:
            continue

        for component in cal.walk():
            if component.name != "VEVENT":
                continue

            parsed = _parse_vevent(component, connection.id)
            if not parsed:
                continue

            # Store raw ical if under size limit
            raw_ical = ical_data if len(ical_data) <= MAX_RAW_ICAL_SIZE else None

            if uid in existing_by_uid:
                # Update existing
                ext_event = existing_by_uid[uid]
                for key, value in parsed.items():
                    if key != "connection_id":
                        setattr(ext_event, key, value)
                ext_event.caldav_href = href
                ext_event.raw_ical = raw_ical
            else:
                # Create new
                ext_event = ExternalEvent(
                    id=str(uuid.uuid4()),
                    caldav_href=href,
                    raw_ical=raw_ical,
                    **parsed,
                )
                db.add(ext_event)
            break  # Only process first VEVENT per calendar object

    # Delete events no longer on the server
    for uid, ext_event in existing_by_uid.items():
        if uid not in seen_uids:
            await db.delete(ext_event)

    # Update connection state
    connection.last_synced_at = datetime.now(timezone.utc).replace(tzinfo=None)
    connection.error_count = 0
    connection.last_error = None

    await db.commit()
    logger.info("Synced connection %s: %d events", connection.id, len(seen_uids))


async def validate_caldav_credentials(
    server_url: str, calendar_url: str, username: str, password: str
) -> bool:
    """Test CalDAV credentials. Returns True if valid."""
    import asyncio

    def _test():
        client = caldav.DAVClient(url=server_url, username=username, password=password)
        calendar = caldav.Calendar(client=client, url=calendar_url)
        # Try to fetch properties — will raise on bad auth
        calendar.get_properties([caldav.dav.DisplayName()])
        return True

    try:
        return await asyncio.to_thread(_test)
    except Exception:
        return False
```

**Step 2: Commit**

```bash
git add backend/app/services/calendar_sync_service.py
git commit -m "feat: add CalDAV sync service with event parsing and upsert"
```

---

### Task 9: Create external events service

**Files:**
- Create: `backend/app/services/external_event_service.py`

**Step 1: Write the implementation**

Create `backend/app/services/external_event_service.py`:

```python
from datetime import date, datetime, time

from dateutil.rrule import rrulestr
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.calendar_sync import CalendarConnection, ExternalEvent


async def list_external_events(
    db: AsyncSession,
    household_id: str,
    user_id: str,
    start: date,
    end: date,
) -> list[dict]:
    """Return pre-expanded external event occurrences for a date range."""
    # Get connections for this user in this household
    conn_result = await db.execute(
        select(CalendarConnection).where(
            CalendarConnection.household_id == household_id,
            CalendarConnection.user_id == user_id,
            CalendarConnection.enabled == True,
        )
    )
    connections = {c.id: c for c in conn_result.scalars().all()}

    if not connections:
        return []

    # Get all external events for these connections
    event_result = await db.execute(
        select(ExternalEvent).where(
            ExternalEvent.connection_id.in_(list(connections.keys()))
        )
    )
    events = event_result.scalars().all()

    range_start = datetime.combine(start, time.min)
    range_end = datetime.combine(end, time.max)

    occurrences = []

    for event in events:
        conn = connections.get(event.connection_id)
        if not conn:
            continue

        source_info = {
            "source_calendar_name": conn.name,
            "source_calendar_color": conn.color,
            "provider": conn.provider,
        }

        if not event.recurrence_rule:
            # Non-recurring: include if overlaps range
            if event.end_time >= range_start and event.start_time <= range_end:
                occurrences.append(_event_to_dict(event, event.start_time, event.end_time, source_info))
        else:
            # Recurring: expand using dateutil
            expanded = _expand_rrule(event, range_start, range_end)
            for occ_start, occ_end in expanded:
                occurrences.append(_event_to_dict(event, occ_start, occ_end, source_info))

    occurrences.sort(key=lambda o: o["start_time"])
    return occurrences


def _event_to_dict(event: ExternalEvent, start: datetime, end: datetime, source_info: dict) -> dict:
    return {
        "id": f"{event.id}-{start.isoformat()}",
        "connection_id": event.connection_id,
        "title": event.title,
        "description": event.description,
        "start_time": start,
        "end_time": end,
        "all_day": event.all_day,
        "location": event.location,
        **source_info,
    }


def _expand_rrule(event: ExternalEvent, range_start: datetime, range_end: datetime) -> list[tuple[datetime, datetime]]:
    """Expand an RRULE string into concrete occurrences within a date range."""
    try:
        duration = event.end_time - event.start_time
        rule = rrulestr(event.recurrence_rule, dtstart=event.start_time)

        occurrences = []
        for dt in rule.between(range_start, range_end, inc=True):
            # Cap at 200 occurrences per event per query
            if len(occurrences) >= 200:
                break
            occurrences.append((dt, dt + duration))

        return occurrences
    except Exception:
        # If RRULE parsing fails, just return the base event if in range
        if event.end_time >= range_start and event.start_time <= range_end:
            return [(event.start_time, event.end_time)]
        return []
```

**Step 2: Commit**

```bash
git add backend/app/services/external_event_service.py
git commit -m "feat: add external event service with server-side RRULE expansion"
```

---

### Task 10: Create backend routers

**Files:**
- Create: `backend/app/routers/calendar_sync.py`
- Modify: `backend/app/main.py:12,94-99`

**Step 1: Create the router**

Create `backend/app/routers/calendar_sync.py`:

```python
from datetime import date

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user_id
from app.database import get_db
from app.schemas.calendar_sync import (
    CalendarConnectionCreate,
    CalendarConnectionResponse,
    CalendarConnectionUpdate,
    ExternalEventResponse,
    FeedTokenResponse,
)
from app.services.calendar_connection_service import (
    create_connection,
    delete_connection,
    get_connection,
    list_connections,
    update_connection,
)
from app.services.calendar_sync_service import sync_connection, validate_caldav_credentials
from app.services.external_event_service import list_external_events
from app.services.feed_service import (
    generate_feed,
    get_or_create_feed_token,
    regenerate_feed_token,
    resolve_feed_token,
)
from app.services.household_service import get_household

# --- Connection management (OIDC-authenticated) ---

connections_router = APIRouter(prefix="/api/calendar/connections", tags=["calendar-sync"])


@connections_router.get("", response_model=list[CalendarConnectionResponse])
async def get_connections(
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    # Get user's first household (same pattern as other endpoints)
    from app.services.household_service import list_households
    households = await list_households(db, user_id)
    if not households:
        return []
    return await list_connections(db, households[0].id, user_id)


@connections_router.post("", response_model=CalendarConnectionResponse, status_code=201)
async def create(
    body: CalendarConnectionCreate,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    from app.services.household_service import list_households
    households = await list_households(db, user_id)
    if not households:
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail="No household found")

    # Validate credentials first
    valid = await validate_caldav_credentials(
        body.server_url, body.calendar_url, body.username, body.password
    )
    if not valid:
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail="Could not connect to CalDAV server — check URL and credentials")

    conn = await create_connection(db, households[0].id, user_id, body)

    # Trigger initial sync
    try:
        await sync_connection(db, conn)
    except Exception:
        pass  # Non-fatal — sync will retry in background

    return conn


@connections_router.patch("/{connection_id}", response_model=CalendarConnectionResponse)
async def update(
    connection_id: str,
    body: CalendarConnectionUpdate,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    return await update_connection(db, connection_id, user_id, body)


@connections_router.delete("/{connection_id}", status_code=204)
async def delete(
    connection_id: str,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    await delete_connection(db, connection_id, user_id)


@connections_router.post("/{connection_id}/sync", response_model=CalendarConnectionResponse)
async def trigger_sync(
    connection_id: str,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    conn = await get_connection(db, connection_id)
    if conn.user_id != user_id:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Calendar connection not found")
    await sync_connection(db, conn)
    await db.refresh(conn)
    return conn


# --- External events (OIDC-authenticated) ---

external_events_router = APIRouter(prefix="/api/households/{household_id}/external-events", tags=["calendar-sync"])


@external_events_router.get("", response_model=list[ExternalEventResponse])
async def get_external_events(
    household_id: str,
    start: date = Query(...),
    end: date = Query(...),
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    await get_household(db, household_id, user_id)
    return await list_external_events(db, household_id, user_id, start, end)


# --- Feed token management (OIDC-authenticated) ---

feed_token_router = APIRouter(prefix="/api/calendar/feed-token", tags=["calendar-sync"])


@feed_token_router.get("", response_model=FeedTokenResponse)
async def get_feed_token(
    request: Request,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    from app.services.household_service import list_households
    households = await list_households(db, user_id)
    if not households:
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail="No household found")

    token = await get_or_create_feed_token(db, user_id, households[0].id)
    base_url = str(request.base_url).rstrip("/")
    return FeedTokenResponse(token=token, url=f"{base_url}/api/calendar/feed/{token}.ics")


@feed_token_router.post("/regenerate", response_model=FeedTokenResponse)
async def regenerate_token(
    request: Request,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    from app.services.household_service import list_households
    households = await list_households(db, user_id)
    if not households:
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail="No household found")

    token = await regenerate_feed_token(db, user_id, households[0].id)
    base_url = str(request.base_url).rstrip("/")
    return FeedTokenResponse(token=token, url=f"{base_url}/api/calendar/feed/{token}.ics")


# --- .ics feed (token-authenticated, no OIDC) ---

feed_router = APIRouter(tags=["calendar-feed"])


@feed_router.get("/api/calendar/feed/{token}.ics")
async def get_feed(
    token: str,
    db: AsyncSession = Depends(get_db),
):
    result = await resolve_feed_token(db, token)
    if not result:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Feed not found")

    user_id, household_id = result
    ical_data = await generate_feed(db, user_id, household_id)

    return Response(
        content=ical_data,
        media_type="text/calendar",
        headers={
            "Content-Disposition": "attachment; filename=nesto.ics",
            "Cache-Control": "no-cache, no-store, must-revalidate",
        },
    )
```

**Step 2: Register routers in main.py**

In `backend/app/main.py`:

Add to imports (line 12):
```python
from app.routers import auth, calendar_sync, events, households, loyalty_cards, shopping_lists, tasks
```

Add after existing router registrations (after line 99):
```python
app.include_router(calendar_sync.connections_router)
app.include_router(calendar_sync.external_events_router)
app.include_router(calendar_sync.feed_token_router)
app.include_router(calendar_sync.feed_router)
```

**Step 3: Commit**

```bash
git add backend/app/routers/calendar_sync.py backend/app/main.py
git commit -m "feat: add calendar sync API routes (connections, feed, external events)"
```

---

### Task 11: Add background sync loop

**Files:**
- Modify: `backend/app/main.py`

**Step 1: Add the sync scheduler loop**

Add the sync loop function after `_digest_scheduler_loop` (after line 61 in `main.py`):

```python
async def _calendar_sync_loop():
    """Background loop that syncs CalDAV connections every 5 minutes."""
    import asyncio as _asyncio
    sync_lock = _asyncio.Lock()
    while True:
        try:
            await _asyncio.sleep(300)  # 5 minutes
            if sync_lock.locked():
                logger.debug("Calendar sync: previous run still in progress, skipping")
                continue
            async with sync_lock:
                from app.services.calendar_sync_service import sync_connection
                from app.models.calendar_sync import CalendarConnection
                from sqlalchemy import select

                async with async_session() as db:
                    result = await db.execute(
                        select(CalendarConnection).where(CalendarConnection.enabled == True)
                    )
                    connections = result.scalars().all()

                for conn in connections:
                    try:
                        async with async_session() as db:
                            # Re-fetch to get fresh state
                            from sqlalchemy import select as sel
                            r = await db.execute(
                                sel(CalendarConnection).where(CalendarConnection.id == conn.id)
                            )
                            fresh_conn = r.scalar_one_or_none()
                            if fresh_conn and fresh_conn.enabled:
                                await sync_connection(db, fresh_conn)
                    except Exception:
                        logger.exception("Calendar sync error for connection %s", conn.id)

        except asyncio.CancelledError:
            break
        except Exception:
            logger.exception("Calendar sync scheduler error")
```

**Step 2: Start the sync task in lifespan**

Update the `lifespan` function to start and cancel the sync loop alongside the digest loop:

```python
@asynccontextmanager
async def lifespan(app: FastAPI):
    os.makedirs("data", exist_ok=True)
    digest_task = asyncio.create_task(_digest_scheduler_loop())
    sync_task = asyncio.create_task(_calendar_sync_loop())
    logger.info("Digest scheduler started (daily@%02d:00, weekly@Sun %02d:00)",
                settings.digest_daily_hour, settings.digest_weekly_hour)
    logger.info("Calendar sync scheduler started (every 5 minutes)")
    yield
    digest_task.cancel()
    sync_task.cancel()
    try:
        await digest_task
    except asyncio.CancelledError:
        pass
    try:
        await sync_task
    except asyncio.CancelledError:
        pass
```

**Step 3: Commit**

```bash
git add backend/app/main.py
git commit -m "feat: add background CalDAV sync loop (5-minute interval)"
```

---

### Task 12: Create frontend API hooks

**Files:**
- Create: `frontend/src/api/calendar-sync.ts`

**Step 1: Create the API module**

Create `frontend/src/api/calendar-sync.ts`:

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch, hasToken } from './client'

export interface CalendarConnection {
  id: string
  user_id: string
  household_id: string
  name: string
  provider: string
  server_url: string
  calendar_url: string
  username: string
  color: string
  sync_token: string | null
  last_synced_at: string | null
  enabled: boolean
  error_count: number
  last_error: string | null
  created_at: string
}

export interface CalendarConnectionCreate {
  name: string
  provider?: string
  server_url: string
  calendar_url: string
  username: string
  password: string
  color?: string
}

export interface CalendarConnectionUpdate {
  name?: string
  color?: string
  enabled?: boolean
  password?: string
}

export interface ExternalEventOccurrence {
  id: string
  connection_id: string
  title: string
  description: string | null
  start_time: string
  end_time: string
  all_day: boolean
  location: string | null
  source_calendar_name: string
  source_calendar_color: string
  provider: string
}

export interface FeedToken {
  token: string
  url: string
}

export function useCalendarConnections() {
  return useQuery({
    queryKey: ['calendar-connections'],
    queryFn: () => apiFetch<CalendarConnection[]>('/calendar/connections'),
    enabled: hasToken(),
  })
}

export function useCreateCalendarConnection() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: CalendarConnectionCreate) =>
      apiFetch<CalendarConnection>('/calendar/connections', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['calendar-connections'] })
      qc.invalidateQueries({ queryKey: ['external-events'] })
    },
  })
}

export function useUpdateCalendarConnection() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ connectionId, ...data }: CalendarConnectionUpdate & { connectionId: string }) =>
      apiFetch<CalendarConnection>(`/calendar/connections/${connectionId}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['calendar-connections'] }),
  })
}

export function useDeleteCalendarConnection() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (connectionId: string) =>
      apiFetch<void>(`/calendar/connections/${connectionId}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['calendar-connections'] })
      qc.invalidateQueries({ queryKey: ['external-events'] })
    },
  })
}

export function useTriggerSync() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (connectionId: string) =>
      apiFetch<CalendarConnection>(`/calendar/connections/${connectionId}/sync`, {
        method: 'POST',
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['calendar-connections'] })
      qc.invalidateQueries({ queryKey: ['external-events'] })
    },
  })
}

export function useExternalEvents(householdId: string, start: string, end: string) {
  return useQuery({
    queryKey: ['external-events', householdId, start, end],
    queryFn: () =>
      apiFetch<ExternalEventOccurrence[]>(
        `/households/${householdId}/external-events?start=${start}&end=${end}`
      ),
    enabled: !!householdId && hasToken(),
  })
}

export function useFeedToken() {
  return useQuery({
    queryKey: ['feed-token'],
    queryFn: () => apiFetch<FeedToken>('/calendar/feed-token'),
    enabled: hasToken(),
  })
}

export function useRegenerateFeedToken() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () =>
      apiFetch<FeedToken>('/calendar/feed-token/regenerate', { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['feed-token'] }),
  })
}
```

**Step 2: Commit**

```bash
git add frontend/src/api/calendar-sync.ts
git commit -m "feat: add frontend API hooks for calendar sync"
```

---

### Task 13: Create ExternalEventCard component

**Files:**
- Create: `frontend/src/components/calendar/external-event-card.tsx`

**Step 1: Create the component**

Create `frontend/src/components/calendar/external-event-card.tsx`:

```tsx
import { Card } from '@/components/ui'
import type { ExternalEventOccurrence } from '@/api/calendar-sync'

interface ExternalEventCardProps {
  occurrence: ExternalEventOccurrence
  occurrenceStart: Date
  occurrenceEnd: Date
}

export function ExternalEventCard({ occurrence, occurrenceStart, occurrenceEnd }: ExternalEventCardProps) {
  return (
    <Card
      className="relative overflow-hidden border-l-4 opacity-90"
      style={{ borderLeftColor: occurrence.source_calendar_color }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-text">{occurrence.title}</p>
          {occurrence.all_day ? (
            <p className="text-sm text-text-muted mt-0.5">All day</p>
          ) : (
            <p className="text-sm text-text-muted mt-0.5">
              {formatTime(occurrenceStart)} – {formatTime(occurrenceEnd)}
            </p>
          )}
          {occurrence.location && (
            <p className="text-xs text-text-muted mt-0.5 truncate">{occurrence.location}</p>
          )}
        </div>
        <span
          className="shrink-0 mt-0.5 px-2 py-0.5 rounded-full text-xs font-medium bg-text/5 text-text-muted"
        >
          {occurrence.source_calendar_name}
        </span>
      </div>
    </Card>
  )
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit', hour12: false })
}
```

**Step 2: Commit**

```bash
git add frontend/src/components/calendar/external-event-card.tsx
git commit -m "feat: add read-only ExternalEventCard component"
```

---

### Task 14: Integrate external events into calendar view

**Files:**
- Modify: `frontend/src/routes/calendar.tsx`

**Step 1: Add imports**

Add to imports in `calendar.tsx` (after line 7):

```typescript
import { useExternalEvents } from '@/api/calendar-sync'
import type { ExternalEventOccurrence } from '@/api/calendar-sync'
import { ExternalEventCard } from '@/components/calendar/external-event-card'
```

**Step 2: Fetch external events**

In `CalendarContent`, after line 69 (`useEvents`), add:

```typescript
  const { data: externalEvents = [] } = useExternalEvents(householdId, fetchStart, fetchEnd)
```

**Step 3: Create merged occurrence type and day list**

After the existing `dayOccurrences` memo (line 101), add:

```typescript
  type CalendarOccurrence =
    | { type: 'native'; occurrence: typeof dayOccurrences[0] }
    | { type: 'external'; occurrence: ExternalEventOccurrence; occurrenceStart: Date; occurrenceEnd: Date }

  const mergedDayOccurrences = useMemo((): CalendarOccurrence[] => {
    const dayStart = new Date(selectedDate)
    dayStart.setHours(0, 0, 0, 0)
    const dayEnd = new Date(selectedDate)
    dayEnd.setHours(23, 59, 59, 999)

    const native: CalendarOccurrence[] = dayOccurrences.map((occ) => ({
      type: 'native' as const,
      occurrence: occ,
    }))

    const external: CalendarOccurrence[] = externalEvents
      .filter((e) => {
        const start = new Date(e.start_time)
        const end = new Date(e.end_time)
        return start <= dayEnd && end >= dayStart
      })
      .map((e) => ({
        type: 'external' as const,
        occurrence: e,
        occurrenceStart: new Date(e.start_time),
        occurrenceEnd: new Date(e.end_time),
      }))

    return [...native, ...external].sort((a, b) => {
      const aAllDay = a.type === 'native' ? (a.occurrence.event.all_day ? 0 : 1) : (a.occurrence.all_day ? 0 : 1)
      const bAllDay = b.type === 'native' ? (b.occurrence.event.all_day ? 0 : 1) : (b.occurrence.all_day ? 0 : 1)
      if (aAllDay !== bAllDay) return aAllDay - bAllDay
      const aStart = a.type === 'native' ? a.occurrence.occurrenceStart : a.occurrenceStart
      const bStart = b.type === 'native' ? b.occurrence.occurrenceStart : b.occurrenceStart
      return aStart.getTime() - bStart.getTime()
    })
  }, [dayOccurrences, externalEvents, selectedDate])
```

**Step 4: Update rendering to use merged list**

Replace the existing render block (lines 149-178) with:

```typescript
      ) : mergedDayOccurrences.length === 0 ? (
```

And replace the `.map()` section (lines 159-177) to render both types:

```typescript
        <motion.div className="space-y-3">
          <AnimatePresence>
            {mergedDayOccurrences.map((item, i) => (
              <motion.div
                key={item.type === 'native'
                  ? `${item.occurrence.event.id}-${item.occurrence.occurrenceStart.toISOString()}`
                  : `ext-${item.occurrence.id}`
                }
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, x: -200 }}
                transition={{ delay: i * 0.05 }}
              >
                {item.type === 'native' ? (
                  <EventCard
                    occurrence={item.occurrence}
                    members={members}
                    onClick={() => setEditEvent(item.occurrence.event)}
                  />
                ) : (
                  <ExternalEventCard
                    occurrence={item.occurrence}
                    occurrenceStart={item.occurrenceStart}
                    occurrenceEnd={item.occurrenceEnd}
                  />
                )}
              </motion.div>
            ))}
          </AnimatePresence>
        </motion.div>
```

**Step 5: Pass external events to WeekStrip for dot indicators**

Update the `occurrences` prop passed to `WeekStrip` (line 134). Add the external events as additional occurrences:

After the existing `occurrences` memo, add:

```typescript
  const allOccurrences = useMemo(() => {
    const externalOccs = externalEvents.map((e) => ({
      event: { id: e.id, all_day: e.all_day } as any,
      occurrenceStart: new Date(e.start_time),
      occurrenceEnd: new Date(e.end_time),
    }))
    return [...occurrences, ...externalOccs]
  }, [occurrences, externalEvents])
```

Then pass `allOccurrences` to `WeekStrip` instead of `occurrences`:

```tsx
<WeekStrip ... occurrences={allOccurrences} />
```

**Step 6: Commit**

```bash
git add frontend/src/routes/calendar.tsx
git commit -m "feat: integrate external events into calendar view"
```

---

### Task 15: Create AddCalendarSheet component

**Files:**
- Create: `frontend/src/components/calendar/add-calendar-sheet.tsx`

**Step 1: Create the component**

Create `frontend/src/components/calendar/add-calendar-sheet.tsx`:

```tsx
import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Button, Input } from '@/components/ui'
import { useCreateCalendarConnection } from '@/api/calendar-sync'

interface AddCalendarSheetProps {
  open: boolean
  onClose: () => void
}

const PROVIDERS = [
  { value: 'icloud', label: 'iCloud', hint: 'https://caldav.icloud.com' },
  { value: 'nextcloud', label: 'Nextcloud', hint: 'https://your-server.com/remote.php/dav' },
  { value: 'caldav', label: 'Other', hint: 'https://...' },
] as const

const COLORS = ['#6C5CE7', '#00CEC9', '#FF6B6B', '#FDCB6E', '#00B894', '#E17055', '#0984E3', '#A29BFE']

export function AddCalendarSheet({ open, onClose }: AddCalendarSheetProps) {
  const [step, setStep] = useState<'url' | 'name'>('url')
  const [provider, setProvider] = useState<string>('caldav')
  const [serverUrl, setServerUrl] = useState('')
  const [calendarUrl, setCalendarUrl] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [color, setColor] = useState(COLORS[0])
  const [error, setError] = useState('')

  const createMutation = useCreateCalendarConnection()

  const reset = () => {
    setStep('url')
    setProvider('caldav')
    setServerUrl('')
    setCalendarUrl('')
    setUsername('')
    setPassword('')
    setName('')
    setColor(COLORS[0])
    setError('')
  }

  const handleClose = () => {
    reset()
    onClose()
  }

  const handleValidate = () => {
    if (!serverUrl || !calendarUrl || !username || !password) {
      setError('All fields are required')
      return
    }
    setError('')
    setStep('name')
    if (!name) setName(`${PROVIDERS.find(p => p.value === provider)?.label || 'Calendar'}`)
  }

  const handleSubmit = async () => {
    if (!name.trim()) return
    setError('')
    try {
      await createMutation.mutateAsync({
        name: name.trim(),
        provider,
        server_url: serverUrl,
        calendar_url: calendarUrl,
        username,
        password,
        color,
      })
      handleClose()
    } catch (e: any) {
      setError(e?.message || 'Failed to connect')
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 bg-black/30 z-40"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={handleClose}
          />
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="fixed bottom-0 left-0 right-0 bg-surface rounded-t-3xl p-6 pb-[env(safe-area-inset-bottom)] z-50 max-w-lg mx-auto max-h-[85vh] overflow-y-auto"
          >
            <div className="w-12 h-1.5 bg-text/10 rounded-full mx-auto mb-6" />

            {step === 'url' && (
              <>
                <h2 className="text-lg font-bold text-text mb-4">Add Calendar</h2>

                <p className="text-sm font-medium text-text mb-2">Provider</p>
                <div className="flex gap-2 mb-4">
                  {PROVIDERS.map((p) => (
                    <button
                      key={p.value}
                      onClick={() => {
                        setProvider(p.value)
                        if (p.value === 'icloud') setServerUrl(p.hint)
                      }}
                      className={`flex-1 py-2 rounded-xl text-sm font-medium transition-all ${
                        provider === p.value
                          ? 'bg-primary text-white shadow-md'
                          : 'bg-text/5 text-text-muted'
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>

                {provider === 'icloud' && (
                  <div className="bg-warning/10 rounded-xl p-3 mb-4">
                    <p className="text-xs text-text-muted">
                      iCloud requires an <strong>app-specific password</strong>. Generate one at{' '}
                      <span className="text-primary">appleid.apple.com</span> under Sign-In and Security.
                    </p>
                  </div>
                )}

                <div className="space-y-3">
                  <Input
                    label="Server URL"
                    value={serverUrl}
                    onChange={(e) => setServerUrl(e.target.value)}
                    placeholder="https://caldav.example.com"
                  />
                  <Input
                    label="Calendar URL"
                    value={calendarUrl}
                    onChange={(e) => setCalendarUrl(e.target.value)}
                    placeholder="https://caldav.example.com/user/calendar/"
                  />
                  <Input
                    label="Username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                  />
                  <Input
                    label="Password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>

                {error && <p className="text-xs text-accent mt-2">{error}</p>}

                <Button className="w-full mt-4" onClick={handleValidate}>
                  Next
                </Button>
              </>
            )}

            {step === 'name' && (
              <>
                <h2 className="text-lg font-bold text-text mb-4">Calendar Details</h2>

                <Input
                  label="Display name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="My Calendar"
                  autoFocus
                />

                <p className="text-sm font-medium text-text mt-4 mb-2">Color</p>
                <div className="flex gap-2 flex-wrap">
                  {COLORS.map((c) => (
                    <button
                      key={c}
                      onClick={() => setColor(c)}
                      className={`w-8 h-8 rounded-full transition-all ${
                        color === c ? 'ring-2 ring-offset-2 ring-primary' : ''
                      }`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>

                {error && <p className="text-xs text-accent mt-3">{error}</p>}

                <div className="flex gap-2 mt-6">
                  <Button variant="ghost" className="flex-1" onClick={() => setStep('url')}>
                    Back
                  </Button>
                  <Button
                    className="flex-1"
                    onClick={handleSubmit}
                    disabled={!name.trim() || createMutation.isPending}
                  >
                    {createMutation.isPending ? 'Connecting...' : 'Add Calendar'}
                  </Button>
                </div>
              </>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
```

**Step 2: Commit**

```bash
git add frontend/src/components/calendar/add-calendar-sheet.tsx
git commit -m "feat: add AddCalendarSheet component for CalDAV connection setup"
```

---

### Task 16: Add Calendar Sync section to Settings

**Files:**
- Modify: `frontend/src/routes/settings.tsx`

**Step 1: Add imports**

Add to the imports at the top of `settings.tsx`:

```typescript
import {
  useCalendarConnections,
  useUpdateCalendarConnection,
  useDeleteCalendarConnection,
  useTriggerSync,
  useFeedToken,
  useRegenerateFeedToken,
} from '@/api/calendar-sync'
import { AddCalendarSheet } from '@/components/calendar/add-calendar-sheet'
```

**Step 2: Add CalendarSyncSection component**

Add the following function after `InviteSection` (after line 189):

```typescript
function CalendarSyncSection({ householdId }: { householdId: string }) {
  const { data: connections = [] } = useCalendarConnections()
  const [showAdd, setShowAdd] = useState(false)

  return (
    <div>
      {connections.length > 0 && (
        <div className="space-y-3 mb-4">
          {connections.map((conn) => (
            <ConnectedCalendarRow key={conn.id} connection={conn} />
          ))}
        </div>
      )}

      <Button variant="secondary" size="sm" onClick={() => setShowAdd(true)}>
        Add calendar
      </Button>

      <div className="mt-4 pt-4 border-t border-text/10">
        <IcsSubscriptionSection />
      </div>

      <AddCalendarSheet open={showAdd} onClose={() => setShowAdd(false)} />
    </div>
  )
}

function ConnectedCalendarRow({ connection }: { connection: import('@/api/calendar-sync').CalendarConnection }) {
  const updateMutation = useUpdateCalendarConnection()
  const deleteMutation = useDeleteCalendarConnection()
  const syncMutation = useTriggerSync()
  const [confirmDelete, setConfirmDelete] = useState(false)

  return (
    <div className="bg-background rounded-xl p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="w-3 h-3 rounded-full shrink-0"
            style={{ backgroundColor: connection.color }}
          />
          <div className="min-w-0">
            <p className="text-sm font-medium text-text truncate">{connection.name}</p>
            <p className="text-xs text-text-muted">
              {connection.provider} · {connection.last_synced_at
                ? `Synced ${new Date(connection.last_synced_at).toLocaleString()}`
                : 'Never synced'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => syncMutation.mutate(connection.id)}
            disabled={syncMutation.isPending}
            className="text-xs text-primary font-medium px-2 py-1"
          >
            {syncMutation.isPending ? '...' : 'Sync'}
          </button>
          <button
            type="button"
            role="switch"
            aria-checked={connection.enabled}
            onClick={() => updateMutation.mutate({ connectionId: connection.id, enabled: !connection.enabled })}
            className={`relative shrink-0 w-9 h-5 rounded-full transition-colors ${connection.enabled ? 'bg-primary' : 'bg-text/15'}`}
          >
            <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${connection.enabled ? 'translate-x-4' : 'translate-x-0'}`} />
          </button>
        </div>
      </div>
      {connection.error_count > 0 && connection.last_error && (
        <p className="text-xs text-accent mt-2">{connection.last_error}</p>
      )}
      <div className="mt-2 flex justify-end">
        {confirmDelete ? (
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>Cancel</Button>
            <Button size="sm" variant="danger" onClick={() => deleteMutation.mutate(connection.id)} disabled={deleteMutation.isPending}>
              {deleteMutation.isPending ? '...' : 'Confirm'}
            </Button>
          </div>
        ) : (
          <button type="button" onClick={() => setConfirmDelete(true)} className="text-xs text-accent font-medium">
            Remove
          </button>
        )}
      </div>
    </div>
  )
}

function IcsSubscriptionSection() {
  const { data: feedToken } = useFeedToken()
  const regenerateMutation = useRegenerateFeedToken()
  const [copied, setCopied] = useState(false)
  const [confirmRegen, setConfirmRegen] = useState(false)

  const handleCopy = async () => {
    if (!feedToken?.url) return
    await navigator.clipboard.writeText(feedToken.url)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div>
      <p className="text-sm font-medium text-text mb-1">Calendar subscription</p>
      <p className="text-xs text-text-muted mb-2">Subscribe to this URL in your calendar app to see Nesto events.</p>
      {feedToken ? (
        <>
          <div className="bg-background rounded-xl p-3 mb-2">
            <p className="font-mono text-xs text-primary break-all">{feedToken.url}</p>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={handleCopy}>
              {copied ? 'Copied!' : 'Copy URL'}
            </Button>
            {confirmRegen ? (
              <>
                <Button size="sm" variant="danger" onClick={() => { regenerateMutation.mutate(); setConfirmRegen(false) }}>
                  Confirm
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmRegen(false)}>
                  Cancel
                </Button>
              </>
            ) : (
              <Button size="sm" variant="ghost" onClick={() => setConfirmRegen(true)}>
                Regenerate
              </Button>
            )}
          </div>
        </>
      ) : (
        <p className="text-xs text-text-muted">Loading...</p>
      )}
    </div>
  )
}
```

**Step 3: Add CalendarSyncSection to the settings page**

In the `SettingsPage` return statement, after the Household Card (after line 73), add:

```tsx
      {/* Calendar Sync */}
      {household && (
        <Card className="mb-4">
          <h2 className="font-bold text-text mb-3">Calendar Sync</h2>
          <CalendarSyncSection householdId={household.id} />
        </Card>
      )}
```

**Step 4: Commit**

```bash
git add frontend/src/routes/settings.tsx
git commit -m "feat: add Calendar Sync section to settings (connections + feed URL)"
```

---

### Task 17: Update CLAUDE.md

**Files:**
- Modify: `/home/jan/nesto/.claude/CLAUDE.md`

**Step 1: Update CLAUDE.md to reflect new routes, models, and services**

Add calendar sync to relevant sections:

- Models section: add `calendar_connection`, `external_event`
- Services section: add `calendar_connection_service`, `calendar_sync_service`, `feed_service`, `external_event_service`, `crypto_service`
- Routes section: add `calendar_sync` router
- API endpoints: add all new endpoints
- Components: add `external-event-card`, `add-calendar-sheet`
- Frontend API: add `calendar-sync.ts`
- Dependencies: add `caldav`, `icalendar`, `cryptography`

**Step 2: Commit**

```bash
git add .claude/CLAUDE.md
git commit -m "docs: update CLAUDE.md with calendar sync feature"
```

---

### Task 18: End-to-end smoke test

**Step 1: Start the backend**

Run: `cd backend && uvicorn app.main:app --reload`
Expected: No import errors, "Calendar sync scheduler started" in logs.

**Step 2: Verify endpoints exist**

Run (in another terminal):
```bash
curl -s http://localhost:8000/docs | grep -o 'calendar' | head -5
```
Expected: Multiple matches (if in dev mode with docs enabled).

**Step 3: Start the frontend**

Run: `cd frontend && npm run dev`
Expected: No build errors. Settings page shows "Calendar Sync" section.

**Step 4: Commit final state**

```bash
git add -A
git commit -m "feat: calendar sync feature complete"
```
