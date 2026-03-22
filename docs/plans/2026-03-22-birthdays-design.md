# Birthdays Feature Design

## Overview

Add birthday tracking to Nesto — a household-shared list of birthdays that appear on the calendar and in the ICS feed. Accessible from the More tab with a dedicated management page.

## Data Model

`birthdays` table:

| Column | Type | Notes |
|--------|------|-------|
| id | Text (UUID) | PK |
| household_id | Text | FK → households, CASCADE, indexed |
| person_name | Text | Required, max 200 chars |
| birth_month | Integer | 1–12 |
| birth_day | Integer | 1–31 |
| birth_year | Integer | Nullable, optional year of birth |
| created_by | Text | FK → users |
| created_at | DateTime | server default |
| updated_at | DateTime | server default + onupdate |

Separate `birth_month` + `birth_day` integers avoid needing a dummy year when birth year is unknown and simplify "upcoming" queries.

## API

CRUD at `/api/households/{household_id}/birthdays`:

- `GET /` — list all birthdays, with computed `age` field (nullable). No date-range filtering needed — the list is always small (household-scoped) and the frontend filters client-side for calendar display.
- `POST /` — create birthday
- `PATCH /{birthdayId}` — update birthday
- `DELETE /{birthdayId}` — delete birthday

Response schema includes a computed `age` field: current age if `birth_year` is set, `null` otherwise. On the birthday date itself, this reflects the age they are turning.

## Calendar Integration

- Frontend calendar page fetches all household birthdays and filters client-side to the selected date.
- Birthdays render as all-day event cards with a cake icon and distinct color.
- Tapping a birthday on the calendar opens an edit-birthday sheet.

## ICS Feed

The existing feed at `/api/calendar/feed/{token}.ics` adds birthday VEVENTs:

- `RRULE:FREQ=YEARLY`
- `DTSTART` uses birth_year if known, otherwise 2000 (a leap year, to avoid ValueError on Feb 29)
- `DTEND` = `DTSTART + 1 day` (required by RFC 5545 for all-day events)
- Summary format: `🎂 {name}'s Birthday` or `🎂 {name}'s Birthday (born {year})` — uses static birth year, not "turns N", to avoid stale age in cached feeds

## Frontend

### Birthdays List Page (`/birthdays`)

Under More tab. Shows all household birthdays sorted by next upcoming date. Each card displays: person name, date (e.g., "March 15"), and age info if birth_year is known (e.g., "Turns 30"). Fab button to add. Create/edit bottom sheets with fields: name, month, day, birth year (optional).

### Calendar View Changes

Merge birthday data with events for display. Birthday cards have distinct styling (cake icon, warm color). Tap opens edit-birthday sheet.

### More Tab

Add "Birthdays" entry with cake icon.

## Decisions

- **Standalone table** (not reusing events) — birthdays have different fields and semantics (always yearly, no time, person-centric).
- **Month/day integers** (not a Date column) — avoids dummy year, simplifies range queries.
- **Server-computed age** — single source of truth, accounts for date correctly. Known limitation: timezone drift around midnight UTC may briefly show wrong age label for users in far-offset timezones.
- **Leap year handling** — Feb 29 allowed without birth_year (leap day birthdays exist). Feb 29 with a non-leap birth_year is rejected. ICS feed uses year 2000 as reference (a leap year).
- **Cross-field validation on PATCH** — service validates the merged month/day/year after applying partial updates, since the schema can't validate partial fields in isolation.
