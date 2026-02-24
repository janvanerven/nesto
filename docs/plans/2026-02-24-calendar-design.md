# Calendar Feature Design

## Goal

Add a shared household calendar with Notion-style visual polish and Outlook-like usability. Week view with day detail, quick-pick time/duration selectors, and recurring event support.

## Architecture

Separate `events` table alongside `tasks`. Events have their own model, schema, service, router, and frontend API hooks — mirroring the existing task/reminder pattern. Recurring events stored as a single row with a recurrence rule; the frontend expands occurrences client-side for the visible date range.

## Data Model

**`events` table:**

| Column | Type | Notes |
|--------|------|-------|
| `id` | TEXT (UUID) | Primary key |
| `household_id` | TEXT FK | Scoped to household |
| `title` | TEXT | Required, max 500 |
| `description` | TEXT | Optional ("Details" in UI) |
| `start_time` | DATETIME | Required, UTC |
| `end_time` | DATETIME | Required, UTC |
| `assigned_to` | TEXT FK | Optional, FK to users |
| `created_by` | TEXT FK | Required, FK to users |
| `recurrence_rule` | TEXT | Nullable. One of: `daily`, `weekly`, `monthly`, `yearly` |
| `recurrence_interval` | INTEGER | Default 1. e.g. 2 + weekly = every 2 weeks |
| `recurrence_end` | DATE | Optional end date for recurrence |
| `created_at` | DATETIME | Auto |
| `updated_at` | DATETIME | Auto |

For "nth day of week/month" patterns (e.g., "2nd Tuesday of each month"), `recurrence_rule` stores `monthly` and the occurrence is anchored to the original `start_time`'s day-of-week position within the month.

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/households/{id}/events` | List events for date range (`start`, `end` query params, required) |
| `POST` | `/api/households/{id}/events` | Create event |
| `PATCH` | `/api/households/{id}/events/{eventId}` | Update event |
| `DELETE` | `/api/households/{id}/events/{eventId}` | Delete event (all occurrences for recurring) |

Backend structure follows existing patterns: `models/event.py`, `schemas/event.py`, `services/event_service.py`, `routers/events.py`, plus Alembic migration.

## Frontend UI

### Calendar Page Layout (Week View + Day Detail)

**Top section — Week strip:**
- Month/year header with left/right navigation arrows
- 7-day row: day names + date numbers
- Colored dots under days with events (primary color, max 3 visible)
- Today: filled circle behind date number
- Selected day: ring outline
- Swipe left/right to change weeks (Framer Motion gesture)

**Bottom section — Day detail (scrollable):**
- Date heading (e.g., "Tuesday, Feb 24")
- Event cards sorted by start time:
  - Colored left border (primary for regular, secondary for recurring)
  - Title (bold), time range, recurring badge pill if applicable
  - Assignee avatar (small, right-aligned) if assigned
- Empty state: "No events" with subtle message
- Tap event card to open edit bottom sheet

**FAB (+):** Opens create event bottom sheet.

### Create Event Bottom Sheet

- **Title** input
- **Details** textarea (optional, collapsed by default, label: "Add details...")
- **Start time quick-picks:** `Morning (9:00)` / `Afternoon (13:00)` / `Evening (18:00)` / `Custom` — chip buttons
- **Duration quick-picks:** `30 min` / `1 hour` / `2 hours` / `Custom` — shown after start time selected
- Custom time: native `<input type="time">` via `showPicker()` ref pattern
- **Date:** Defaults to selected calendar day. Quick-picks: `Today` / `Tomorrow` / `Pick date`
- **Recurrence:** Toggle pills `None` / `Daily` / `Weekly` / `Monthly`. When active, shows interval input ("Every ___ weeks") and optional end date
- **Assignee:** Horizontal avatar row (same component as reminders)
- **Submit:** "Add event" button

### Edit Event Bottom Sheet

Same layout, pre-filled. For recurring events: edits apply to the base event (all occurrences). No per-occurrence exceptions in v1.

## Recurrence Expansion Logic

Client-side `expandRecurrences(events, rangeStart, rangeEnd)` generates occurrences:

- `daily` + interval N: every N days from `start_time`
- `weekly` + interval N: every N weeks, same weekday
- `monthly` + interval N: every N months, anchored to day-of-week position (e.g., 2nd Tuesday). Skip if month lacks that position.
- `yearly` + interval N: every N years, same month+day

Each occurrence carries `{ ...event, occurrenceDate, occurrenceStart, occurrenceEnd }` with the original event ID for edit/delete.

Recurrence stops at `recurrence_end` if set, otherwise capped at visible range.

**Delete:** Deletes the base record (all occurrences disappear). No single-occurrence deletion in v1.

**Edit:** Applies to base event. No per-occurrence exceptions in v1.

## Design Decisions

- **Separate table** over unified tasks+events: clean separation, events have time-based fields that don't belong on tasks
- **Client-side recurrence expansion** over server-side occurrence rows: no row explosion, simple data model, easy to query
- **Week view default** over month/day: best mobile balance of context vs detail
- **Bottom sheet creation** over full-screen form: consistent with reminders UX, stays in calendar context
- **Quick-pick chips** for time/duration: fast common-case entry, custom fallback for edge cases
- **No occurrence exceptions in v1**: keeps data model and logic simple, can add later
