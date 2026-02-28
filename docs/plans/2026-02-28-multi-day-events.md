# Multi-Day All-Day Events Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add support for all-day events that can span multiple days, shown on each day they cover.

**Architecture:** Add `all_day` boolean to the existing Event model. When `true`, `start_time`/`end_time` store date boundaries (time ignored). Frontend forms toggle between timed and all-day modes. Calendar day filtering checks date overlap instead of exact start-day match.

**Tech Stack:** FastAPI, SQLAlchemy, Alembic, React, TypeScript, TanStack Query

---

### Task 1: Backend — Add `all_day` column to Event model + migration

**Files:**
- Modify: `backend/app/models/event.py`
- Modify: `backend/app/schemas/event.py`
- Modify: `backend/app/services/event_service.py`
- Create: `backend/alembic/versions/b2c3d4e5f6a7_add_event_all_day.py`

**Step 1: Add `all_day` to Event model**

In `backend/app/models/event.py`, add after the `end_time` column:

```python
all_day: Mapped[bool] = mapped_column(sa.Boolean, nullable=False, server_default=sa.text("0"))
```

Import `Boolean` is already available via `from sqlalchemy import ...` — add `Boolean` to that import line.

**Step 2: Add `all_day` to all three schemas**

In `backend/app/schemas/event.py`:

- `EventCreate`: add `all_day: bool = False`
- `EventUpdate`: add `all_day: bool | None = None`
- `EventResponse`: add `all_day: bool`

**Step 3: Add `all_day` to `_UPDATABLE_FIELDS`**

In `backend/app/services/event_service.py`, add `"all_day"` to the `_UPDATABLE_FIELDS` set.

**Step 4: Create Alembic migration**

Create `backend/alembic/versions/b2c3d4e5f6a7_add_event_all_day.py`:

```python
"""add event all_day column

Revision ID: b2c3d4e5f6a7
Revises: a1b2c3d4e5f6
Create Date: 2026-02-28 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'b2c3d4e5f6a7'
down_revision: Union[str, Sequence[str], None] = 'a1b2c3d4e5f6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('events', sa.Column('all_day', sa.Boolean(), nullable=False, server_default=sa.text("0")))


def downgrade() -> None:
    op.drop_column('events', 'all_day')
```

**Step 5: Commit**

```bash
git add backend/app/models/event.py backend/app/schemas/event.py backend/app/services/event_service.py backend/alembic/versions/b2c3d4e5f6a7_add_event_all_day.py
git commit -m "feat: add all_day column to events model and schemas"
```

---

### Task 2: Frontend — Add `all_day` to API types

**Files:**
- Modify: `frontend/src/api/events.ts`

**Step 1: Add `all_day` to all three interfaces**

- `CalendarEvent`: add `all_day: boolean`
- `EventCreate`: add `all_day?: boolean`
- `EventUpdate`: add `all_day?: boolean`

**Step 2: Commit**

```bash
git add frontend/src/api/events.ts
git commit -m "feat: add all_day to frontend event types"
```

---

### Task 3: Frontend — Update calendar day filtering for multi-day events

**Files:**
- Modify: `frontend/src/routes/calendar.tsx`

**Step 1: Change day occurrence filtering**

In `CalendarContent`, replace the `dayOccurrences` memo (currently line ~94-97):

```typescript
const dayOccurrences = useMemo(() => {
  const dayStart = new Date(selectedDate)
  dayStart.setHours(0, 0, 0, 0)
  const dayEnd = new Date(selectedDate)
  dayEnd.setHours(23, 59, 59, 999)

  return occurrences
    .filter((occ) => occ.occurrenceStart <= dayEnd && occ.occurrenceEnd >= dayStart)
    .sort((a, b) => {
      // All-day events first, then by start time
      const aAllDay = a.event.all_day ? 0 : 1
      const bAllDay = b.event.all_day ? 0 : 1
      if (aAllDay !== bAllDay) return aAllDay - bAllDay
      return a.occurrenceStart.getTime() - b.occurrenceStart.getTime()
    })
}, [occurrences, selectedDate])
```

This replaces the `isSameDay(occ.occurrenceStart, selectedDate)` check with an overlap check, so multi-day events appear on every day they span. All-day events sort to the top.

**Step 2: Commit**

```bash
git add frontend/src/routes/calendar.tsx
git commit -m "feat: show multi-day events on all days they span"
```

---

### Task 4: Frontend — Update event card for all-day display

**Files:**
- Modify: `frontend/src/components/calendar/event-card.tsx`

**Step 1: Update EventCard to handle all-day events**

Change the time display logic in the `EventCard` component. Replace the time line (`formatTime(occurrenceStart) – formatTime(occurrenceEnd)`) with conditional rendering:

```typescript
{event.all_day ? (
  <p className="text-sm text-text-muted mt-0.5">
    {formatAllDayLabel(occurrenceStart, occurrenceEnd)}
  </p>
) : (
  <p className="text-sm text-text-muted mt-0.5">
    {formatTime(occurrenceStart)} – {formatTime(occurrenceEnd)}
  </p>
)}
```

Add the `formatAllDayLabel` helper:

```typescript
function formatAllDayLabel(start: Date, end: Date): string {
  const startDay = new Date(start)
  startDay.setHours(0, 0, 0, 0)
  const endDay = new Date(end)
  endDay.setHours(0, 0, 0, 0)

  if (startDay.getTime() === endDay.getTime()) return 'All day'

  const endLabel = end.toLocaleDateString('en', { month: 'short', day: 'numeric' })
  return `All day · ends ${endLabel}`
}
```

Also update the left border color to use a distinct color for all-day events:

```typescript
const borderColor = event.all_day ? 'border-l-accent' : isRecurring ? 'border-l-secondary' : 'border-l-primary'
```

**Step 2: Commit**

```bash
git add frontend/src/components/calendar/event-card.tsx
git commit -m "feat: display all-day label on event cards"
```

---

### Task 5: Frontend — Add all-day toggle to create event sheet

**Files:**
- Modify: `frontend/src/components/calendar/create-event-sheet.tsx`

**Step 1: Add `allDay` state and end date state**

Add to existing state declarations:

```typescript
const [allDay, setAllDay] = useState(false)
const [endDate, setEndDate] = useState(formatDate(defaultDate))
```

Reset them in `resetForm`:

```typescript
setAllDay(false)
setEndDate(formatDate(defaultDate))
```

**Step 2: Add all-day toggle pills before the date picker**

Insert after the description section and before the date picker:

```tsx
{/* All-day toggle */}
<div>
  <label className="text-sm font-medium text-text-muted mb-2 block">Type</label>
  <div className="flex gap-2">
    <button
      type="button"
      onClick={() => setAllDay(false)}
      className={`px-3 py-1.5 rounded-full text-sm font-medium transition-all ${
        !allDay ? 'bg-primary text-white shadow-md' : 'bg-text/5 text-text-muted'
      }`}
    >
      Timed
    </button>
    <button
      type="button"
      onClick={() => setAllDay(true)}
      className={`px-3 py-1.5 rounded-full text-sm font-medium transition-all ${
        allDay ? 'bg-primary text-white shadow-md' : 'bg-text/5 text-text-muted'
      }`}
    >
      All day
    </button>
  </div>
</div>
```

**Step 3: Conditionally show time/duration OR end date picker**

Wrap the existing start-time and duration sections with `{!allDay && (...)}`.

After the date section, when `allDay` is true, show end date picker:

```tsx
{allDay && (
  <label className="flex flex-col gap-1.5">
    <span className="text-sm font-medium text-text-muted">End date</span>
    <input
      type="date"
      value={endDate}
      min={eventDate}
      onChange={(e) => { if (e.target.value) setEndDate(e.target.value) }}
      className="px-4 py-2.5 rounded-[var(--radius-input)] border-2 border-text/10 bg-surface text-text text-base font-medium focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all duration-200"
    />
  </label>
)}
```

**Step 4: Update `handleSubmit` for all-day events**

Replace the submit handler body to branch on `allDay`:

```typescript
function handleSubmit(e: React.FormEvent): void {
  e.preventDefault()
  if (!title.trim()) return
  if (!allDay && !startTime) return

  let start_time: string
  let end_time: string

  if (allDay) {
    start_time = `${eventDate}T00:00:00`
    end_time = `${endDate}T23:59:59`
  } else {
    let endTimeVal: string
    if (customDuration && customEndTime) {
      endTimeVal = customEndTime
    } else {
      endTimeVal = addMinutes(startTime!, durationMinutes ?? 60)
    }
    start_time = `${eventDate}T${startTime}:00`
    end_time = `${eventDate}T${endTimeVal}:00`
  }

  const event: EventCreate = {
    title: title.trim(),
    start_time,
    end_time,
    all_day: allDay || undefined,
  }

  if (description.trim()) event.description = description.trim()
  if (assignedTo) event.assigned_to = assignedTo
  if (recurrence) {
    event.recurrence_rule = recurrence
    event.recurrence_interval = recurrenceInterval
  }

  onSubmit(event)
  resetForm()
}
```

**Step 5: Update `canSubmit`**

```typescript
const canSubmit = title.trim() && (allDay || startTime) && !isPending
```

**Step 6: Sync `endDate` when `eventDate` changes (ensure end >= start)**

Add effect:

```typescript
useEffect(() => {
  if (endDate < eventDate) setEndDate(eventDate)
}, [eventDate])
```

**Step 7: Commit**

```bash
git add frontend/src/components/calendar/create-event-sheet.tsx
git commit -m "feat: add all-day toggle to create event sheet"
```

---

### Task 6: Frontend — Add all-day toggle to edit event sheet

**Files:**
- Modify: `frontend/src/components/calendar/edit-event-sheet.tsx`

**Step 1: Add `allDay` and `endDate` state**

Add to state declarations:

```typescript
const [allDay, setAllDay] = useState(false)
const [endDate, setEndDate] = useState('')
```

**Step 2: Initialize from event data**

In the `useEffect` that sets form state from `event`, add:

```typescript
setAllDay(event.all_day ?? false)
const endD = new Date(event.end_time)
setEndDate(`${endD.getFullYear()}-${padTime(endD.getMonth() + 1)}-${padTime(endD.getDate())}`)
```

**Step 3: Add all-day toggle pills (same markup as create sheet)**

Insert before the date picker in the form. Same two-button toggle as Task 5.

**Step 4: Conditionally show time pickers or end date**

Wrap the time section with `{!allDay && (...)}`. Add end date picker when `allDay` is true (same as Task 5 but using `endDate` state, min bound to `eventDate`).

**Step 5: Update `handleSubmit`**

Branch on `allDay`:

```typescript
function handleSubmit(e: React.FormEvent): void {
  e.preventDefault()
  if (!event || !title.trim()) return
  if (!allDay && (!startTime || !endTime)) return

  let start_time: string
  let end_time: string

  if (allDay) {
    start_time = `${eventDate}T00:00:00`
    end_time = `${endDate}T23:59:59`
  } else {
    start_time = `${eventDate}T${startTime}:00`
    end_time = `${eventDate}T${endTime}:00`
  }

  const update: EventUpdate & { eventId: string } = {
    eventId: event.id,
    title: title.trim(),
    description: description.trim() || undefined,
    start_time,
    end_time,
    all_day: allDay,
    assigned_to: assignedTo ?? undefined,
    recurrence_rule: recurrence,
    recurrence_interval: recurrence ? recurrenceInterval : undefined,
  }

  onSubmit(update)
}
```

**Step 6: Update `canSubmit`**

```typescript
const canSubmit = title.trim() && (allDay || (startTime && endTime)) && !isPending
```

**Step 7: Commit**

```bash
git add frontend/src/components/calendar/edit-event-sheet.tsx
git commit -m "feat: add all-day toggle to edit event sheet"
```

---

### Task 7: Frontend — Update dashboard upcoming section for all-day events

**Files:**
- Modify: `frontend/src/routes/index.tsx`

**Step 1: Update `formatOccurrenceDate` to handle all-day events**

The `UpcomingSummary` component renders occurrences using `formatOccurrenceDate`. Update the rendering to check `occ.event.all_day`:

In the occurrences map inside `UpcomingSummary`, replace the time label:

```tsx
<span className="text-xs font-medium text-primary shrink-0 w-20">
  {occ.event.all_day
    ? formatOccurrenceDateOnly(occ.occurrenceStart)
    : formatOccurrenceDate(occ.occurrenceStart)}
</span>
```

Add new helper:

```typescript
function formatOccurrenceDateOnly(d: Date): string {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const dateOnly = new Date(d)
  dateOnly.setHours(0, 0, 0, 0)
  const diff = Math.round((dateOnly.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Tomorrow'
  return d.toLocaleDateString('en', { weekday: 'short' })
}
```

**Step 2: Commit**

```bash
git add frontend/src/routes/index.tsx
git commit -m "feat: show all-day events without time in dashboard"
```

---

### Task 8: Verify and type-check

**Step 1: Run TypeScript type check**

```bash
cd frontend && npx tsc --noEmit
```

Expected: no errors.

**Step 2: Run backend migration check**

```bash
cd backend && python -c "from app.models.event import Event; print('Model OK')"
```

**Step 3: Run existing tests**

```bash
cd backend && pytest tests/ -v
```

**Step 4: Final commit if any fixes needed**

```bash
git add -A && git commit -m "fix: address type/lint issues from multi-day events"
```
