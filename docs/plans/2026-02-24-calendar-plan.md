# Calendar Feature Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a shared household calendar with week view, day detail, quick-pick time/duration selectors, and recurring event support.

**Architecture:** Separate `events` table with its own model/schema/service/router mirroring the task pattern. Frontend expands recurring events client-side. Week strip + day detail layout with bottom sheet for create/edit.

**Tech Stack:** FastAPI, SQLAlchemy 2.0 (async), Alembic, React 19, TypeScript, TanStack Query, Framer Motion, Tailwind CSS v4

---

### Task 1: Backend Event Model + Migration

**Files:**
- Create: `backend/app/models/event.py`
- Modify: `backend/app/models/__init__.py`
- Create: Alembic migration (auto-generated)

**Step 1: Create the Event model**

Create `backend/app/models/event.py`:

```python
from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, Integer, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class Event(Base):
    __tablename__ = "events"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    household_id: Mapped[str] = mapped_column(Text, ForeignKey("households.id"), nullable=False)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    start_time: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    end_time: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    assigned_to: Mapped[str | None] = mapped_column(Text, ForeignKey("users.id"), nullable=True)
    created_by: Mapped[str] = mapped_column(Text, ForeignKey("users.id"), nullable=False)
    recurrence_rule: Mapped[str | None] = mapped_column(Text, nullable=True)
    recurrence_interval: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    recurrence_end: Mapped[date | None] = mapped_column(Date, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())
```

**Step 2: Export the model**

Add to `backend/app/models/__init__.py`:

```python
from app.models.event import Event
```

And add `"Event"` to the `__all__` list.

**Step 3: Generate the migration**

Run inside the backend container:

```bash
docker compose exec backend alembic revision --autogenerate -m "add events table"
```

Verify the generated migration creates the `events` table with all columns and FK constraints.

**Step 4: Apply the migration**

```bash
docker compose exec backend alembic upgrade head
```

**Step 5: Commit**

```bash
git add backend/app/models/event.py backend/app/models/__init__.py backend/alembic/versions/
git commit -m "feat: add events table model and migration"
```

---

### Task 2: Backend Event Schemas

**Files:**
- Create: `backend/app/schemas/event.py`

**Step 1: Create the Event schemas**

Create `backend/app/schemas/event.py`:

```python
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field, model_validator


class EventCreate(BaseModel):
    title: str = Field(min_length=1, max_length=500)
    description: str | None = Field(default=None, max_length=5000)
    start_time: datetime
    end_time: datetime
    assigned_to: str | None = None
    recurrence_rule: Literal["daily", "weekly", "monthly", "yearly"] | None = None
    recurrence_interval: int = Field(default=1, ge=1, le=365)
    recurrence_end: date | None = None

    @model_validator(mode="after")
    def validate_times(self):
        if self.end_time <= self.start_time:
            raise ValueError("end_time must be after start_time")
        return self


class EventUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=500)
    description: str | None = Field(default=None, max_length=5000)
    start_time: datetime | None = None
    end_time: datetime | None = None
    assigned_to: str | None = None
    recurrence_rule: Literal["daily", "weekly", "monthly", "yearly"] | None = None
    recurrence_interval: int | None = Field(default=None, ge=1, le=365)
    recurrence_end: date | None = None


class EventResponse(BaseModel):
    id: str
    household_id: str
    title: str
    description: str | None
    start_time: datetime
    end_time: datetime
    assigned_to: str | None
    created_by: str
    recurrence_rule: str | None
    recurrence_interval: int
    recurrence_end: date | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
```

**Step 2: Commit**

```bash
git add backend/app/schemas/event.py
git commit -m "feat: add event Pydantic schemas with validation"
```

---

### Task 3: Backend Event Service

**Files:**
- Create: `backend/app/services/event_service.py`

**Step 1: Create the event service**

Create `backend/app/services/event_service.py`:

```python
import uuid
from datetime import date

from fastapi import HTTPException
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.event import Event
from app.schemas.event import EventCreate, EventUpdate

_UPDATABLE_FIELDS = {
    "title", "description", "start_time", "end_time",
    "assigned_to", "recurrence_rule", "recurrence_interval", "recurrence_end",
}


async def list_events(
    db: AsyncSession,
    household_id: str,
    start: date,
    end: date,
) -> list[Event]:
    """List events that overlap with the given date range.
    For recurring events, returns the base event so the frontend can expand occurrences."""
    query = select(Event).where(
        Event.household_id == household_id,
        # Include non-recurring events in range OR any recurring event that started before range end
        Event.start_time < f"{end}T23:59:59",
    ).where(
        # Non-recurring: end_time >= range start
        # Recurring: recurrence_end is null or >= range start
        Event.household_id == household_id,
    )
    # Simpler approach: fetch all household events that could possibly appear in range
    query = select(Event).where(
        Event.household_id == household_id,
    ).order_by(Event.start_time.asc())
    result = await db.execute(query)
    return list(result.scalars().all())


async def create_event(db: AsyncSession, household_id: str, user_id: str, data: EventCreate) -> Event:
    event = Event(
        id=str(uuid.uuid4()),
        household_id=household_id,
        created_by=user_id,
        **data.model_dump(),
    )
    db.add(event)
    await db.commit()
    await db.refresh(event)
    return event


async def update_event(db: AsyncSession, event_id: str, household_id: str, data: EventUpdate) -> Event:
    result = await db.execute(
        select(Event).where(Event.id == event_id, Event.household_id == household_id)
    )
    event = result.scalar_one_or_none()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    updates = data.model_dump(exclude_unset=True)
    for key, value in updates.items():
        if key in _UPDATABLE_FIELDS:
            setattr(event, key, value)

    await db.commit()
    await db.refresh(event)
    return event


async def delete_event(db: AsyncSession, event_id: str, household_id: str) -> None:
    result = await db.execute(
        select(Event).where(Event.id == event_id, Event.household_id == household_id)
    )
    event = result.scalar_one_or_none()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    await db.delete(event)
    await db.commit()
```

**Step 2: Commit**

```bash
git add backend/app/services/event_service.py
git commit -m "feat: add event service with CRUD operations"
```

---

### Task 4: Backend Event Router

**Files:**
- Create: `backend/app/routers/events.py`
- Modify: `backend/app/main.py`

**Step 1: Create the event router**

Create `backend/app/routers/events.py`:

```python
from datetime import date

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user_id
from app.database import get_db
from app.schemas.event import EventCreate, EventResponse, EventUpdate
from app.services.event_service import create_event, delete_event, list_events, update_event
from app.services.household_service import get_household

router = APIRouter(prefix="/api/households/{household_id}/events", tags=["events"])


@router.get("", response_model=list[EventResponse])
async def get_events(
    household_id: str,
    start: date = Query(...),
    end: date = Query(...),
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    await get_household(db, household_id, user_id)
    return await list_events(db, household_id, start=start, end=end)


@router.post("", response_model=EventResponse, status_code=201)
async def create(
    household_id: str,
    body: EventCreate,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    await get_household(db, household_id, user_id)
    return await create_event(db, household_id, user_id, body)


@router.patch("/{event_id}", response_model=EventResponse)
async def update(
    household_id: str,
    event_id: str,
    body: EventUpdate,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    await get_household(db, household_id, user_id)
    return await update_event(db, event_id, household_id, body)


@router.delete("/{event_id}", status_code=204)
async def delete(
    household_id: str,
    event_id: str,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    await get_household(db, household_id, user_id)
    await delete_event(db, event_id, household_id)
```

**Step 2: Register the router**

In `backend/app/main.py`, add:

```python
from app.routers import auth, households, tasks, events
```

And add:

```python
app.include_router(events.router)
```

**Step 3: Rebuild and test**

```bash
docker compose up -d --build backend
```

Test with curl or the API docs (`/docs` in dev mode):

```bash
curl -s http://localhost:8000/api/health | python -m json.tool
```

**Step 4: Commit**

```bash
git add backend/app/routers/events.py backend/app/main.py
git commit -m "feat: add events API router with CRUD endpoints"
```

---

### Task 5: Frontend Event API Hooks

**Files:**
- Create: `frontend/src/api/events.ts`

**Step 1: Create the event API module**

Create `frontend/src/api/events.ts`:

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch, hasToken } from './client'

export interface CalendarEvent {
  id: string
  household_id: string
  title: string
  description: string | null
  start_time: string   // ISO datetime
  end_time: string     // ISO datetime
  assigned_to: string | null
  created_by: string
  recurrence_rule: string | null  // "daily" | "weekly" | "monthly" | "yearly"
  recurrence_interval: number
  recurrence_end: string | null   // ISO date
  created_at: string
  updated_at: string
}

export interface EventCreate {
  title: string
  description?: string
  start_time: string
  end_time: string
  assigned_to?: string
  recurrence_rule?: string
  recurrence_interval?: number
  recurrence_end?: string
}

export interface EventUpdate {
  title?: string
  description?: string
  start_time?: string
  end_time?: string
  assigned_to?: string
  recurrence_rule?: string | null
  recurrence_interval?: number
  recurrence_end?: string | null
}

export function useEvents(householdId: string, start: string, end: string) {
  return useQuery({
    queryKey: ['events', householdId, start, end],
    queryFn: () =>
      apiFetch<CalendarEvent[]>(
        `/households/${householdId}/events?start=${start}&end=${end}`
      ),
    enabled: !!householdId && hasToken(),
  })
}

export function useCreateEvent(householdId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (event: EventCreate) =>
      apiFetch<CalendarEvent>(`/households/${householdId}/events`, {
        method: 'POST',
        body: JSON.stringify(event),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['events', householdId] }),
  })
}

export function useUpdateEvent(householdId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ eventId, ...update }: EventUpdate & { eventId: string }) =>
      apiFetch<CalendarEvent>(`/households/${householdId}/events/${eventId}`, {
        method: 'PATCH',
        body: JSON.stringify(update),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['events', householdId] }),
  })
}

export function useDeleteEvent(householdId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (eventId: string) =>
      apiFetch<void>(`/households/${householdId}/events/${eventId}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['events', householdId] }),
  })
}
```

**Step 2: Commit**

```bash
git add frontend/src/api/events.ts
git commit -m "feat: add event API hooks with TanStack Query"
```

---

### Task 6: Recurrence Expansion Utility

**Files:**
- Create: `frontend/src/utils/recurrence.ts`

**Step 1: Create the recurrence expansion utility**

Create `frontend/src/utils/recurrence.ts`:

```typescript
import type { CalendarEvent } from '@/api/events'

export interface EventOccurrence {
  event: CalendarEvent
  occurrenceStart: Date
  occurrenceEnd: Date
}

/**
 * Expand recurring events into individual occurrences within a date range.
 * Non-recurring events are returned as-is if they fall within the range.
 */
export function expandRecurrences(
  events: CalendarEvent[],
  rangeStart: Date,
  rangeEnd: Date,
): EventOccurrence[] {
  const occurrences: EventOccurrence[] = []

  for (const event of events) {
    const start = new Date(event.start_time)
    const end = new Date(event.end_time)
    const durationMs = end.getTime() - start.getTime()

    if (!event.recurrence_rule) {
      // Non-recurring: include if it overlaps the range
      if (end >= rangeStart && start <= rangeEnd) {
        occurrences.push({ event, occurrenceStart: start, occurrenceEnd: end })
      }
      continue
    }

    const recEnd = event.recurrence_end ? new Date(event.recurrence_end + 'T23:59:59') : rangeEnd
    const effectiveEnd = recEnd < rangeEnd ? recEnd : rangeEnd
    const interval = event.recurrence_interval || 1

    let cursor = new Date(start)
    let iterations = 0
    const MAX_ITERATIONS = 1000 // Safety limit

    while (cursor <= effectiveEnd && iterations < MAX_ITERATIONS) {
      iterations++
      const occEnd = new Date(cursor.getTime() + durationMs)

      if (occEnd >= rangeStart && cursor <= rangeEnd) {
        occurrences.push({
          event,
          occurrenceStart: new Date(cursor),
          occurrenceEnd: occEnd,
        })
      }

      cursor = advanceDate(cursor, event.recurrence_rule, interval, start)
    }
  }

  occurrences.sort((a, b) => a.occurrenceStart.getTime() - b.occurrenceStart.getTime())
  return occurrences
}

function advanceDate(
  current: Date,
  rule: string,
  interval: number,
  anchor: Date,
): Date {
  const next = new Date(current)

  switch (rule) {
    case 'daily':
      next.setDate(next.getDate() + interval)
      break

    case 'weekly':
      next.setDate(next.getDate() + 7 * interval)
      break

    case 'monthly': {
      // Anchor to same day-of-week position (e.g., 2nd Tuesday)
      const anchorWeekOfMonth = Math.ceil(anchor.getDate() / 7)
      const anchorDayOfWeek = anchor.getDay()
      next.setMonth(next.getMonth() + interval)
      // Find the nth weekday in the new month
      next.setDate(1)
      // Find first occurrence of the target weekday
      while (next.getDay() !== anchorDayOfWeek) {
        next.setDate(next.getDate() + 1)
      }
      // Advance to the nth week
      next.setDate(next.getDate() + (anchorWeekOfMonth - 1) * 7)
      // If we overshot into the next month, this month doesn't have that position — skip
      if (next.getMonth() !== (current.getMonth() + interval) % 12) {
        return advanceDate(next, rule, interval, anchor)
      }
      // Preserve the original time
      next.setHours(anchor.getHours(), anchor.getMinutes(), anchor.getSeconds())
      break
    }

    case 'yearly':
      next.setFullYear(next.getFullYear() + interval)
      break
  }

  return next
}
```

**Step 2: Commit**

```bash
git add frontend/src/utils/recurrence.ts
git commit -m "feat: add recurrence expansion utility for calendar events"
```

---

### Task 7: Week Strip Component

**Files:**
- Create: `frontend/src/components/calendar/week-strip.tsx`

**Step 1: Create the week strip component**

Create `frontend/src/components/calendar/week-strip.tsx`:

```typescript
import { motion, AnimatePresence } from 'framer-motion'
import type { EventOccurrence } from '@/utils/recurrence'

interface WeekStripProps {
  weekStart: Date
  selectedDate: Date
  onSelectDate: (date: Date) => void
  onNavigate: (direction: -1 | 1) => void
  occurrences: EventOccurrence[]
}

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export function WeekStrip({ weekStart, selectedDate, onSelectDate, onNavigate, occurrences }: WeekStripProps) {
  const days = getDaysOfWeek(weekStart)
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const monthLabel = weekStart.toLocaleDateString('en', { month: 'long', year: 'numeric' })

  return (
    <div>
      {/* Month header with navigation */}
      <div className="flex items-center justify-between mb-3">
        <button
          onClick={() => onNavigate(-1)}
          className="w-9 h-9 rounded-full flex items-center justify-center text-text-muted hover:bg-text/5 transition-colors"
          aria-label="Previous week"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <h2 className="text-lg font-bold text-text">{monthLabel}</h2>
        <button
          onClick={() => onNavigate(1)}
          className="w-9 h-9 rounded-full flex items-center justify-center text-text-muted hover:bg-text/5 transition-colors"
          aria-label="Next week"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 18l6-6-6-6" />
          </svg>
        </button>
      </div>

      {/* Day cells */}
      <div className="grid grid-cols-7 gap-1">
        {days.map((day, i) => {
          const isToday = isSameDay(day, today)
          const isSelected = isSameDay(day, selectedDate)
          const dayEvents = getEventsForDay(day, occurrences)
          const dotCount = Math.min(dayEvents.length, 3)

          return (
            <button
              key={i}
              onClick={() => onSelectDate(day)}
              className="flex flex-col items-center py-2 rounded-2xl transition-all"
            >
              <span className="text-xs font-medium text-text-muted mb-1">
                {DAY_NAMES[i]}
              </span>
              <span
                className={`
                  w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold transition-all
                  ${isSelected
                    ? 'bg-primary text-white shadow-md'
                    : isToday
                      ? 'bg-primary/15 text-primary'
                      : 'text-text hover:bg-text/5'
                  }
                `}
              >
                {day.getDate()}
              </span>
              {/* Event dots */}
              <div className="flex gap-0.5 mt-1 h-2">
                {Array.from({ length: dotCount }).map((_, j) => (
                  <div
                    key={j}
                    className={`w-1.5 h-1.5 rounded-full ${
                      isSelected ? 'bg-primary' : 'bg-secondary'
                    }`}
                  />
                ))}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function getDaysOfWeek(weekStart: Date): Date[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart)
    d.setDate(d.getDate() + i)
    return d
  })
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
}

function getEventsForDay(day: Date, occurrences: EventOccurrence[]): EventOccurrence[] {
  return occurrences.filter((occ) => {
    const occDate = new Date(occ.occurrenceStart)
    return isSameDay(occDate, day)
  })
}
```

**Step 2: Commit**

```bash
git add frontend/src/components/calendar/week-strip.tsx
git commit -m "feat: add week strip calendar component with navigation and event dots"
```

---

### Task 8: Event Card Component

**Files:**
- Create: `frontend/src/components/calendar/event-card.tsx`

**Step 1: Create the event card component**

Create `frontend/src/components/calendar/event-card.tsx`:

```typescript
import { Card, Avatar } from '@/components/ui'
import type { EventOccurrence } from '@/utils/recurrence'
import type { HouseholdMember } from '@/api/households'

interface EventCardProps {
  occurrence: EventOccurrence
  members: HouseholdMember[]
  onClick: () => void
}

const RECURRENCE_LABELS: Record<string, string> = {
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
  yearly: 'Yearly',
}

export function EventCard({ occurrence, members, onClick }: EventCardProps) {
  const { event, occurrenceStart, occurrenceEnd } = occurrence
  const isRecurring = !!event.recurrence_rule
  const assignee = event.assigned_to
    ? members.find((m) => m.id === event.assigned_to)
    : null

  const formatTime = (d: Date) =>
    d.toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit', hour12: false })

  const intervalLabel = event.recurrence_interval > 1
    ? `Every ${event.recurrence_interval} ${event.recurrence_rule === 'daily' ? 'days' : event.recurrence_rule === 'weekly' ? 'weeks' : event.recurrence_rule === 'monthly' ? 'months' : 'years'}`
    : RECURRENCE_LABELS[event.recurrence_rule || '']

  return (
    <Card
      interactive
      onClick={onClick}
      className={`relative overflow-hidden ${isRecurring ? 'border-l-4 border-l-secondary' : 'border-l-4 border-l-primary'}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-text truncate">{event.title}</p>
          <p className="text-sm text-text-muted mt-0.5">
            {formatTime(occurrenceStart)} – {formatTime(occurrenceEnd)}
          </p>
          {isRecurring && (
            <span className="inline-block mt-1.5 px-2 py-0.5 rounded-full bg-secondary/10 text-secondary text-xs font-medium">
              {intervalLabel}
            </span>
          )}
        </div>
        {assignee && (
          <Avatar
            name={assignee.display_name}
            src={assignee.avatar_url}
            size="sm"
          />
        )}
      </div>
    </Card>
  )
}
```

**Step 2: Commit**

```bash
git add frontend/src/components/calendar/event-card.tsx
git commit -m "feat: add event card component with recurrence badge and assignee"
```

---

### Task 9: Create Event Bottom Sheet

**Files:**
- Create: `frontend/src/components/calendar/create-event-sheet.tsx`

**Step 1: Create the event creation bottom sheet**

Create `frontend/src/components/calendar/create-event-sheet.tsx`:

```typescript
import { motion, AnimatePresence } from 'framer-motion'
import { useRef, useState } from 'react'
import { Button, Input, Avatar } from '@/components/ui'
import type { EventCreate } from '@/api/events'
import type { HouseholdMember } from '@/api/households'

interface CreateEventSheetProps {
  open: boolean
  onClose: () => void
  onSubmit: (event: EventCreate) => void
  isPending: boolean
  members: HouseholdMember[]
  defaultDate: Date // The currently selected day on the calendar
}

const TIME_PRESETS = [
  { label: 'Morning', value: '09:00' },
  { label: 'Afternoon', value: '13:00' },
  { label: 'Evening', value: '18:00' },
]

const DURATION_PRESETS = [
  { label: '30 min', minutes: 30 },
  { label: '1 hour', minutes: 60 },
  { label: '2 hours', minutes: 120 },
]

const RECURRENCE_OPTIONS = [
  { label: 'None', value: null },
  { label: 'Daily', value: 'daily' },
  { label: 'Weekly', value: 'weekly' },
  { label: 'Monthly', value: 'monthly' },
] as const

export function CreateEventSheet({ open, onClose, onSubmit, isPending, members, defaultDate }: CreateEventSheetProps) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [showDetails, setShowDetails] = useState(false)
  const [startTime, setStartTime] = useState<string | null>(null)
  const [customStart, setCustomStart] = useState(false)
  const [durationMinutes, setDurationMinutes] = useState<number | null>(60)
  const [customDuration, setCustomDuration] = useState(false)
  const [customEndTime, setCustomEndTime] = useState<string | null>(null)
  const [eventDate, setEventDate] = useState<string>(formatDate(defaultDate))
  const [recurrence, setRecurrence] = useState<string | null>(null)
  const [recurrenceInterval, setRecurrenceInterval] = useState(1)
  const [assignedTo, setAssignedTo] = useState<string | null>(null)

  const startTimeRef = useRef<HTMLInputElement>(null)
  const endTimeRef = useRef<HTMLInputElement>(null)
  const dateInputRef = useRef<HTMLInputElement>(null)

  const resetForm = () => {
    setTitle('')
    setDescription('')
    setShowDetails(false)
    setStartTime(null)
    setCustomStart(false)
    setDurationMinutes(60)
    setCustomDuration(false)
    setCustomEndTime(null)
    setEventDate(formatDate(defaultDate))
    setRecurrence(null)
    setRecurrenceInterval(1)
    setAssignedTo(null)
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim() || !startTime) return

    const start = `${eventDate}T${startTime}:00`
    let end: string
    if (customDuration && customEndTime) {
      end = `${eventDate}T${customEndTime}:00`
    } else {
      const startDate = new Date(start)
      startDate.setMinutes(startDate.getMinutes() + (durationMinutes || 60))
      end = `${eventDate}T${padTime(startDate.getHours())}:${padTime(startDate.getMinutes())}:00`
    }

    onSubmit({
      title: title.trim(),
      description: description.trim() || undefined,
      start_time: start,
      end_time: end,
      assigned_to: assignedTo || undefined,
      recurrence_rule: recurrence || undefined,
      recurrence_interval: recurrence ? recurrenceInterval : undefined,
    })
    resetForm()
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
            <h2 className="text-xl font-bold text-text mb-4">New event</h2>

            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <Input
                label="What's happening?"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                autoFocus
              />

              {/* Details (collapsible) */}
              {!showDetails ? (
                <button
                  type="button"
                  onClick={() => setShowDetails(true)}
                  className="text-sm text-text-muted hover:text-text transition-colors text-left"
                >
                  + Add details...
                </button>
              ) : (
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Add details..."
                  className="h-20 px-4 py-3 rounded-[var(--radius-input)] border-2 border-text/10 bg-surface text-text placeholder:text-text-muted/50 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all duration-200 resize-none text-sm"
                />
              )}

              {/* Date */}
              <div>
                <label className="text-sm font-medium text-text-muted mb-2 block">Date</label>
                <div className="flex gap-2 flex-wrap relative">
                  {getDateOptions(defaultDate).map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setEventDate(opt.value)}
                      className={`px-3 py-1.5 rounded-full text-sm font-medium transition-all ${
                        eventDate === opt.value
                          ? 'bg-primary text-white shadow-md'
                          : 'bg-text/5 text-text-muted'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => dateInputRef.current?.showPicker()}
                    className={`px-3 py-1.5 rounded-full text-sm font-medium transition-all ${
                      eventDate && !getDateOptions(defaultDate).some((o) => o.value === eventDate)
                        ? 'bg-primary text-white shadow-md'
                        : 'bg-text/5 text-text-muted'
                    }`}
                  >
                    {eventDate && !getDateOptions(defaultDate).some((o) => o.value === eventDate)
                      ? new Date(eventDate + 'T00:00:00').toLocaleDateString('en', { month: 'short', day: 'numeric' })
                      : 'Pick date'}
                  </button>
                  <input
                    ref={dateInputRef}
                    type="date"
                    className="absolute opacity-0 pointer-events-none"
                    onChange={(e) => e.target.value && setEventDate(e.target.value)}
                  />
                </div>
              </div>

              {/* Start time */}
              <div>
                <label className="text-sm font-medium text-text-muted mb-2 block">Start time</label>
                <div className="flex gap-2 flex-wrap relative">
                  {TIME_PRESETS.map((tp) => (
                    <button
                      key={tp.value}
                      type="button"
                      onClick={() => { setStartTime(tp.value); setCustomStart(false) }}
                      className={`px-3 py-1.5 rounded-full text-sm font-medium transition-all ${
                        startTime === tp.value && !customStart
                          ? 'bg-primary text-white shadow-md'
                          : 'bg-text/5 text-text-muted'
                      }`}
                    >
                      {tp.label}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => { setCustomStart(true); startTimeRef.current?.showPicker() }}
                    className={`px-3 py-1.5 rounded-full text-sm font-medium transition-all ${
                      customStart && startTime
                        ? 'bg-primary text-white shadow-md'
                        : 'bg-text/5 text-text-muted'
                    }`}
                  >
                    {customStart && startTime ? startTime : 'Custom'}
                  </button>
                  <input
                    ref={startTimeRef}
                    type="time"
                    className="absolute opacity-0 pointer-events-none"
                    onChange={(e) => {
                      if (e.target.value) {
                        setStartTime(e.target.value)
                        setCustomStart(true)
                      }
                    }}
                  />
                </div>
              </div>

              {/* Duration (shown after start time is picked) */}
              {startTime && (
                <div>
                  <label className="text-sm font-medium text-text-muted mb-2 block">Duration</label>
                  <div className="flex gap-2 flex-wrap relative">
                    {DURATION_PRESETS.map((dp) => (
                      <button
                        key={dp.minutes}
                        type="button"
                        onClick={() => { setDurationMinutes(dp.minutes); setCustomDuration(false) }}
                        className={`px-3 py-1.5 rounded-full text-sm font-medium transition-all ${
                          durationMinutes === dp.minutes && !customDuration
                            ? 'bg-primary text-white shadow-md'
                            : 'bg-text/5 text-text-muted'
                        }`}
                      >
                        {dp.label}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => { setCustomDuration(true); endTimeRef.current?.showPicker() }}
                      className={`px-3 py-1.5 rounded-full text-sm font-medium transition-all ${
                        customDuration
                          ? 'bg-primary text-white shadow-md'
                          : 'bg-text/5 text-text-muted'
                      }`}
                    >
                      {customDuration && customEndTime ? `Until ${customEndTime}` : 'Custom'}
                    </button>
                    <input
                      ref={endTimeRef}
                      type="time"
                      className="absolute opacity-0 pointer-events-none"
                      onChange={(e) => {
                        if (e.target.value) {
                          setCustomEndTime(e.target.value)
                          setCustomDuration(true)
                        }
                      }}
                    />
                  </div>
                </div>
              )}

              {/* Recurrence */}
              <div>
                <label className="text-sm font-medium text-text-muted mb-2 block">Repeat</label>
                <div className="flex gap-2 flex-wrap">
                  {RECURRENCE_OPTIONS.map((opt) => (
                    <button
                      key={opt.label}
                      type="button"
                      onClick={() => setRecurrence(opt.value)}
                      className={`px-3 py-1.5 rounded-full text-sm font-medium transition-all ${
                        recurrence === opt.value
                          ? 'bg-primary text-white shadow-md'
                          : 'bg-text/5 text-text-muted'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                {recurrence && (
                  <div className="flex items-center gap-2 mt-2">
                    <span className="text-sm text-text-muted">Every</span>
                    <input
                      type="number"
                      min={1}
                      max={365}
                      value={recurrenceInterval}
                      onChange={(e) => setRecurrenceInterval(Math.max(1, Number(e.target.value)))}
                      className="w-16 h-9 px-3 rounded-xl border-2 border-text/10 bg-surface text-text text-center text-sm focus:outline-none focus:border-primary"
                    />
                    <span className="text-sm text-text-muted">
                      {recurrence === 'daily' ? 'day(s)' : recurrence === 'weekly' ? 'week(s)' : recurrence === 'monthly' ? 'month(s)' : 'year(s)'}
                    </span>
                  </div>
                )}
              </div>

              {/* Assignee picker */}
              {members.length > 0 && (
                <div>
                  <label className="text-sm font-medium text-text-muted mb-2 block">Assign to</label>
                  <div className="flex gap-3 overflow-x-auto py-1">
                    {members.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => setAssignedTo(assignedTo === m.id ? null : m.id)}
                        className={`flex flex-col items-center gap-1 min-w-[3.5rem] transition-all ${
                          assignedTo === m.id ? 'opacity-100 scale-105' : 'opacity-50'
                        }`}
                      >
                        <Avatar
                          name={m.display_name}
                          src={m.avatar_url}
                          size="md"
                          ring={assignedTo === m.id}
                        />
                        <span className="text-xs text-text-muted truncate w-full text-center">
                          {m.first_name || m.display_name.split(' ')[0]}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <Button type="submit" disabled={!title.trim() || !startTime || isPending}>
                {isPending ? 'Adding...' : 'Add event'}
              </Button>
            </form>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}

function formatDate(d: Date): string {
  return d.toISOString().split('T')[0]
}

function padTime(n: number): string {
  return n.toString().padStart(2, '0')
}

function getDateOptions(defaultDate: Date): { label: string; value: string }[] {
  const today = new Date()
  const fmt = (d: Date) => d.toISOString().split('T')[0]
  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)
  const defaultStr = fmt(defaultDate)
  const todayStr = fmt(today)
  const tomorrowStr = fmt(tomorrow)

  const options = [
    { label: 'Today', value: todayStr },
    { label: 'Tomorrow', value: tomorrowStr },
  ]

  // If default date is the selected calendar day and isn't today/tomorrow, add it
  if (defaultStr !== todayStr && defaultStr !== tomorrowStr) {
    options.unshift({
      label: defaultDate.toLocaleDateString('en', { weekday: 'short', month: 'short', day: 'numeric' }),
      value: defaultStr,
    })
  }

  return options
}
```

**Step 2: Commit**

```bash
git add frontend/src/components/calendar/create-event-sheet.tsx
git commit -m "feat: add create event bottom sheet with quick-pick time and recurrence"
```

---

### Task 10: Edit Event Bottom Sheet

**Files:**
- Create: `frontend/src/components/calendar/edit-event-sheet.tsx`

**Step 1: Create the edit event bottom sheet**

Create `frontend/src/components/calendar/edit-event-sheet.tsx`:

```typescript
import { motion, AnimatePresence } from 'framer-motion'
import { useRef, useState, useEffect } from 'react'
import { Button, Input, Avatar } from '@/components/ui'
import type { CalendarEvent, EventUpdate } from '@/api/events'
import type { HouseholdMember } from '@/api/households'

interface EditEventSheetProps {
  event: CalendarEvent | null
  open: boolean
  onClose: () => void
  onSubmit: (update: EventUpdate & { eventId: string }) => void
  onDelete: (eventId: string) => void
  isPending: boolean
  members: HouseholdMember[]
}

const RECURRENCE_OPTIONS = [
  { label: 'None', value: null },
  { label: 'Daily', value: 'daily' },
  { label: 'Weekly', value: 'weekly' },
  { label: 'Monthly', value: 'monthly' },
] as const

export function EditEventSheet({ event, open, onClose, onSubmit, onDelete, isPending, members }: EditEventSheetProps) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [startTime, setStartTime] = useState('')
  const [endTime, setEndTime] = useState('')
  const [eventDate, setEventDate] = useState('')
  const [recurrence, setRecurrence] = useState<string | null>(null)
  const [recurrenceInterval, setRecurrenceInterval] = useState(1)
  const [assignedTo, setAssignedTo] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const startTimeRef = useRef<HTMLInputElement>(null)
  const endTimeRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (event && open) {
      const start = new Date(event.start_time)
      const end = new Date(event.end_time)
      setTitle(event.title)
      setDescription(event.description || '')
      setEventDate(start.toISOString().split('T')[0])
      setStartTime(`${padTime(start.getHours())}:${padTime(start.getMinutes())}`)
      setEndTime(`${padTime(end.getHours())}:${padTime(end.getMinutes())}`)
      setRecurrence(event.recurrence_rule)
      setRecurrenceInterval(event.recurrence_interval)
      setAssignedTo(event.assigned_to)
      setConfirmDelete(false)
    }
  }, [event, open])

  if (!event) return null

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim() || !startTime || !endTime) return
    onSubmit({
      eventId: event.id,
      title: title.trim(),
      description: description.trim() || undefined,
      start_time: `${eventDate}T${startTime}:00`,
      end_time: `${eventDate}T${endTime}:00`,
      assigned_to: assignedTo,
      recurrence_rule: recurrence,
      recurrence_interval: recurrence ? recurrenceInterval : undefined,
    })
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
            <h2 className="text-xl font-bold text-text mb-4">Edit event</h2>

            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <Input
                label="Title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />

              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Add details..."
                className="h-20 px-4 py-3 rounded-[var(--radius-input)] border-2 border-text/10 bg-surface text-text placeholder:text-text-muted/50 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all duration-200 resize-none text-sm"
              />

              {/* Time pickers */}
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="text-sm font-medium text-text-muted mb-2 block">Start</label>
                  <button
                    type="button"
                    onClick={() => startTimeRef.current?.showPicker()}
                    className="w-full h-12 px-4 rounded-[var(--radius-input)] border-2 border-text/10 bg-surface text-text text-left font-medium"
                  >
                    {startTime}
                  </button>
                  <input
                    ref={startTimeRef}
                    type="time"
                    value={startTime}
                    className="absolute opacity-0 pointer-events-none"
                    onChange={(e) => e.target.value && setStartTime(e.target.value)}
                  />
                </div>
                <div className="flex-1">
                  <label className="text-sm font-medium text-text-muted mb-2 block">End</label>
                  <button
                    type="button"
                    onClick={() => endTimeRef.current?.showPicker()}
                    className="w-full h-12 px-4 rounded-[var(--radius-input)] border-2 border-text/10 bg-surface text-text text-left font-medium"
                  >
                    {endTime}
                  </button>
                  <input
                    ref={endTimeRef}
                    type="time"
                    value={endTime}
                    className="absolute opacity-0 pointer-events-none"
                    onChange={(e) => e.target.value && setEndTime(e.target.value)}
                  />
                </div>
              </div>

              {/* Recurrence */}
              <div>
                <label className="text-sm font-medium text-text-muted mb-2 block">Repeat</label>
                <div className="flex gap-2 flex-wrap">
                  {RECURRENCE_OPTIONS.map((opt) => (
                    <button
                      key={opt.label}
                      type="button"
                      onClick={() => setRecurrence(opt.value)}
                      className={`px-3 py-1.5 rounded-full text-sm font-medium transition-all ${
                        recurrence === opt.value
                          ? 'bg-primary text-white shadow-md'
                          : 'bg-text/5 text-text-muted'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                {recurrence && (
                  <div className="flex items-center gap-2 mt-2">
                    <span className="text-sm text-text-muted">Every</span>
                    <input
                      type="number"
                      min={1}
                      max={365}
                      value={recurrenceInterval}
                      onChange={(e) => setRecurrenceInterval(Math.max(1, Number(e.target.value)))}
                      className="w-16 h-9 px-3 rounded-xl border-2 border-text/10 bg-surface text-text text-center text-sm focus:outline-none focus:border-primary"
                    />
                    <span className="text-sm text-text-muted">
                      {recurrence === 'daily' ? 'day(s)' : recurrence === 'weekly' ? 'week(s)' : recurrence === 'monthly' ? 'month(s)' : 'year(s)'}
                    </span>
                  </div>
                )}
              </div>

              {/* Assignee picker */}
              {members.length > 0 && (
                <div>
                  <label className="text-sm font-medium text-text-muted mb-2 block">Assign to</label>
                  <div className="flex gap-3 overflow-x-auto py-1">
                    {members.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => setAssignedTo(assignedTo === m.id ? null : m.id)}
                        className={`flex flex-col items-center gap-1 min-w-[3.5rem] transition-all ${
                          assignedTo === m.id ? 'opacity-100 scale-105' : 'opacity-50'
                        }`}
                      >
                        <Avatar
                          name={m.display_name}
                          src={m.avatar_url}
                          size="md"
                          ring={assignedTo === m.id}
                        />
                        <span className="text-xs text-text-muted truncate w-full text-center">
                          {m.first_name || m.display_name.split(' ')[0]}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex gap-3">
                <Button type="submit" className="flex-1" disabled={!title.trim() || !startTime || !endTime || isPending}>
                  {isPending ? 'Saving...' : 'Save changes'}
                </Button>
                <Button
                  type="button"
                  variant={confirmDelete ? 'danger' : 'ghost'}
                  onClick={() => {
                    if (confirmDelete) {
                      onDelete(event.id)
                    } else {
                      setConfirmDelete(true)
                    }
                  }}
                >
                  {confirmDelete ? 'Confirm' : 'Delete'}
                </Button>
              </div>
              {event.recurrence_rule && (
                <p className="text-xs text-text-muted text-center">
                  Changes apply to all occurrences of this recurring event.
                </p>
              )}
            </form>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}

function padTime(n: number): string {
  return n.toString().padStart(2, '0')
}
```

**Step 2: Commit**

```bash
git add frontend/src/components/calendar/edit-event-sheet.tsx
git commit -m "feat: add edit event bottom sheet with delete confirmation"
```

---

### Task 11: Calendar Page (Wire Everything Together)

**Files:**
- Modify: `frontend/src/routes/calendar.tsx`

**Step 1: Replace the calendar stub with the full implementation**

Replace the entire content of `frontend/src/routes/calendar.tsx`:

```typescript
import { createFileRoute, Navigate } from '@tanstack/react-router'
import { useAuth } from 'react-oidc-context'
import { useState, useMemo } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useHouseholds, useHouseholdMembers } from '@/api/households'
import { useEvents, useCreateEvent, useUpdateEvent, useDeleteEvent } from '@/api/events'
import type { CalendarEvent } from '@/api/events'
import { expandRecurrences, type EventOccurrence } from '@/utils/recurrence'
import { WeekStrip } from '@/components/calendar/week-strip'
import { EventCard } from '@/components/calendar/event-card'
import { CreateEventSheet } from '@/components/calendar/create-event-sheet'
import { EditEventSheet } from '@/components/calendar/edit-event-sheet'
import { Fab, Card } from '@/components/ui'

export const Route = createFileRoute('/calendar')({
  component: CalendarPage,
})

function CalendarPage() {
  const auth = useAuth()
  const { data: households } = useHouseholds()

  if (!auth.isAuthenticated) return <Navigate to="/login" />
  if (!households?.length) return <Navigate to="/onboarding" />

  return <CalendarContent householdId={households[0].id} />
}

function CalendarContent({ householdId }: { householdId: string }) {
  const [selectedDate, setSelectedDate] = useState(() => {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    return d
  })
  const [weekStart, setWeekStart] = useState(() => getMonday(new Date()))
  const [showCreate, setShowCreate] = useState(false)
  const [editEvent, setEditEvent] = useState<CalendarEvent | null>(null)

  // Fetch a generous range to cover recurring events
  const fetchStart = useMemo(() => {
    const d = new Date(weekStart)
    d.setDate(d.getDate() - 7)
    return d.toISOString().split('T')[0]
  }, [weekStart])
  const fetchEnd = useMemo(() => {
    const d = new Date(weekStart)
    d.setDate(d.getDate() + 14)
    return d.toISOString().split('T')[0]
  }, [weekStart])

  const { data: events = [], isLoading } = useEvents(householdId, fetchStart, fetchEnd)
  const { data: members = [] } = useHouseholdMembers(householdId)
  const createMutation = useCreateEvent(householdId)
  const updateMutation = useUpdateEvent(householdId)
  const deleteMutation = useDeleteEvent(householdId)

  // Expand recurrences for the visible range
  const occurrences = useMemo(() => {
    const rangeStart = new Date(weekStart)
    const rangeEnd = new Date(weekStart)
    rangeEnd.setDate(rangeEnd.getDate() + 7)
    return expandRecurrences(events, rangeStart, rangeEnd)
  }, [events, weekStart])

  // Filter occurrences for the selected day
  const dayOccurrences = useMemo(() => {
    return occurrences.filter((occ) => isSameDay(occ.occurrenceStart, selectedDate))
  }, [occurrences, selectedDate])

  const navigateWeek = (direction: -1 | 1) => {
    setWeekStart((prev) => {
      const next = new Date(prev)
      next.setDate(next.getDate() + direction * 7)
      return next
    })
  }

  const selectedLabel = selectedDate.toLocaleDateString('en', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  })

  return (
    <div className="pb-4">
      <h1 className="text-2xl font-extrabold text-text mt-2 mb-4">Calendar</h1>

      {/* Week strip */}
      <Card className="mb-4">
        <WeekStrip
          weekStart={weekStart}
          selectedDate={selectedDate}
          onSelectDate={setSelectedDate}
          onNavigate={navigateWeek}
          occurrences={occurrences}
        />
      </Card>

      {/* Day detail */}
      <h2 className="text-lg font-bold text-text mb-3">{selectedLabel}</h2>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2].map((i) => (
            <div key={i} className="h-20 bg-surface rounded-[var(--radius-card)] animate-pulse" />
          ))}
        </div>
      ) : dayOccurrences.length === 0 ? (
        <Card className="text-center py-8">
          <p className="text-4xl mb-3">&#9728;&#65039;</p>
          <p className="font-semibold text-text">No events</p>
          <p className="text-sm text-text-muted mt-1">Tap + to add an event.</p>
        </Card>
      ) : (
        <motion.div className="space-y-3">
          <AnimatePresence>
            {dayOccurrences.map((occ, i) => (
              <motion.div
                key={`${occ.event.id}-${occ.occurrenceStart.toISOString()}`}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, x: -200 }}
                transition={{ delay: i * 0.05 }}
              >
                <EventCard
                  occurrence={occ}
                  members={members}
                  onClick={() => setEditEvent(occ.event)}
                />
              </motion.div>
            ))}
          </AnimatePresence>
        </motion.div>
      )}

      {/* FAB */}
      <Fab onClick={() => setShowCreate(true)}>+</Fab>

      {/* Create sheet */}
      <CreateEventSheet
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onSubmit={async (event) => {
          await createMutation.mutateAsync(event)
          setShowCreate(false)
        }}
        isPending={createMutation.isPending}
        members={members}
        defaultDate={selectedDate}
      />

      {/* Edit sheet */}
      <EditEventSheet
        event={editEvent}
        open={!!editEvent}
        onClose={() => setEditEvent(null)}
        onSubmit={async (update) => {
          await updateMutation.mutateAsync(update)
          setEditEvent(null)
        }}
        onDelete={async (id) => {
          await deleteMutation.mutateAsync(id)
          setEditEvent(null)
        }}
        isPending={updateMutation.isPending}
        members={members}
      />
    </div>
  )
}

function getMonday(d: Date): Date {
  const date = new Date(d)
  date.setHours(0, 0, 0, 0)
  const day = date.getDay()
  // getDay() returns 0 for Sunday; shift to Monday-based week
  const diff = day === 0 ? -6 : 1 - day
  date.setDate(date.getDate() + diff)
  return date
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
}
```

**Step 2: Build and verify**

```bash
docker compose up -d --build frontend
```

Open the app, navigate to the Calendar tab. Verify:
- Week strip shows current week with navigation arrows
- Tapping a day shows its events (empty state initially)
- FAB opens the create event sheet
- Creating an event shows it on the calendar
- Tapping an event opens the edit sheet

**Step 3: Commit**

```bash
git add frontend/src/routes/calendar.tsx
git commit -m "feat: implement calendar page with week view, day detail, and event CRUD"
```

---

### Task 12: Rebuild and Integration Test

**Step 1: Rebuild both containers**

```bash
docker compose up -d --build
```

**Step 2: Verify end-to-end flow**

1. Navigate to Calendar tab
2. Create a new event with morning preset + 1 hour duration
3. Verify it appears on the correct day with proper time
4. Create a recurring weekly event
5. Navigate to next week — verify the recurring event appears
6. Edit the event title
7. Delete the event
8. Verify empty state returns

**Step 3: Final commit**

```bash
git add -A
git commit -m "feat: complete calendar feature with events, recurrence, and week view"
```
