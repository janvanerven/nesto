# Birthdays Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add birthday tracking shared per household — CRUD management page under More tab, display on calendar as all-day events, and include in ICS feed.

**Architecture:** Standalone `birthdays` table with `person_name`, `birth_month`, `birth_day`, `birth_year` (nullable). Backend CRUD service + router following the loyalty_card pattern. Frontend list page under `/birthdays`, birthday cards on the calendar view, and edit sheet accessible from both the list page and calendar. ICS feed extended with yearly-recurring birthday VEVENTs.

**Tech Stack:** FastAPI, SQLAlchemy 2.0 async, Alembic, React 19, TanStack Router/Query, Framer Motion, Tailwind CSS v4, icalendar

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
from datetime import datetime

from pydantic import BaseModel, Field, model_validator


class BirthdayCreate(BaseModel):
    person_name: str = Field(min_length=1, max_length=200)
    birth_month: int = Field(ge=1, le=12)
    birth_day: int = Field(ge=1, le=31)
    birth_year: int | None = Field(default=None, ge=1900, le=2100)

    @model_validator(mode="after")
    def validate_day_for_month(self) -> "BirthdayCreate":
        max_days = {1: 31, 2: 29, 3: 31, 4: 30, 5: 31, 6: 30,
                    7: 31, 8: 31, 9: 30, 10: 31, 11: 30, 12: 31}
        if self.birth_day > max_days.get(self.birth_month, 31):
            raise ValueError(f"Day {self.birth_day} is invalid for month {self.birth_month}")
        return self


class BirthdayUpdate(BaseModel):
    person_name: str | None = Field(default=None, min_length=1, max_length=200)
    birth_month: int | None = Field(default=None, ge=1, le=12)
    birth_day: int | None = Field(default=None, ge=1, le=31)
    birth_year: int | None = Field(default=None, ge=1900, le=2100)


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

Note: `age` is a computed field — will be set by the service layer before returning.

**Step 2: Commit**

```bash
git add backend/app/schemas/birthday.py
git commit -m "feat(birthdays): add Pydantic schemas"
```

---

### Task 4: Backend Service

**Files:**
- Create: `backend/app/services/birthday_service.py`

**Step 1: Create the birthday service**

Create `backend/app/services/birthday_service.py`:

```python
import uuid
from datetime import date

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.birthday import Birthday
from app.schemas.birthday import BirthdayCreate, BirthdayResponse, BirthdayUpdate

_UPDATABLE_FIELDS = {"person_name", "birth_month", "birth_day", "birth_year"}


def _compute_age(birth_year: int | None, birth_month: int, birth_day: int) -> int | None:
    if birth_year is None:
        return None
    today = date.today()
    age = today.year - birth_year
    if (today.month, today.day) < (birth_month, birth_day):
        age -= 1
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

**Step 2: Commit**

```bash
git add backend/app/services/birthday_service.py
git commit -m "feat(birthdays): add birthday service with age computation"
```

---

### Task 5: Backend Router

**Files:**
- Create: `backend/app/routers/birthdays.py`
- Modify: `backend/app/main.py` (line 12 import, after line 151 registration)

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

    # Build summary with age if birth year known
    if birthday.birth_year:
        today = date.today()
        next_birthday_year = today.year
        if (today.month, today.day) > (birthday.birth_month, birthday.birth_day):
            next_birthday_year += 1
        turning = next_birthday_year - birthday.birth_year
        vevent.add("summary", f"\U0001f382 {birthday.person_name}'s Birthday (turns {turning})")
    else:
        vevent.add("summary", f"\U0001f382 {birthday.person_name}'s Birthday")

    # Use birth year if known, else 1900 as reference
    ref_year = birthday.birth_year or 1900
    vevent.add("dtstart", date(ref_year, birthday.birth_month, birthday.birth_day))
    vevent.add("rrule", {"freq": "YEARLY"})

    return vevent
```

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
git commit -m "feat(birthdays): add birthday VEVENTs to ICS feed"
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
async def test_birthday_invalid_day(client: AsyncClient, auth_headers: dict, household_id: str):
    resp = await client.post(
        f"/api/households/{household_id}/birthdays",
        json={"person_name": "Bad", "birth_month": 2, "birth_day": 30},
        headers=auth_headers,
    )
    assert resp.status_code == 422
```

**Step 2: Check existing test fixtures**

Before running, check `backend/tests/conftest.py` for existing fixtures (`client`, `auth_headers`, `household_id`). The tests use the same fixture pattern as other test files in the project. If these fixtures don't exist or differ, adapt the test to match the project's test setup.

**Step 3: Run tests**

```bash
cd backend && pytest tests/test_birthdays.py -v
```

Expected: All tests pass.

**Step 4: Commit**

```bash
git add backend/tests/test_birthdays.py
git commit -m "test(birthdays): add CRUD and validation tests"
```

---

### Task 8: Frontend API Hooks

**Files:**
- Create: `frontend/src/api/birthdays.ts`

**Step 1: Create the API hooks**

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

**Step 2: Commit**

```bash
git add frontend/src/api/birthdays.ts
git commit -m "feat(birthdays): add React Query API hooks"
```

---

### Task 9: Birthday Card Component + Create/Edit Sheets

**Files:**
- Create: `frontend/src/components/birthdays/birthday-card.tsx`
- Create: `frontend/src/components/birthdays/create-birthday-sheet.tsx`
- Create: `frontend/src/components/birthdays/edit-birthday-sheet.tsx`

**Step 1: Create the birthday card component**

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

  return (
    <Card interactive onClick={onClick} className="relative overflow-hidden border-l-4 border-l-pink-400">
      <div className="flex items-center gap-3">
        <span className="text-2xl shrink-0">{'\u{1F382}'}</span>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-text truncate">{birthday.person_name}</p>
          <p className="text-sm text-text-muted mt-0.5">
            {dateLabel}
            {birthday.age !== null && ` · Turns ${birthday.age + 1}`}
          </p>
        </div>
        {birthday.birth_year && (
          <span className="shrink-0 px-2 py-0.5 rounded-full text-xs font-medium bg-pink-400/10 text-pink-500">
            {birthday.birth_year}
          </span>
        )}
      </div>
    </Card>
  )
}
```

Note: `age` from the API is the current age. "Turns N" on the list shows `age + 1` (the age they'll turn on their next birthday). When the birthday is today, the API already returns the new age, so `age + 1` is still correct for "next birthday" display. However, on the actual birthday day we should show "Turns {age}" instead. Handle this in the component:

```typescript
  // Determine if birthday is today
  const today = new Date()
  const isBirthdayToday = today.getMonth() + 1 === birthday.birth_month && today.getDate() === birthday.birth_day
  const turnsLabel = birthday.age !== null
    ? (isBirthdayToday ? `Turns ${birthday.age} today!` : `Turns ${birthday.age + 1}`)
    : null
```

And use `turnsLabel` in the JSX instead of the inline calculation.

**Step 2: Create the create-birthday-sheet component**

Create `frontend/src/components/birthdays/create-birthday-sheet.tsx`:

```typescript
import { motion, AnimatePresence } from 'framer-motion'
import { useRef, useState } from 'react'
import { Button, Input } from '@/components/ui'
import type { BirthdayCreate } from '@/api/birthdays'
import { useScrollLock } from '@/utils/use-scroll-lock'

interface CreateBirthdaySheetProps {
  open: boolean
  onClose: () => void
  onSubmit: (birthday: BirthdayCreate) => void
  isPending: boolean
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

export function CreateBirthdaySheet({ open, onClose, onSubmit, isPending }: CreateBirthdaySheetProps) {
  const nameRef = useRef<HTMLInputElement>(null)
  const [personName, setPersonName] = useState('')
  const [birthMonth, setBirthMonth] = useState(1)
  const [birthDay, setBirthDay] = useState(1)
  const [birthYearStr, setBirthYearStr] = useState('')

  useScrollLock(open)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!personName.trim()) return
    const birthYear = birthYearStr.trim() ? parseInt(birthYearStr.trim(), 10) : null
    if (birthYear !== null && (isNaN(birthYear) || birthYear < 1900 || birthYear > new Date().getFullYear())) return
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
              <Input
                ref={nameRef}
                label="Name"
                value={personName}
                onChange={(e) => setPersonName(e.target.value)}
                placeholder="e.g. Grandma, Uncle Bob"
              />

              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="text-sm font-medium text-text-muted mb-1.5 block">Month</label>
                  <select
                    value={birthMonth}
                    onChange={(e) => setBirthMonth(Number(e.target.value))}
                    className="w-full h-12 px-3 rounded-[var(--radius-input)] border-2 border-text/10 bg-surface text-text text-base focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all"
                  >
                    {MONTHS.map((m, i) => (
                      <option key={i + 1} value={i + 1}>{m}</option>
                    ))}
                  </select>
                </div>
                <div className="w-20">
                  <Input
                    label="Day"
                    type="number"
                    min={1}
                    max={31}
                    value={birthDay}
                    onChange={(e) => setBirthDay(Number(e.target.value))}
                  />
                </div>
              </div>

              <Input
                label="Year of birth (optional)"
                type="number"
                value={birthYearStr}
                onChange={(e) => setBirthYearStr(e.target.value)}
                placeholder="e.g. 1985"
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

**Step 3: Create the edit-birthday-sheet component**

Create `frontend/src/components/birthdays/edit-birthday-sheet.tsx`:

```typescript
import { motion, AnimatePresence } from 'framer-motion'
import { useState, useEffect } from 'react'
import { Button, Input } from '@/components/ui'
import type { Birthday, BirthdayUpdate } from '@/api/birthdays'
import { useScrollLock } from '@/utils/use-scroll-lock'

interface EditBirthdaySheetProps {
  birthday: Birthday | null
  open: boolean
  onClose: () => void
  onSubmit: (update: BirthdayUpdate & { birthdayId: string }) => void
  onDelete: (birthdayId: string) => void
  isPending: boolean
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

export function EditBirthdaySheet({ birthday, open, onClose, onSubmit, onDelete, isPending }: EditBirthdaySheetProps) {
  const [personName, setPersonName] = useState('')
  const [birthMonth, setBirthMonth] = useState(1)
  const [birthDay, setBirthDay] = useState(1)
  const [birthYearStr, setBirthYearStr] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)

  useScrollLock(open)

  useEffect(() => {
    if (!birthday) return
    setPersonName(birthday.person_name)
    setBirthMonth(birthday.birth_month)
    setBirthDay(birthday.birth_day)
    setBirthYearStr(birthday.birth_year?.toString() ?? '')
    setConfirmDelete(false)
  }, [birthday])

  if (!birthday) return null

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault()
    if (!birthday) return
    const birthYear = birthYearStr.trim() ? parseInt(birthYearStr.trim(), 10) : null
    if (birthYear !== null && (isNaN(birthYear) || birthYear < 1900 || birthYear > new Date().getFullYear())) return
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
              <Input
                label="Name"
                value={personName}
                onChange={(e) => setPersonName(e.target.value)}
                placeholder="e.g. Grandma, Uncle Bob"
              />

              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="text-sm font-medium text-text-muted mb-1.5 block">Month</label>
                  <select
                    value={birthMonth}
                    onChange={(e) => setBirthMonth(Number(e.target.value))}
                    className="w-full h-12 px-3 rounded-[var(--radius-input)] border-2 border-text/10 bg-surface text-text text-base focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all"
                  >
                    {MONTHS.map((m, i) => (
                      <option key={i + 1} value={i + 1}>{m}</option>
                    ))}
                  </select>
                </div>
                <div className="w-20">
                  <Input
                    label="Day"
                    type="number"
                    min={1}
                    max={31}
                    value={birthDay}
                    onChange={(e) => setBirthDay(Number(e.target.value))}
                  />
                </div>
              </div>

              <Input
                label="Year of birth (optional)"
                type="number"
                value={birthYearStr}
                onChange={(e) => setBirthYearStr(e.target.value)}
                placeholder="e.g. 1985"
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

**Step 4: Commit**

```bash
git add frontend/src/components/birthdays/
git commit -m "feat(birthdays): add birthday card, create and edit sheet components"
```

---

### Task 10: Birthdays List Page

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
import { useState } from 'react'
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

function sortByUpcoming(birthdays: Birthday[]): Birthday[] {
  const today = new Date()
  const m = today.getMonth() + 1
  const d = today.getDate()

  return [...birthdays].sort((a, b) => {
    // Days until next occurrence (0 = today, 365 = tomorrow if it just passed)
    const daysA = daysUntil(a.birth_month, a.birth_day, m, d)
    const daysB = daysUntil(b.birth_month, b.birth_day, m, d)
    return daysA - daysB
  })
}

function daysUntil(bMonth: number, bDay: number, todayMonth: number, todayDay: number): number {
  // Approximate using month * 31 + day for ordering
  const bVal = bMonth * 31 + bDay
  const tVal = todayMonth * 31 + todayDay
  return bVal >= tVal ? bVal - tVal : (12 * 31 + bVal) - tVal
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

  const sorted = birthdays ? sortByUpcoming(birthdays) : []

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
                exit={{ opacity: 0, x: -200 }}
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

**Step 3: Commit**

```bash
git add frontend/src/routes/birthdays.tsx frontend/src/routes/birthdays.index.tsx
git commit -m "feat(birthdays): add birthdays list page with upcoming sort"
```

---

### Task 11: More Tab + Bottom Nav Integration

**Files:**
- Modify: `frontend/src/routes/more.tsx` (add Birthdays item + icon)
- Modify: `frontend/src/components/layout/bottom-nav.tsx` (add `/birthdays` to MORE_PATHS)

**Step 1: Add Birthdays to More page**

In `frontend/src/routes/more.tsx`:

Add a new entry to the `items` array (line 9-13). Insert before Settings (so it appears between Documents and Settings):

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
      <path d="M20 21v-2a4 4 0 00-3-3.87" /><path d="M4 21v-2a4 4 0 013-3.87" />
      <circle cx="12" cy="7" r="4" /><path d="M12 3v1" />
      <path d="M8 21v-1a4 4 0 018 0v1" />
    </svg>
  )
}
```

Actually, a cake icon is more fitting. Use this instead:

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

In `frontend/src/components/layout/bottom-nav.tsx` line 4, add `/birthdays`:

```typescript
const MORE_PATHS = ['/cards', '/settings', '/documents', '/birthdays']
```

**Step 3: Commit**

```bash
git add frontend/src/routes/more.tsx frontend/src/components/layout/bottom-nav.tsx
git commit -m "feat(birthdays): add to More tab and bottom nav paths"
```

---

### Task 12: Calendar Integration

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
  const ageLabel = birthday.age !== null ? ` (turns ${birthday.age + 1})` : ''
  const today = new Date()
  const isToday = today.getMonth() + 1 === birthday.birth_month && today.getDate() === birthday.birth_day

  return (
    <Card
      interactive
      onClick={onClick}
      className="relative overflow-hidden border-l-4 border-l-pink-400"
    >
      <div className="flex items-center gap-3">
        <span className="text-xl shrink-0">{'\u{1F382}'}</span>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-text">{birthday.person_name}'s Birthday{isToday && birthday.age !== null ? ` (turns ${birthday.age})` : ageLabel}</p>
          <p className="text-sm text-text-muted mt-0.5">All day</p>
        </div>
      </div>
    </Card>
  )
}
```

**Step 2: Integrate birthdays into the calendar page**

In `frontend/src/routes/calendar.tsx`:

Add imports (after existing imports):
```typescript
import { useBirthdays } from '@/api/birthdays'
import type { Birthday } from '@/api/birthdays'
import { CalendarBirthdayCard } from '@/components/calendar/birthday-card'
import { EditBirthdaySheet } from '@/components/birthdays/edit-birthday-sheet'
import { useUpdateBirthday, useDeleteBirthday } from '@/api/birthdays'
```

In `CalendarContent` function:

After the existing query hooks (around line 78), add:
```typescript
  const { data: allBirthdays = [] } = useBirthdays(householdId)
  const updateBirthdayMutation = useUpdateBirthday(householdId)
  const deleteBirthdayMutation = useDeleteBirthday(householdId)
  const [editBirthday, setEditBirthday] = useState<Birthday | null>(null)
```

Add import for `Birthday` type in the state declaration and add `useState` import if not already present.

Update the `CalendarOccurrence` type (around line 111-113) to include birthday:
```typescript
  type CalendarOccurrence =
    | { type: 'native'; occurrence: typeof dayOccurrences[0] }
    | { type: 'external'; occurrence: ExternalEventOccurrence; occurrenceStart: Date; occurrenceEnd: Date }
    | { type: 'birthday'; birthday: Birthday }
```

In `mergedDayOccurrences` useMemo (around line 115-147):

After the `external` array and before the return, compute and merge birthdays:
```typescript
    const birthdayItems: CalendarOccurrence[] = allBirthdays
      .filter((b) => {
        // Check if this birthday falls on the selected day
        const selMonth = selectedDate.getMonth() + 1
        const selDay = selectedDate.getDate()
        return b.birth_month === selMonth && b.birth_day === selDay
      })
      .map((b) => ({ type: 'birthday' as const, birthday: b }))

    return [...birthdayItems, ...native, ...external].sort((a, b) => {
```

Since birthdays are always "all day" and should appear first, place them at the start of the array (before native and external). The existing sort puts all-day items first, so either approach works. For simplicity, prepend birthday items and update the sort to handle them:

Update the sort comparator to handle the birthday type:
```typescript
    return [...native, ...external, ...birthdayItems].sort((a, b) => {
      const aAllDay = a.type === 'birthday' ? 0 : a.type === 'native' ? (a.occurrence.event.all_day ? 0 : 1) : (a.occurrence.all_day ? 0 : 1)
      const bAllDay = b.type === 'birthday' ? 0 : b.type === 'native' ? (b.occurrence.event.all_day ? 0 : 1) : (b.occurrence.all_day ? 0 : 1)
      if (aAllDay !== bAllDay) return aAllDay - bAllDay
      const aStart = a.type === 'native' ? a.occurrence.occurrenceStart : a.type === 'external' ? a.occurrenceStart : new Date(0)
      const bStart = b.type === 'native' ? b.occurrence.occurrenceStart : b.type === 'external' ? b.occurrenceStart : new Date(0)
      return aStart.getTime() - bStart.getTime()
    })
```

Update the `allOccurrences` memo (around line 149-156) to include birthday occurrences for the week strip dots:
```typescript
  const allOccurrences = useMemo(() => {
    const externalOccs = externalEvents.map((e) => ({
      event: { id: e.id, all_day: e.all_day } as any,
      occurrenceStart: new Date(e.start_time),
      occurrenceEnd: new Date(e.end_time),
    }))
    // Generate occurrences for each birthday for each day in the week
    const birthdayOccs = allBirthdays
      .filter((b) => {
        // Check if this birthday falls within the current week
        for (let i = 0; i < 7; i++) {
          const d = new Date(weekStart)
          d.setDate(d.getDate() + i)
          if (d.getMonth() + 1 === b.birth_month && d.getDate() === b.birth_day) return true
        }
        return false
      })
      .map((b) => {
        const d = new Date(weekStart)
        for (let i = 0; i < 7; i++) {
          const check = new Date(d)
          check.setDate(check.getDate() + i)
          if (check.getMonth() + 1 === b.birth_month && check.getDate() === b.birth_day) {
            return {
              event: { id: `birthday-${b.id}`, all_day: true } as any,
              occurrenceStart: check,
              occurrenceEnd: check,
            }
          }
        }
        return null
      })
      .filter(Boolean)
    return [...occurrences, ...externalOccs, ...birthdayOccs]
  }, [occurrences, externalEvents, allBirthdays, weekStart])
```

In the JSX render (around line 216-241), add a case for birthday type in the map:
```typescript
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
```

Update the key for birthday items in the motion.div:
```typescript
key={item.type === 'native'
  ? `${item.occurrence.event.id}-${item.occurrence.occurrenceStart.toISOString()}`
  : item.type === 'birthday'
  ? `birthday-${item.birthday.id}`
  : `ext-${item.occurrence.id}`
}
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

Also add `Birthday` to the import for useState at line 3 (already imported `useState`).

**Step 3: Commit**

```bash
git add frontend/src/components/calendar/birthday-card.tsx frontend/src/routes/calendar.tsx
git commit -m "feat(birthdays): integrate birthdays into calendar view"
```

---

### Task 13: Verify Everything Works

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
- [ ] Navigate to More tab → see "Birthdays" entry
- [ ] Tap Birthdays → see empty state
- [ ] Tap + → create a birthday with name, month, day (no year)
- [ ] Create another birthday with birth year
- [ ] Verify list shows both, sorted by upcoming
- [ ] Tap a birthday → edit sheet opens, modify name, save
- [ ] Delete a birthday via edit sheet
- [ ] Navigate to Calendar → on a day with a birthday, see the birthday card with cake icon
- [ ] Tap birthday on calendar → edit sheet opens
- [ ] Check ICS feed URL → birthdays appear as yearly-recurring VEVENTs

**Step 3: Final commit if any fixes needed**

```bash
git add -A && git commit -m "fix(birthdays): address integration issues"
```
