# Multi-Day All-Day Events

## Summary

Add support for all-day events that can span multiple days (vacations, trips, holidays). Multi-day events appear in the event list for every day they span.

## Data Model

Add `all_day: bool` column to the `events` table (default `false`). When `true`, `start_time` represents the start date and `end_time` the last date (time portions ignored). No new tables needed.

## Backend Changes

- Add `all_day` boolean to Event model, schemas (create/update/response), and an Alembic migration.
- Event query for date range filtering already uses `start_time`/`end_time` overlap, so multi-day events within range will be returned.

## Frontend Changes

### Create/Edit Event Sheets
- Add "All day" toggle pill at the top of the form.
- When toggled on: hide time/duration pickers, show end date picker (defaults to start date for single-day all-day events).
- When toggled off: existing behavior.

### Calendar Day List (`calendar.tsx`)
- Change day filtering from exact `occurrenceStart` day match to checking if `selectedDate` falls within `[occurrenceStart, occurrenceEnd]` range.
- All-day events sort before timed events.

### Recurrence Expansion (`recurrence.ts`)
- No structural changes needed — duration-based expansion already works. The day filtering change in the calendar handles display.

### Event Card
- All-day events show "All day" instead of time range.
- Multi-day all-day events additionally show context like "ends Mar 3" or day position.

### Week Strip
- Multi-day events produce dots on each day they span (already works via occurrence overlap filtering).

### Dashboard Upcoming
- All-day events show date label without time.

## Non-Goals

- Timed multi-day events (e.g., "10:00 Feb 28 to 18:00 Mar 2") — only all-day spans for now.
- Visual spanning bars across the week strip.
