# Birthdays Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add birthday tracking shared per household — CRUD management page under More tab, display on calendar as all-day events, and include in ICS feed.

**Architecture:** Standalone `birthdays` table with `person_name`, `birth_month`, `birth_day`, `birth_year` (nullable). Backend CRUD service + router following the loyalty_card pattern. Frontend list page under `/birthdays`, birthday cards on the calendar view, and edit sheet accessible from both the list page and calendar. ICS feed extended with yearly-recurring birthday VEVENTs.

**Tech Stack:** FastAPI, SQLAlchemy 2.0 async, Alembic, React 19, TanStack Router/Query, Framer Motion, Tailwind CSS v4, icalendar

**Review findings incorporated:** This plan addresses all critical, high, and medium findings from the domain architecture review, security/bug-hunt review, and frontend UX review conducted 2026-03-22.

---

### Task 1: Backend Model

**Files:**
- Create: `backend/app/models/birthday.py`
- Modify: `backend/app/models/__init__.py`

**Step 1: Create the Birthday model**

Create `backend/app/models/birthday.py`:

```python
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class Birthday(Base):
    __tablename__ = "birthdays"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    household_id: Mapped[str] = mapped_column(Text, ForeignKey("households.id", ondelete="CASCADE"), nullable=False)
    person_name: Mapped[str] = mapped_column(Text, nullable=False)
    birth_month: Mapped[int] = mapped_column(Integer, nullable=False)
    birth_day: Mapped[int] = mapped_column(Integer, nullable=False)
    birth_year: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_by: Mapped[str] = mapped_column(Text, ForeignKey("users.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())
```

**Step 2: Register in models/__init__.py**

Add to `backend/app/models/__init__.py`:
- Import: `from app.models.birthday import Birthday` (after the document import, line 2)
- Export: Add `"Birthday"` to `__all__` (after `"LoyaltyCard"`, line 19)

**Step 3: Commit**

```bash
git add backend/app/models/birthday.py backend/app/models/__init__.py
git commit -m "feat(birthdays): add Birthday model"
```

---

### Task 2: Alembic Migration

**Files:**
- Create: `backend/alembic/versions/<auto>_add_birthdays_table.py`

**Step 1: Generate the migration**

```bash
cd backend && alembic revision --autogenerate -m "add birthdays table"
```

**Step 2: Verify the generated migration**

Open the generated file and confirm it contains:
- `op.create_table('birthdays', ...)` with all columns (id, household_id, person_name, birth_month, birth_day, birth_year, created_by, created_at, updated_at)
- `op.create_index('ix_birthdays_household_id', 'birthdays', ['household_id'])`
- A downgrade that drops the index and table

If the index isn't auto-generated, add it manually:
```python
op.create_index('ix_birthdays_household_id', 'birthdays', ['household_id'])
```

**Step 3: Run the migration**

```bash
cd backend && alembic upgrade head
```

**Step 4: Commit**

```bash
git add backend/alembic/versions/
git commit -m "feat(birthdays): add migration for birthdays table"
```

---

### Task 3: Backend Schemas

**Files:**
- Create: `backend/app/schemas/birthday.py`

**Step 1: Create Pydantic schemas**

Create `backend/app/schemas/birthday.py`:

```python
import calendar as cal_mod
from datetime import datetime

from pydantic import BaseModel, Field, model_validator


class BirthdayCreate(BaseModel):
    person_name: str = Field(min_length=1, max_length=200)
    birth_month: int = Field(ge=1, le=12)
    birth_day: int = Field(ge=1, le=31)
    birth_year: int | None = Field(default=None, ge=1900)

    @model_validator(mode="after")
    def validate_date(self) -> "BirthdayCreate":
        # Cap birth_year at current year
        if self.birth_year is not None and self.birth_year > datetime.now().year:
            raise ValueError(f"Birth year cannot be in the future")
        # Validate day for month, accounting for leap year when birth_year is known
        if self.birth_year is not None:
            # Use real calendar validation
            max_day = cal_mod.monthrange(self.birth_year, self.birth_month)[1]
            if self.birth_day > max_day:
                raise ValueError(
                    f"Day {self.birth_day} is invalid for "
                    f"{cal_mod.month_name[self.birth_month]} {self.birth_year}"
                )
        else:
            # Year unknown — allow Feb 29 (leap day birthdays exist)
            max_days = {1: 31, 2: 29, 3: 31, 4: 30, 5: 31, 6: 30,
                        7: 31, 8: 31, 9: 30, 10: 31, 11: 30, 12: 31}
            if self.birth_day > max_days.get(self.birth_month, 31):
                raise ValueError(
                    f"Day {self.birth_day} is invalid for month {self.birth_month}"
                )
        return self


class BirthdayUpdate(BaseModel):
    person_name: str | None = Field(default=None, min_length=1, max_length=200)
    birth_month: int | None = Field(default=None, ge=1, le=12)
    birth_day: int | None = Field(default=None, ge=1, le=31)
    birth_year: int | None = Field(default=None, ge=1900)
    # Note: birth_year can be explicitly set to null to clear it.
    # Cross-field validation (month/day combo) is done in the service layer
    # after merging with the existing record, since this is a partial update.


class BirthdayResponse(BaseModel):
    id: str
    household_id: str
    person_name: str
    birth_month: int
    birth_day: int
    birth_year: int | None
    age: int | None
    created_by: str
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
```

**Key review findings addressed:**
- `BirthdayCreate` validates Feb 29 against actual leap year when `birth_year` is known (Finding #3)
- `birth_year` capped at current year to prevent negative ages (Finding #10)
- Cross-field validation for `BirthdayUpdate` is deferred to service layer (Finding #2)

**Step 2: Commit**

```bash
git add backend/app/schemas/birthday.py
git commit -m "feat(birthdays): add Pydantic schemas with leap year validation"
```

---

### Task 4: Backend Service

**Files:**
- Create: `backend/app/services/birthday_service.py`

**Step 1: Create the birthday service**

Create `backend/app/services/birthday_service.py`:

```python
import calendar as cal_mod
import uuid
from datetime import date

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.birthday import Birthday
from app.schemas.birthday import BirthdayCreate, BirthdayResponse, BirthdayUpdate

_UPDATABLE_FIELDS = {"person_name", "birth_month", "birth_day", "birth_year"}


def _compute_age(birth_year: int | None, birth_month: int, birth_day: int) -> int | None:
    """Compute current age. Returns None if birth_year is unknown or in the future."""
    if birth_year is None:
        return None
    today = date.today()
    age = today.year - birth_year
    if (today.month, today.day) < (birth_month, birth_day):
        age -= 1
    # Guard against future birth years (should be rejected by schema, but be safe)
    if age < 0:
        return None
    return age


def _birthday_to_response(birthday: Birthday) -> BirthdayResponse:
    return BirthdayResponse(
        id=birthday.id,
        household_id=birthday.household_id,
        person_name=birthday.person_name,
        birth_month=birthday.birth_month,
        birth_day=birthday.birth_day,
        birth_year=birthday.birth_year,
        age=_compute_age(birthday.birth_year, birthday.birth_month, birthday.birth_day),
        created_by=birthday.created_by,
        created_at=birthday.created_at,
        updated_at=birthday.updated_at,
    )


def _validate_month_day(month: int, day: int, year: int | None = None) -> None:
    """Validate that the day is valid for the given month (and year if known).
    Raises HTTPException 422 on invalid combinations like Feb 31."""
    if year is not None:
        max_day = cal_mod.monthrange(year, month)[1]
        if day > max_day:
            raise HTTPException(
                status_code=422,
                detail=f"Day {day} is invalid for {cal_mod.month_name[month]} {year}",
            )
    else:
        max_days = {1: 31, 2: 29, 3: 31, 4: 30, 5: 31, 6: 30,
                    7: 31, 8: 31, 9: 30, 10: 31, 11: 30, 12: 31}
        if day > max_days.get(month, 31):
            raise HTTPException(
                status_code=422,
                detail=f"Day {day} is invalid for month {month}",
            )


async def list_birthdays(
    db: AsyncSession, household_id: str
) -> list[BirthdayResponse]:
    result = await db.execute(
        select(Birthday)
        .where(Birthday.household_id == household_id)
        .order_by(Birthday.birth_month.asc(), Birthday.birth_day.asc())
    )
    return [_birthday_to_response(b) for b in result.scalars().all()]


async def create_birthday(
    db: AsyncSession, household_id: str, user_id: str, data: BirthdayCreate
) -> BirthdayResponse:
    birthday = Birthday(
        id=str(uuid.uuid4()),
        household_id=household_id,
        created_by=user_id,
        **data.model_dump(),
    )
    db.add(birthday)
    await db.commit()
    await db.refresh(birthday)
    return _birthday_to_response(birthday)


async def update_birthday(
    db: AsyncSession, birthday_id: str, household_id: str, data: BirthdayUpdate
) -> BirthdayResponse:
    birthday = await _get_birthday_or_404(db, birthday_id, household_id)
    updates = data.model_dump(exclude_unset=True)

    # Compute effective month/day/year after merging patch with existing values
    effective_month = updates.get("birth_month", birthday.birth_month)
    effective_day = updates.get("birth_day", birthday.birth_day)
    effective_year = updates.get("birth_year", birthday.birth_year)

    # Validate the resulting combination (catches Feb 31, Apr 31, etc.)
    _validate_month_day(effective_month, effective_day, effective_year)

    for key, value in updates.items():
        if key in _UPDATABLE_FIELDS:
            setattr(birthday, key, value)
    await db.commit()
    await db.refresh(birthday)
    return _birthday_to_response(birthday)


async def delete_birthday(
    db: AsyncSession, birthday_id: str, household_id: str
) -> None:
    birthday = await _get_birthday_or_404(db, birthday_id, household_id)
    await db.delete(birthday)
    await db.commit()


async def get_birthdays_for_feed(
    db: AsyncSession, household_id: str
) -> list[Birthday]:
    """Raw Birthday objects for ICS feed generation."""
    result = await db.execute(
        select(Birthday).where(Birthday.household_id == household_id)
    )
    return list(result.scalars().all())


async def _get_birthday_or_404(
    db: AsyncSession, birthday_id: str, household_id: str
) -> Birthday:
    result = await db.execute(
        select(Birthday).where(
            Birthday.id == birthday_id,
            Birthday.household_id == household_id,
        )
    )
    birthday = result.scalar_one_or_none()
    if not birthday:
        raise HTTPException(status_code=404, detail="Birthday not found")
    return birthday
```

**Key review findings addressed:**
- `_validate_month_day` called in `update_birthday` after merging patch with existing values — prevents storing impossible dates like Feb 31 (Finding #2)
- `_compute_age` returns `None` for negative ages (Finding #10)
- Validation helper shared between create (via schema) and update (via service) paths

**Step 2: Commit**

```bash
git add backend/app/services/birthday_service.py
git commit -m "feat(birthdays): add birthday service with cross-field validation"
```

---

### Task 5: Backend Router

**Files:**
- Create: `backend/app/routers/birthdays.py`
- Modify: `backend/app/main.py` (line 12 import, after line 145 registration)

**Step 1: Create the birthdays router**

Create `backend/app/routers/birthdays.py`:

```python
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user_id
from app.database import get_db
from app.schemas.birthday import BirthdayCreate, BirthdayResponse, BirthdayUpdate
from app.services.household_service import get_household
from app.services import birthday_service as svc

router = APIRouter(prefix="/api/households/{household_id}/birthdays", tags=["birthdays"])


@router.get("", response_model=list[BirthdayResponse])
async def get_birthdays(
    household_id: str,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    await get_household(db, household_id, user_id)
    return await svc.list_birthdays(db, household_id)


@router.post("", response_model=BirthdayResponse, status_code=201)
async def create_birthday(
    household_id: str,
    body: BirthdayCreate,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    await get_household(db, household_id, user_id)
    return await svc.create_birthday(db, household_id, user_id, body)


@router.patch("/{birthday_id}", response_model=BirthdayResponse)
async def update_birthday(
    household_id: str,
    birthday_id: str,
    body: BirthdayUpdate,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    await get_household(db, household_id, user_id)
    return await svc.update_birthday(db, birthday_id, household_id, body)


@router.delete("/{birthday_id}", status_code=204)
async def delete_birthday(
    household_id: str,
    birthday_id: str,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    await get_household(db, household_id, user_id)
    await svc.delete_birthday(db, birthday_id, household_id)
```

Note: No `start`/`end` query params — the birthday list is always small (household-scoped), so client-side filtering is appropriate. The design doc has been updated to remove this.

**Step 2: Register in main.py**

In `backend/app/main.py`:
- Line 12: Add `birthdays` to the import: `from app.routers import auth, birthdays, calendar_sync, documents, events, households, loyalty_cards, shopping_lists, tasks`
- After line 145 (after `loyalty_cards.router`): Add `app.include_router(birthdays.router)`

**Step 3: Verify the backend starts**

```bash
cd backend && python -c "from app.main import app; print('OK')"
```

**Step 4: Commit**

```bash
git add backend/app/routers/birthdays.py backend/app/main.py
git commit -m "feat(birthdays): add CRUD router and register in app"
```

---

### Task 6: ICS Feed Integration

**Files:**
- Modify: `backend/app/services/feed_service.py`

**Step 1: Add birthday VEVENT generation**

In `backend/app/services/feed_service.py`:

Add import at top (after line 10):
```python
from app.models.birthday import Birthday
```

Add a new helper function after `_event_to_vevent` (after line 49):

```python
def _birthday_to_vevent(birthday: Birthday) -> ICalEvent:
    vevent = ICalEvent()
    vevent.add("uid", f"birthday-{birthday.id}@nesto")

    # Summary: include birth year if known (static, doesn't go stale in cached feeds)
    # Don't embed "turns N" — it bakes a specific age into the RRULE'd event summary
    # that becomes wrong in subsequent years when the calendar app caches the feed.
    if birthday.birth_year:
        vevent.add("summary", f"\U0001f382 {birthday.person_name}'s Birthday (born {birthday.birth_year})")
    else:
        vevent.add("summary", f"\U0001f382 {birthday.person_name}'s Birthday")

    # Use 2000 as reference year when birth_year is unknown.
    # MUST be a leap year so Feb 29 birthdays don't raise ValueError.
    # (1900 is NOT a leap year — date(1900, 2, 29) crashes.)
    ref_year = birthday.birth_year or 2000
    start = date(ref_year, birthday.birth_month, birthday.birth_day)
    vevent.add("dtstart", start)
    # DTEND is required by RFC 5545; exclusive, so day after for all-day events
    vevent.add("dtend", start + timedelta(days=1))
    vevent.add("rrule", {"freq": "YEARLY"})

    return vevent
```

**Key review findings addressed:**
- Uses `2000` (leap year) as reference, not `1900` — prevents `ValueError` on Feb 29 (Finding #1 CRITICAL)
- Uses `"born {year}"` instead of `"turns N"` — age doesn't go stale in cached feeds (Finding #4)
- Includes `DTEND` per RFC 5545 (Finding #5)

In `generate_feed` function (around line 52-69), add birthday fetching after the events query:

After line 59 (`events = result.scalars().all()`), add:
```python
    from app.services.birthday_service import get_birthdays_for_feed
    birthdays = await get_birthdays_for_feed(db, household_id)
```

After line 67 (`cal.add_component(_event_to_vevent(event))`), add:
```python
    for birthday in birthdays:
        cal.add_component(_birthday_to_vevent(birthday))
```

**Step 2: Commit**

```bash
git add backend/app/services/feed_service.py
git commit -m "feat(birthdays): add birthday VEVENTs to ICS feed (RFC 5545 compliant)"
```

---

### Task 7: Backend Tests

**Files:**
- Create: `backend/tests/test_birthdays.py`

**Step 1: Write tests**

Create `backend/tests/test_birthdays.py`:

```python
import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_birthday_crud(client: AsyncClient, auth_headers: dict, household_id: str):
    # Create
    resp = await client.post(
        f"/api/households/{household_id}/birthdays",
        json={"person_name": "Alice", "birth_month": 3, "birth_day": 15, "birth_year": 1990},
        headers=auth_headers,
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["person_name"] == "Alice"
    assert data["birth_month"] == 3
    assert data["birth_day"] == 15
    assert data["birth_year"] == 1990
    assert data["age"] is not None
    assert data["age"] >= 0
    birthday_id = data["id"]

    # List
    resp = await client.get(
        f"/api/households/{household_id}/birthdays",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    assert len(resp.json()) == 1

    # Update
    resp = await client.patch(
        f"/api/households/{household_id}/birthdays/{birthday_id}",
        json={"person_name": "Alice Smith"},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["person_name"] == "Alice Smith"

    # Delete
    resp = await client.delete(
        f"/api/households/{household_id}/birthdays/{birthday_id}",
        headers=auth_headers,
    )
    assert resp.status_code == 204


@pytest.mark.asyncio
async def test_birthday_without_birth_year(client: AsyncClient, auth_headers: dict, household_id: str):
    resp = await client.post(
        f"/api/households/{household_id}/birthdays",
        json={"person_name": "Bob", "birth_month": 12, "birth_day": 25},
        headers=auth_headers,
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["birth_year"] is None
    assert data["age"] is None


@pytest.mark.asyncio
async def test_birthday_clear_birth_year(client: AsyncClient, auth_headers: dict, household_id: str):
    """Clearing birth_year to null should work and set age to null."""
    resp = await client.post(
        f"/api/households/{household_id}/birthdays",
        json={"person_name": "Carol", "birth_month": 6, "birth_day": 15, "birth_year": 1985},
        headers=auth_headers,
    )
    assert resp.status_code == 201
    birthday_id = resp.json()["id"]
    assert resp.json()["age"] is not None

    # Clear birth_year
    resp = await client.patch(
        f"/api/households/{household_id}/birthdays/{birthday_id}",
        json={"birth_year": None},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["birth_year"] is None
    assert resp.json()["age"] is None


@pytest.mark.asyncio
async def test_birthday_invalid_day_for_month(client: AsyncClient, auth_headers: dict, household_id: str):
    """Feb 30 should be rejected."""
    resp = await client.post(
        f"/api/households/{household_id}/birthdays",
        json={"person_name": "Bad", "birth_month": 2, "birth_day": 30},
        headers=auth_headers,
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_birthday_feb29_non_leap_year_rejected(client: AsyncClient, auth_headers: dict, household_id: str):
    """Feb 29 with a non-leap birth_year (e.g. 1990) should be rejected."""
    resp = await client.post(
        f"/api/households/{household_id}/birthdays",
        json={"person_name": "Leap", "birth_month": 2, "birth_day": 29, "birth_year": 1990},
        headers=auth_headers,
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_birthday_feb29_no_year_accepted(client: AsyncClient, auth_headers: dict, household_id: str):
    """Feb 29 without a birth_year should be accepted (leap day birthdays exist)."""
    resp = await client.post(
        f"/api/households/{household_id}/birthdays",
        json={"person_name": "Leapfrog", "birth_month": 2, "birth_day": 29},
        headers=auth_headers,
    )
    assert resp.status_code == 201


@pytest.mark.asyncio
async def test_birthday_feb29_leap_year_accepted(client: AsyncClient, auth_headers: dict, household_id: str):
    """Feb 29 with a leap year birth_year should be accepted."""
    resp = await client.post(
        f"/api/households/{household_id}/birthdays",
        json={"person_name": "Leaper", "birth_month": 2, "birth_day": 29, "birth_year": 2000},
        headers=auth_headers,
    )
    assert resp.status_code == 201


@pytest.mark.asyncio
async def test_birthday_update_cross_field_validation(client: AsyncClient, auth_headers: dict, household_id: str):
    """Changing month to Feb while day=31 should be rejected (cross-field validation)."""
    # Create with Jan 31 (valid)
    resp = await client.post(
        f"/api/households/{household_id}/birthdays",
        json={"person_name": "Cross", "birth_month": 1, "birth_day": 31},
        headers=auth_headers,
    )
    assert resp.status_code == 201
    birthday_id = resp.json()["id"]

    # Patch month to February — should reject because day 31 is invalid for Feb
    resp = await client.patch(
        f"/api/households/{household_id}/birthdays/{birthday_id}",
        json={"birth_month": 2},
        headers=auth_headers,
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_birthday_update_day_validation(client: AsyncClient, auth_headers: dict, household_id: str):
    """Changing day to 31 on an April birthday should be rejected."""
    resp = await client.post(
        f"/api/households/{household_id}/birthdays",
        json={"person_name": "April", "birth_month": 4, "birth_day": 30},
        headers=auth_headers,
    )
    assert resp.status_code == 201
    birthday_id = resp.json()["id"]

    resp = await client.patch(
        f"/api/households/{household_id}/birthdays/{birthday_id}",
        json={"birth_day": 31},
        headers=auth_headers,
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_birthday_household_isolation(client: AsyncClient, auth_headers: dict, household_id: str):
    """Birthday from one household should not be accessible via another household's URL."""
    resp = await client.post(
        f"/api/households/{household_id}/birthdays",
        json={"person_name": "Isolated", "birth_month": 1, "birth_day": 1},
        headers=auth_headers,
    )
    assert resp.status_code == 201
    birthday_id = resp.json()["id"]

    # Attempt to access via a fake household ID
    resp = await client.get(
        f"/api/households/fake-household-id/birthdays",
        headers=auth_headers,
    )
    assert resp.status_code == 404

    resp = await client.patch(
        f"/api/households/fake-household-id/birthdays/{birthday_id}",
        json={"person_name": "Hacked"},
        headers=auth_headers,
    )
    assert resp.status_code == 404
```

**Step 2: Check existing test fixtures**

Before running, check `backend/tests/conftest.py` for existing fixtures (`client`, `auth_headers`, `household_id`). Adapt the test to match the project's test setup if fixtures differ.

**Step 3: Run tests**

```bash
cd backend && pytest tests/test_birthdays.py -v
```

Expected: All tests pass.

**Step 4: Commit**

```bash
git add backend/tests/test_birthdays.py
git commit -m "test(birthdays): add comprehensive tests including edge cases"
```

---

### Task 8: Frontend Theme + API Hooks

**Files:**
- Modify: `frontend/src/styles/index.css` (add birthday color token)
- Create: `frontend/src/api/birthdays.ts`

**Step 1: Add birthday color to theme**

In `frontend/src/styles/index.css`, add after `--color-warning` (line 12):
```css
  --color-birthday: #E879A0;
```

In the `.dark` block (after line 62), add:
```css
  --color-birthday: #F09EBA;
```

This gives birthdays a warm pink that harmonizes with the existing palette and adapts to dark mode, rather than using a hardcoded `pink-400`.

**Step 2: Create the API hooks**

Create `frontend/src/api/birthdays.ts`:

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch, hasToken } from './client'

export interface Birthday {
  id: string
  household_id: string
  person_name: string
  birth_month: number
  birth_day: number
  birth_year: number | null
  age: number | null
  created_by: string
  created_at: string
  updated_at: string
}

export interface BirthdayCreate {
  person_name: string
  birth_month: number
  birth_day: number
  birth_year?: number | null
}

export interface BirthdayUpdate {
  person_name?: string
  birth_month?: number
  birth_day?: number
  birth_year?: number | null
}

export function useBirthdays(householdId: string) {
  return useQuery({
    queryKey: ['birthdays', householdId],
    queryFn: () => apiFetch<Birthday[]>(`/households/${householdId}/birthdays`),
    enabled: !!householdId && hasToken(),
  })
}

export function useCreateBirthday(householdId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (birthday: BirthdayCreate) =>
      apiFetch<Birthday>(`/households/${householdId}/birthdays`, {
        method: 'POST',
        body: JSON.stringify(birthday),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['birthdays', householdId] }),
  })
}

export function useUpdateBirthday(householdId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ birthdayId, ...update }: BirthdayUpdate & { birthdayId: string }) =>
      apiFetch<Birthday>(`/households/${householdId}/birthdays/${birthdayId}`, {
        method: 'PATCH',
        body: JSON.stringify(update),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['birthdays', householdId] }),
  })
}

export function useDeleteBirthday(householdId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (birthdayId: string) =>
      apiFetch<void>(`/households/${householdId}/birthdays/${birthdayId}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['birthdays', householdId] }),
  })
}
```

**Step 3: Commit**

```bash
git add frontend/src/styles/index.css frontend/src/api/birthdays.ts
git commit -m "feat(birthdays): add theme color token and React Query API hooks"
```

---

### Task 9: Shared Birthday Form + Create/Edit Sheets

**Files:**
- Create: `frontend/src/components/birthdays/birthday-form.tsx`
- Create: `frontend/src/components/birthdays/create-birthday-sheet.tsx`
- Create: `frontend/src/components/birthdays/edit-birthday-sheet.tsx`

**Step 1: Create shared birthday form component**

Extracted to avoid duplicating MONTHS, select markup, and validation between create and edit sheets (Finding #19).

Create `frontend/src/components/birthdays/birthday-form.tsx`:

```typescript
import { Input } from '@/components/ui'
import { useId } from 'react'

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

const MAX_DAYS: Record<number, number> = {
  1: 31, 2: 29, 3: 31, 4: 30, 5: 31, 6: 30,
  7: 31, 8: 31, 9: 30, 10: 31, 11: 30, 12: 31,
}

interface BirthdayFormFieldsProps {
  personName: string
  setPersonName: (v: string) => void
  birthMonth: number
  setBirthMonth: (v: number) => void
  birthDay: number
  setBirthDay: (v: number) => void
  birthYearStr: string
  setBirthYearStr: (v: string) => void
  yearError: string | null
  nameRef?: React.Ref<HTMLInputElement>
}

export function BirthdayFormFields({
  personName, setPersonName,
  birthMonth, setBirthMonth,
  birthDay, setBirthDay,
  birthYearStr, setBirthYearStr,
  yearError,
  nameRef,
}: BirthdayFormFieldsProps) {
  const monthId = useId()
  const dayId = useId()

  const handleMonthChange = (m: number) => {
    setBirthMonth(m)
    // Clamp day to max for the new month
    if (birthDay > MAX_DAYS[m]) setBirthDay(MAX_DAYS[m])
  }

  return (
    <>
      <Input
        ref={nameRef}
        label="Name"
        value={personName}
        onChange={(e) => setPersonName(e.target.value)}
        placeholder="e.g. Grandma, Uncle Bob"
      />

      <div className="flex gap-3">
        <div className="flex-1">
          <label htmlFor={monthId} className="text-sm font-medium text-text-muted mb-1.5 block">Month</label>
          <select
            id={monthId}
            value={birthMonth}
            onChange={(e) => handleMonthChange(Number(e.target.value))}
            className="w-full h-12 px-3 rounded-[var(--radius-input)] border-2 border-text/10 bg-surface text-text text-base focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/30 transition-all"
          >
            {MONTHS.map((m, i) => (
              <option key={i + 1} value={i + 1}>{m}</option>
            ))}
          </select>
        </div>
        <div className="w-[112px]">
          <label htmlFor={dayId} className="text-sm font-medium text-text-muted mb-1.5 block">Day</label>
          <select
            id={dayId}
            value={birthDay}
            onChange={(e) => setBirthDay(Number(e.target.value))}
            className="w-full h-12 px-3 rounded-[var(--radius-input)] border-2 border-text/10 bg-surface text-text text-base focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/30 transition-all"
          >
            {Array.from({ length: MAX_DAYS[birthMonth] }, (_, i) => i + 1).map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </div>
      </div>

      <Input
        label="Year of birth (optional)"
        type="number"
        value={birthYearStr}
        onChange={(e) => setBirthYearStr(e.target.value)}
        placeholder="e.g. 1985"
        error={yearError ?? undefined}
      />
    </>
  )
}
```

**Key review findings addressed:**
- Both selects (not select + number input) for consistent mobile UX (Finding #15)
- Day options dynamically clamped based on selected month
- `htmlFor` + `id` on both labels for screen reader accessibility (Finding #12)
- Focus ring bumped to `/30` for visibility (Finding #12)
- `yearError` displayed via Input's `error` prop (Finding #11)
- Wider day select (`w-[112px]` instead of `w-20`)

**Step 2: Create the create-birthday-sheet**

Create `frontend/src/components/birthdays/create-birthday-sheet.tsx`:

```typescript
import { motion, AnimatePresence } from 'framer-motion'
import { useRef, useState } from 'react'
import { Button } from '@/components/ui'
import type { BirthdayCreate } from '@/api/birthdays'
import { BirthdayFormFields } from './birthday-form'
import { useScrollLock } from '@/utils/use-scroll-lock'

interface CreateBirthdaySheetProps {
  open: boolean
  onClose: () => void
  onSubmit: (birthday: BirthdayCreate) => void
  isPending: boolean
}

export function CreateBirthdaySheet({ open, onClose, onSubmit, isPending }: CreateBirthdaySheetProps) {
  const nameRef = useRef<HTMLInputElement>(null)
  const [personName, setPersonName] = useState('')
  const [birthMonth, setBirthMonth] = useState(1)
  const [birthDay, setBirthDay] = useState(1)
  const [birthYearStr, setBirthYearStr] = useState('')
  const [yearError, setYearError] = useState<string | null>(null)

  useScrollLock(open)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!personName.trim()) return
    const birthYear = birthYearStr.trim() ? parseInt(birthYearStr.trim(), 10) : null
    if (birthYear !== null && (isNaN(birthYear) || birthYear < 1900 || birthYear > new Date().getFullYear())) {
      setYearError(`Enter a year between 1900 and ${new Date().getFullYear()}`)
      return
    }
    setYearError(null)
    onSubmit({
      person_name: personName.trim(),
      birth_month: birthMonth,
      birth_day: birthDay,
      birth_year: birthYear,
    })
    setPersonName('')
    setBirthMonth(1)
    setBirthDay(1)
    setBirthYearStr('')
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
            onAnimationComplete={(def: { y?: string | number }) => {
              if (def.y === 0) nameRef.current?.focus()
            }}
            className="fixed bottom-0 left-0 right-0 bg-surface rounded-t-3xl p-6 pb-[env(safe-area-inset-bottom)] z-50 max-w-lg mx-auto max-h-[85vh] overflow-y-auto"
          >
            <div className="w-12 h-1.5 bg-text/10 rounded-full mx-auto mb-6" />
            <h2 className="text-xl font-bold text-text mb-4">Add birthday</h2>

            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <BirthdayFormFields
                personName={personName}
                setPersonName={setPersonName}
                birthMonth={birthMonth}
                setBirthMonth={setBirthMonth}
                birthDay={birthDay}
                setBirthDay={setBirthDay}
                birthYearStr={birthYearStr}
                setBirthYearStr={setBirthYearStr}
                yearError={yearError}
                nameRef={nameRef}
              />

              <Button type="submit" disabled={isPending || !personName.trim()}>
                {isPending ? 'Adding...' : 'Add birthday'}
              </Button>
            </form>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
```

**Step 3: Create the edit-birthday-sheet**

Create `frontend/src/components/birthdays/edit-birthday-sheet.tsx`:

```typescript
import { motion, AnimatePresence } from 'framer-motion'
import { useState, useEffect } from 'react'
import { Button } from '@/components/ui'
import type { Birthday, BirthdayUpdate } from '@/api/birthdays'
import { BirthdayFormFields } from './birthday-form'
import { useScrollLock } from '@/utils/use-scroll-lock'

interface EditBirthdaySheetProps {
  birthday: Birthday | null
  open: boolean
  onClose: () => void
  onSubmit: (update: BirthdayUpdate & { birthdayId: string }) => void
  onDelete: (birthdayId: string) => void
  isPending: boolean
}

export function EditBirthdaySheet({ birthday, open, onClose, onSubmit, onDelete, isPending }: EditBirthdaySheetProps) {
  const [personName, setPersonName] = useState('')
  const [birthMonth, setBirthMonth] = useState(1)
  const [birthDay, setBirthDay] = useState(1)
  const [birthYearStr, setBirthYearStr] = useState('')
  const [yearError, setYearError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useScrollLock(open)

  // Reset form when a different birthday is opened, or when sheet closes
  useEffect(() => {
    if (!open) {
      setConfirmDelete(false)
      return
    }
    if (!birthday) return
    setPersonName(birthday.person_name)
    setBirthMonth(birthday.birth_month)
    setBirthDay(birthday.birth_day)
    setBirthYearStr(birthday.birth_year?.toString() ?? '')
    setYearError(null)
    setConfirmDelete(false)
  }, [open, birthday?.id])

  if (!birthday) return null

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault()
    if (!birthday) return
    const birthYear = birthYearStr.trim() ? parseInt(birthYearStr.trim(), 10) : null
    if (birthYear !== null && (isNaN(birthYear) || birthYear < 1900 || birthYear > new Date().getFullYear())) {
      setYearError(`Enter a year between 1900 and ${new Date().getFullYear()}`)
      return
    }
    setYearError(null)
    onSubmit({
      birthdayId: birthday.id,
      person_name: personName.trim(),
      birth_month: birthMonth,
      birth_day: birthDay,
      birth_year: birthYear,
    })
  }

  function handleDeleteClick(): void {
    if (!birthday) return
    if (confirmDelete) {
      onDelete(birthday.id)
    } else {
      setConfirmDelete(true)
    }
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
            className="fixed bottom-0 left-0 right-0 bg-surface rounded-t-3xl p-6 pb-[env(safe-area-inset-bottom)] z-50 max-w-lg mx-auto max-h-[85vh] overflow-y-auto"
          >
            <div className="w-12 h-1.5 bg-text/10 rounded-full mx-auto mb-6" />
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-text">Edit birthday</h2>
              <button
                type="button"
                onClick={onClose}
                className="p-1.5 -mr-1.5 rounded-full text-text-muted hover:bg-text/5 transition-colors"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <BirthdayFormFields
                personName={personName}
                setPersonName={setPersonName}
                birthMonth={birthMonth}
                setBirthMonth={setBirthMonth}
                birthDay={birthDay}
                setBirthDay={setBirthDay}
                birthYearStr={birthYearStr}
                setBirthYearStr={setBirthYearStr}
                yearError={yearError}
              />

              <div className="flex gap-3">
                <Button type="submit" disabled={isPending || !personName.trim()} className="flex-1">
                  {isPending ? 'Saving...' : 'Save changes'}
                </Button>
                <Button
                  type="button"
                  variant={confirmDelete ? 'danger' : 'ghost'}
                  onClick={handleDeleteClick}
                  disabled={isPending}
                >
                  {confirmDelete ? 'Confirm' : 'Delete'}
                </Button>
              </div>
            </form>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
```

**Key review findings addressed:**
- `useEffect` depends on `[open, birthday?.id]` — resets on different birthday, resets `confirmDelete` on close (Findings #8, #13)
- Year validation shows inline error via `yearError` state (Finding #11)
- Shared `BirthdayFormFields` eliminates duplication (Finding #19)

**Step 4: Commit**

```bash
git add frontend/src/components/birthdays/
git commit -m "feat(birthdays): add shared form, create and edit sheet components"
```

---

### Task 10: Birthday Card Component

**Files:**
- Create: `frontend/src/components/birthdays/birthday-card.tsx`

**Step 1: Create the birthday card**

Create `frontend/src/components/birthdays/birthday-card.tsx`:

```typescript
import { Card } from '@/components/ui'
import type { Birthday } from '@/api/birthdays'

interface BirthdayCardProps {
  birthday: Birthday
  onClick: () => void
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

export function BirthdayCard({ birthday, onClick }: BirthdayCardProps) {
  const dateLabel = `${MONTH_NAMES[birthday.birth_month - 1]} ${birthday.birth_day}`

  // age from API is current age. On the birthday itself, it's the age they just turned.
  // "Turns N" = the age they'll turn on their next birthday = age + 1.
  // On the birthday day itself, show "Turns {age} today!" (the age they just turned).
  const today = new Date()
  const isBirthdayToday = today.getMonth() + 1 === birthday.birth_month && today.getDate() === birthday.birth_day
  const turnsLabel = birthday.age !== null
    ? (isBirthdayToday ? `Turns ${birthday.age} today!` : `Turns ${birthday.age + 1}`)
    : null

  return (
    <Card
      interactive
      onClick={onClick}
      className="relative overflow-hidden border-l-4"
      style={{ borderLeftColor: 'var(--color-birthday)' }}
    >
      <div className="flex items-center gap-3">
        <span className="text-2xl shrink-0">{'\u{1F382}'}</span>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-text truncate">{birthday.person_name}</p>
          <p className="text-sm text-text-muted mt-0.5">{dateLabel}</p>
          {turnsLabel && (
            <span
              className="inline-block mt-1.5 px-2 py-0.5 rounded-full text-xs font-medium"
              style={{ backgroundColor: 'color-mix(in srgb, var(--color-birthday) 15%, transparent)', color: 'var(--color-birthday)' }}
            >
              {turnsLabel}
            </span>
          )}
        </div>
        {birthday.age !== null && (
          <span
            className="shrink-0 px-2.5 py-1 rounded-full text-xs font-bold"
            style={{ backgroundColor: 'color-mix(in srgb, var(--color-birthday) 15%, transparent)', color: 'var(--color-birthday)' }}
          >
            {birthday.age}
          </span>
        )}
      </div>
    </Card>
  )
}
```

**Key review findings addressed:**
- Uses `var(--color-birthday)` theme token, not hardcoded `pink-400` (Finding #9)
- "Turns N" displayed as badge pill matching recurrence badge style (Finding #17)
- Right-side pill shows computed age, not raw birth year (Finding #16)
- `age` / `age + 1` logic documented with comment explaining the contract (Architect finding #4)

**Step 2: Commit**

```bash
git add frontend/src/components/birthdays/birthday-card.tsx
git commit -m "feat(birthdays): add birthday card component with themed colors"
```

---

### Task 11: Birthdays List Page

**Files:**
- Create: `frontend/src/routes/birthdays.tsx` (layout route)
- Create: `frontend/src/routes/birthdays.index.tsx` (list page)

**Step 1: Create layout route**

Create `frontend/src/routes/birthdays.tsx`:

```typescript
import { createFileRoute, Outlet } from '@tanstack/react-router'

export const Route = createFileRoute('/birthdays')({
  component: () => <Outlet />,
})
```

**Step 2: Create the list page**

Create `frontend/src/routes/birthdays.index.tsx`:

```typescript
import { createFileRoute, Navigate } from '@tanstack/react-router'
import { useAuth } from 'react-oidc-context'
import { useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useHouseholds } from '@/api/households'
import { useBirthdays, useCreateBirthday, useUpdateBirthday, useDeleteBirthday } from '@/api/birthdays'
import type { Birthday } from '@/api/birthdays'
import { BirthdayCard } from '@/components/birthdays/birthday-card'
import { CreateBirthdaySheet } from '@/components/birthdays/create-birthday-sheet'
import { EditBirthdaySheet } from '@/components/birthdays/edit-birthday-sheet'
import { Fab, Card } from '@/components/ui'

export const Route = createFileRoute('/birthdays/')({
  component: BirthdaysPage,
})

function BirthdaysPage() {
  const auth = useAuth()
  const { data: households } = useHouseholds()
  const [showCreate, setShowCreate] = useState(false)
  const [editBirthday, setEditBirthday] = useState<Birthday | null>(null)

  if (!auth.isAuthenticated) return <Navigate to="/login" />
  if (!households?.length) return <Navigate to="/onboarding" />

  const householdId = households[0].id

  return (
    <BirthdaysContent
      householdId={householdId}
      showCreate={showCreate}
      setShowCreate={setShowCreate}
      editBirthday={editBirthday}
      setEditBirthday={setEditBirthday}
    />
  )
}

/** Exact days until next occurrence of this birthday. */
function daysUntilBirthday(bMonth: number, bDay: number): number {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const year = today.getFullYear()
  let next = new Date(year, bMonth - 1, bDay)
  next.setHours(0, 0, 0, 0)
  if (next < today) next = new Date(year + 1, bMonth - 1, bDay)
  return Math.round((next.getTime() - today.getTime()) / 86_400_000)
}

function sortByUpcoming(birthdays: Birthday[]): Birthday[] {
  return [...birthdays].sort(
    (a, b) =>
      daysUntilBirthday(a.birth_month, a.birth_day) -
      daysUntilBirthday(b.birth_month, b.birth_day),
  )
}

function BirthdaysContent({
  householdId,
  showCreate,
  setShowCreate,
  editBirthday,
  setEditBirthday,
}: {
  householdId: string
  showCreate: boolean
  setShowCreate: (v: boolean) => void
  editBirthday: Birthday | null
  setEditBirthday: (b: Birthday | null) => void
}) {
  const { data: birthdays, isLoading } = useBirthdays(householdId)
  const createMutation = useCreateBirthday(householdId)
  const updateMutation = useUpdateBirthday(householdId)
  const deleteMutation = useDeleteBirthday(householdId)

  const sorted = useMemo(
    () => (birthdays ? sortByUpcoming(birthdays) : []),
    [birthdays],
  )

  return (
    <div className="pb-4">
      <h1 className="text-2xl font-extrabold text-text mt-2 mb-4">Birthdays</h1>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-20 bg-surface rounded-[var(--radius-card)] animate-pulse" />
          ))}
        </div>
      ) : !sorted.length ? (
        <Card className="text-center py-8">
          <p className="text-4xl mb-3">{'\u{1F382}'}</p>
          <p className="font-semibold text-text">No birthdays yet</p>
          <p className="text-sm text-text-muted mt-1">Tap + to add your first birthday.</p>
        </Card>
      ) : (
        <motion.div className="space-y-3">
          <AnimatePresence>
            {sorted.map((birthday, i) => (
              <motion.div
                key={birthday.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ delay: i * 0.05 }}
              >
                <BirthdayCard
                  birthday={birthday}
                  onClick={() => setEditBirthday(birthday)}
                />
              </motion.div>
            ))}
          </AnimatePresence>
        </motion.div>
      )}

      <Fab pulse={!sorted.length} onClick={() => setShowCreate(true)}>
        +
      </Fab>

      <CreateBirthdaySheet
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onSubmit={async (birthday) => {
          await createMutation.mutateAsync(birthday)
          setShowCreate(false)
        }}
        isPending={createMutation.isPending}
      />

      <EditBirthdaySheet
        birthday={editBirthday}
        open={editBirthday !== null}
        onClose={() => setEditBirthday(null)}
        onSubmit={async (update) => {
          await updateMutation.mutateAsync(update)
          setEditBirthday(null)
        }}
        onDelete={async (birthdayId) => {
          await deleteMutation.mutateAsync(birthdayId)
          setEditBirthday(null)
        }}
        isPending={updateMutation.isPending || deleteMutation.isPending}
      />
    </div>
  )
}
```

**Key review findings addressed:**
- `daysUntilBirthday` uses real `Date` arithmetic, not `month * 31 + day` approximation (Finding #6)
- Exit animation uses `scale: 0.95` instead of `x: -200` to avoid glitchy exits on non-delete actions (Finding #18)
- Sort wrapped in `useMemo`

**Step 3: Commit**

```bash
git add frontend/src/routes/birthdays.tsx frontend/src/routes/birthdays.index.tsx
git commit -m "feat(birthdays): add birthdays list page with correct upcoming sort"
```

---

### Task 12: More Tab + Bottom Nav Integration

**Files:**
- Modify: `frontend/src/routes/more.tsx` (add Birthdays item + icon)
- Modify: `frontend/src/components/layout/bottom-nav.tsx` (add `/birthdays` to MORE_PATHS)

**Step 1: Add Birthdays to More page**

In `frontend/src/routes/more.tsx`:

Update the `items` array (lines 9-13) to insert Birthdays between Documents and Settings:

```typescript
const items = [
  { to: '/cards' as const, label: 'Loyalty Cards', description: 'Store and scan your loyalty cards', icon: CardIcon },
  { to: '/documents' as const, label: 'Documents', description: 'Warranties, receipts, and manuals', icon: DocIcon },
  { to: '/birthdays' as const, label: 'Birthdays', description: 'Never forget a birthday', icon: BirthdayIcon },
  { to: '/settings' as const, label: 'Settings', description: 'Profile, household, and preferences', icon: GearIcon },
]
```

Add `BirthdayIcon` function after the `GearIcon` function (after line 61):

```typescript
function BirthdayIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-primary shrink-0">
      <path d="M20 21H4v-4a2 2 0 012-2h12a2 2 0 012 2v4z" />
      <path d="M2 21h20" />
      <path d="M6 15v-2a2 2 0 012-2h8a2 2 0 012 2v2" />
      <path d="M12 7V4" /><path d="M8 7V5" /><path d="M16 7V5" />
      <circle cx="12" cy="3" r="1" /><circle cx="8" cy="4" r="1" /><circle cx="16" cy="4" r="1" />
      <path d="M6 11h12" />
    </svg>
  )
}
```

**Step 2: Add /birthdays to MORE_PATHS**

In `frontend/src/components/layout/bottom-nav.tsx` line 4:

```typescript
const MORE_PATHS = ['/cards', '/settings', '/documents', '/birthdays']
```

**Step 3: Commit**

```bash
git add frontend/src/routes/more.tsx frontend/src/components/layout/bottom-nav.tsx
git commit -m "feat(birthdays): add to More tab and bottom nav paths"
```

---

### Task 13: Calendar Integration

**Files:**
- Create: `frontend/src/components/calendar/birthday-card.tsx`
- Modify: `frontend/src/routes/calendar.tsx`

**Step 1: Create the calendar birthday card**

Create `frontend/src/components/calendar/birthday-card.tsx`:

```typescript
import { Card } from '@/components/ui'
import type { Birthday } from '@/api/birthdays'

interface CalendarBirthdayCardProps {
  birthday: Birthday
  onClick: () => void
}

export function CalendarBirthdayCard({ birthday, onClick }: CalendarBirthdayCardProps) {
  const today = new Date()
  const isToday = today.getMonth() + 1 === birthday.birth_month && today.getDate() === birthday.birth_day

  // On the birthday day, age is the age they just turned.
  // On other days (viewing calendar in future/past), show age + 1 for "next birthday."
  let ageLabel = ''
  if (birthday.age !== null) {
    ageLabel = isToday ? ` (turns ${birthday.age})` : ` (turns ${birthday.age + 1})`
  }

  return (
    <Card
      interactive
      onClick={onClick}
      className="relative overflow-hidden border-l-4"
      style={{ borderLeftColor: 'var(--color-birthday)' }}
    >
      <div className="flex items-center gap-3">
        <span className="text-xl shrink-0">{'\u{1F382}'}</span>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-text">{birthday.person_name}'s Birthday{ageLabel}</p>
          <p className="text-sm text-text-muted mt-0.5">All day</p>
        </div>
      </div>
    </Card>
  )
}
```

**Step 2: Integrate birthdays into the calendar page**

In `frontend/src/routes/calendar.tsx`:

Add imports (after existing imports, around line 17):
```typescript
import { useBirthdays, useUpdateBirthday, useDeleteBirthday } from '@/api/birthdays'
import type { Birthday } from '@/api/birthdays'
import { CalendarBirthdayCard } from '@/components/calendar/birthday-card'
import { EditBirthdaySheet } from '@/components/birthdays/edit-birthday-sheet'
```

In `CalendarContent` function, after existing query hooks (around line 78), add:
```typescript
  const { data: allBirthdays = [] } = useBirthdays(householdId)
  const updateBirthdayMutation = useUpdateBirthday(householdId)
  const deleteBirthdayMutation = useDeleteBirthday(householdId)
  const [editBirthday, setEditBirthday] = useState<Birthday | null>(null)
```

Add `Birthday` to the imports from react if needed (useState should already be imported).

Update the `CalendarOccurrence` type (around line 111-113) to include birthday:
```typescript
  type CalendarOccurrence =
    | { type: 'native'; occurrence: typeof dayOccurrences[0] }
    | { type: 'external'; occurrence: ExternalEventOccurrence; occurrenceStart: Date; occurrenceEnd: Date }
    | { type: 'birthday'; birthday: Birthday }
```

In `mergedDayOccurrences` useMemo (around line 115-147), after the `external` array, add birthday items and update the merge + sort:

```typescript
    const birthdayItems: CalendarOccurrence[] = allBirthdays
      .filter((b) => {
        const selMonth = selectedDate.getMonth() + 1
        const selDay = selectedDate.getDate()
        return b.birth_month === selMonth && b.birth_day === selDay
      })
      .map((b) => ({ type: 'birthday' as const, birthday: b }))

    return [...native, ...external, ...birthdayItems].sort((a, b) => {
      const aAllDay = a.type === 'birthday' ? 0 : a.type === 'native' ? (a.occurrence.event.all_day ? 0 : 1) : (a.occurrence.all_day ? 0 : 1)
      const bAllDay = b.type === 'birthday' ? 0 : b.type === 'native' ? (b.occurrence.event.all_day ? 0 : 1) : (b.occurrence.all_day ? 0 : 1)
      if (aAllDay !== bAllDay) return aAllDay - bAllDay
      const aStart = a.type === 'native' ? a.occurrence.occurrenceStart : a.type === 'external' ? a.occurrenceStart : new Date(0)
      const bStart = b.type === 'native' ? b.occurrence.occurrenceStart : b.type === 'external' ? b.occurrenceStart : new Date(0)
      return aStart.getTime() - bStart.getTime()
    })
```

Add `allBirthdays` to the dependency array of `mergedDayOccurrences`.

Update `allOccurrences` memo (around line 149-156) to include birthday dots on the week strip:
```typescript
  const allOccurrences = useMemo(() => {
    const externalOccs = externalEvents.map((e) => ({
      event: { id: e.id, all_day: e.all_day } as any,
      occurrenceStart: new Date(e.start_time),
      occurrenceEnd: new Date(e.end_time),
    }))
    const birthdayOccs: typeof externalOccs = []
    for (const b of allBirthdays) {
      for (let i = 0; i < 7; i++) {
        const d = new Date(weekStart)
        d.setDate(d.getDate() + i)
        if (d.getMonth() + 1 === b.birth_month && d.getDate() === b.birth_day) {
          birthdayOccs.push({
            event: { id: `birthday-${b.id}`, all_day: true } as any,
            occurrenceStart: d,
            occurrenceEnd: d,
          })
        }
      }
    }
    return [...occurrences, ...externalOccs, ...birthdayOccs]
  }, [occurrences, externalEvents, allBirthdays, weekStart])
```

In the JSX render (around line 216-241), update the key and add a case for birthday type:
```typescript
              <motion.div
                key={item.type === 'native'
                  ? `${item.occurrence.event.id}-${item.occurrence.occurrenceStart.toISOString()}`
                  : item.type === 'birthday'
                  ? `birthday-${item.birthday.id}`
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
                ) : item.type === 'birthday' ? (
                  <CalendarBirthdayCard
                    birthday={item.birthday}
                    onClick={() => setEditBirthday(item.birthday)}
                  />
                ) : (
                  <ExternalEventCard
                    occurrence={item.occurrence}
                    occurrenceStart={item.occurrenceStart}
                    occurrenceEnd={item.occurrenceEnd}
                  />
                )}
              </motion.div>
```

Add the EditBirthdaySheet at the bottom of the JSX (after the existing EditEventSheet, around line 276):
```typescript
      <EditBirthdaySheet
        birthday={editBirthday}
        open={editBirthday !== null}
        onClose={() => setEditBirthday(null)}
        onSubmit={async (update) => {
          await updateBirthdayMutation.mutateAsync(update)
          setEditBirthday(null)
        }}
        onDelete={async (birthdayId) => {
          await deleteBirthdayMutation.mutateAsync(birthdayId)
          setEditBirthday(null)
        }}
        isPending={updateBirthdayMutation.isPending || deleteBirthdayMutation.isPending}
      />
```

**Step 3: Commit**

```bash
git add frontend/src/components/calendar/birthday-card.tsx frontend/src/routes/calendar.tsx
git commit -m "feat(birthdays): integrate birthdays into calendar view"
```

---

### Task 14: Update Design Doc + CLAUDE.md

**Files:**
- Modify: `docs/plans/2026-03-22-birthdays-design.md`
- Modify: `.claude/CLAUDE.md`

**Step 1: Update design doc**

Remove the `start`/`end` query param mention from the design doc's API section. The GET endpoint simply returns all birthdays for the household.

**Step 2: Update CLAUDE.md**

Add birthdays to:
- Project structure (models, schemas, routers, services, frontend routes/components)
- API endpoints section
- Database tables list

**Step 3: Commit**

```bash
git add docs/plans/2026-03-22-birthdays-design.md .claude/CLAUDE.md
git commit -m "docs: update design doc and CLAUDE.md for birthdays feature"
```

---

### Task 15: Verify Everything Works

**Step 1: Run backend tests**

```bash
cd backend && pytest tests/ -v
```

Expected: All tests pass (including new birthday tests).

**Step 2: Start the dev environment and manually test**

```bash
docker compose up
```

Test checklist:
- [ ] Navigate to More tab -> see "Birthdays" entry with cake icon
- [ ] Tap Birthdays -> see empty state
- [ ] Tap + -> create sheet opens, both month and day are selects
- [ ] Create a birthday with name, month, day (no year) -> appears in list
- [ ] Create a birthday with birth year -> shows age pill and "Turns N" badge
- [ ] Create a Feb 29 birthday without year -> accepted
- [ ] Create a Feb 29 birthday with non-leap year (e.g. 1990) -> rejected (422)
- [ ] Verify list is sorted by upcoming
- [ ] Tap a birthday -> edit sheet opens, modify name, save
- [ ] Clear birth year in edit -> age becomes null, year pill disappears
- [ ] Delete a birthday via edit sheet (tap Delete, then Confirm)
- [ ] Navigate to Calendar -> on a day with a birthday, see birthday card with cake icon and themed pink border
- [ ] Tap birthday on calendar -> edit sheet opens
- [ ] Verify week strip shows dot on birthday day
- [ ] Check ICS feed URL -> birthdays appear as yearly-recurring VEVENTs with DTEND

**Step 3: Final commit if any fixes needed**

```bash
git add -A && git commit -m "fix(birthdays): address integration issues"
```

---

## Appendix: Known Limitations

1. **Timezone drift in age computation** — Server computes `age` in UTC; client checks `isBirthdayToday` in local time. Around midnight UTC, users in far-offset timezones may see a briefly wrong "Turns N today!" label. Accepted as a known limitation. A future improvement could compute age client-side only.

2. **Feb 29 birthdays in the calendar** — `new Date(year, 1, 29)` in non-leap years rolls to March 1 in JavaScript. On the calendar, a Feb 29 birthday will appear on March 1 in non-leap years. This matches how most calendar apps handle it.

3. **Week strip `as any` cast** — Birthday occurrences are cast to `any` to satisfy the `WeekStrip` component's type expectations. A proper fix would extend the `WeekStrip` props to accept a discriminated union, but this is low-risk for now.
