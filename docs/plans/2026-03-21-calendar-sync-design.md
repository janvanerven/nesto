# Calendar Sync Design

**Date:** 2026-03-21
**Status:** Approved

## Overview

Add calendar sync to Nesto with two capabilities:
- **Export:** Per-user .ics subscription feed that external calendar apps (Apple Calendar, Google Calendar, etc.) can subscribe to
- **Import:** CalDAV client that polls external calendars (iCloud, Nextcloud, any CalDAV server) and displays events read-only in Nesto

Events are managed at their source — Nesto events are edited in Nesto, external events are edited in their external app. No bidirectional editing.

## Approach

**.ics subscription feed + CalDAV client** (Approach 2 from brainstorming)

- Export via a token-authenticated .ics URL that any calendar app can subscribe to
- Import via the `caldav` Python library polling external CalDAV servers every 5 minutes
- External events displayed mixed into the calendar view, visually distinguished as read-only with source attribution

## Data Model

### New table: `calendar_connections`

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | UUID |
| `user_id` | TEXT FK → users | Who owns this connection |
| `household_id` | TEXT FK → households | Which household it feeds into |
| `name` | TEXT | Display name (e.g. "Jan's iCloud Work") |
| `provider` | TEXT | "icloud", "nextcloud", "caldav" (UI hints/icons only, no code branching) |
| `server_url` | TEXT | CalDAV server base URL |
| `calendar_url` | TEXT | Specific calendar collection URL |
| `username` | TEXT | CalDAV username |
| `encrypted_password` | TEXT | Fernet-encrypted password (HKDF-derived key) |
| `color` | TEXT | Hex color for events from this source |
| `sync_token` | TEXT nullable | Server's sync token for incremental sync |
| `last_synced_at` | DATETIME nullable | Last successful sync |
| `enabled` | BOOLEAN | Toggle sync on/off |
| `error_count` | INTEGER default 0 | Consecutive sync failures |
| `last_error` | TEXT nullable | Most recent error message |
| `created_at` | DATETIME | |

### New table: `external_events`

Separate from `events` — read-only imported events.

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | UUID (internal) |
| `connection_id` | TEXT FK → calendar_connections | Source calendar |
| `caldav_uid` | TEXT | iCalendar UID from source |
| `caldav_etag` | TEXT | ETag for change detection |
| `caldav_href` | TEXT | Resource URL on CalDAV server |
| `title` | TEXT | |
| `description` | TEXT nullable | |
| `start_time` | DATETIME | |
| `end_time` | DATETIME | |
| `all_day` | BOOLEAN | |
| `location` | TEXT nullable | |
| `recurrence_rule` | TEXT nullable | Raw RRULE string from iCalendar (preserved as-is) |
| `timezone` | TEXT nullable | Olson timezone ID for DST correctness |
| `raw_ical` | TEXT nullable | Full VEVENT blob, capped at 64KB |
| `created_at` | DATETIME | |
| `updated_at` | DATETIME | |

### Modified table: `household_members`

Add column:
- `feed_token` TEXT nullable UNIQUE — long random string for .ics subscription URL

## Backend Architecture

### Export: .ics Feed

- **Endpoint:** `GET /api/calendar/feed/{token}.ics` — no OIDC auth, token-authenticated
- Queries events where user is assigned OR event is unassigned
- Serializes to iCalendar format via `icalendar` library
- Includes `VTIMEZONE` components for non-UTC events
- Stable UIDs: `{event.id}@nesto`
- Simple recurrence model mapped directly to RRULE (daily/weekly/monthly/yearly map 1:1)
- Headers: `Content-Type: text/calendar`, appropriate `Cache-Control`

### Import: CalDAV Sync Service

**New file:** `backend/app/services/calendar_sync_service.py`

- Uses `caldav` library (synchronous) wrapped in `asyncio.to_thread()`
- **Sync flow per connection:**
  1. Connect to CalDAV server with stored credentials
  2. If `sync_token` exists: request changes since token (incremental)
  3. If no `sync_token` or token rejected (410 Gone): clear token first, then full sync
  4. For each VEVENT (filter out VTODO/VJOURNAL): parse with `icalendar`, upsert into `external_events` matched on `caldav_uid`
  5. For deleted events: remove from `external_events`
  6. Store new `sync_token` and `last_synced_at` atomically at end of successful sync
  7. On success: reset `error_count` to 0
  8. On failure: increment `error_count`, store `last_error`, log exception
  9. After 10 consecutive failures: auto-disable connection
- Batch upserts: single DB transaction per calendar
- `raw_ical` capped at 64KB — skip blob if larger, structured fields still stored

### Background Scheduler

- Plain `asyncio.Task` started on FastAPI `lifespan` startup (no APScheduler)
- Runs every 5 minutes via `asyncio.sleep(300)` loop
- Fetches all enabled `calendar_connections`, syncs each sequentially
- Single-instance guard via `asyncio.Lock` — skip run if previous still in progress
- Errors per connection logged but don't crash the loop
- Cancelled on shutdown

### External Events API

- `GET /api/households/{id}/external-events?start=...&end=...` — returns pre-expanded occurrences
  - Recurring events expanded server-side using `dateutil.rrule` for the requested date window
  - Response is flat list with concrete `start_time`/`end_time` per occurrence
  - Includes `source_calendar_name`, `source_calendar_color`, `provider` fields

### Connection Management API (OIDC-authenticated)

- `GET /api/calendar/connections` — list user's connections
- `POST /api/calendar/connections` — add connection (validates credentials against CalDAV server on creation)
- `PATCH /api/calendar/connections/{id}` — update name, color, enabled
- `DELETE /api/calendar/connections/{id}` — remove connection + all its external_events
- `POST /api/calendar/connections/{id}/sync` — trigger immediate sync
- `GET /api/calendar/feed-token` — get or create user's feed token + URL
- `POST /api/calendar/feed-token/regenerate` — replace token (old one invalidated immediately)

### CalDAV Connection Flow (v1 — simplified)

User provides CalDAV URL directly (no auto-discovery in v1). Backend validates credentials on creation. Auto-discovery can be added later if users struggle with finding URLs.

### New Dependencies

- `caldav` — CalDAV client library
- `icalendar` — iCalendar serialization/parsing
- `cryptography` — Fernet encryption + HKDF key derivation

## Frontend Integration

### New API File: `frontend/src/api/calendar-connections.ts`

Hooks following existing patterns (one file per domain, typed interfaces, query keys `[domain, householdId, ...]`):

- `useCalendarConnections(householdId)` — list connections
- `useExternalEvents(householdId, start, end)` — pre-expanded occurrences
- `useCreateCalendarConnection(householdId)` — mutation
- `useUpdateCalendarConnection(householdId)` — mutation
- `useDeleteCalendarConnection(householdId)` — mutation
- `useTriggerSync(householdId)` — mutation
- `useFeedToken(householdId)` — query
- `useRegenerateFeedToken(householdId)` — mutation

### Calendar View Changes (`routes/calendar.tsx`)

- Call `useEvents` and `useExternalEvents` independently
- Separate types: `EventOccurrence` (native) and `ExternalEventOccurrence` (external, with `source_calendar_name`, `source_calendar_color`, `provider`)
- Merge into discriminated union `CalendarOccurrence = { type: 'native'; ... } | { type: 'external'; ... }` at render time
- External events don't block calendar rendering — appear silently when loaded
- Combined occurrences passed to `WeekStrip` for dot indicators

### New Component: `components/calendar/external-event-card.tsx`

- Read-only — no onClick that opens edit sheet
- Left border color from connection's configured color
- Small badge showing source calendar name + provider icon
- Tapping shows a read-only detail view or toast: "Managed in {source}"

### Settings UI

**`CalendarSyncSection`** added as local function in `routes/settings.tsx` between Notifications and Appearance, following existing `<Card className="mb-4">` pattern:

- **Connected calendars list:** colored dot, name, provider label, last-synced time, error state, enabled `ToggleRow`, "Sync now" ghost button, delete with `confirmDelete` pattern
- **"Add Calendar" button:** opens `AddCalendarSheet`
- **ICS subscription section:** feed URL in monospace box (invite code style), copy button, regenerate with confirm

### New Component: `components/calendar/add-calendar-sheet.tsx`

Bottom sheet following existing sheet pattern. Three steps:

1. **Server + credentials:** CalDAV URL, username, password. Provider hint pills (iCloud / Nextcloud / Other) that pre-fill URL and show iCloud app-specific password guidance
2. **Validation:** backend validates credentials, shows success/error
3. **Name + color:** display name input, 6-8 color swatches as selectable circles

### No New Frontend Dependencies

RRULE expansion handled server-side. No `rrule.js` or timezone library needed.

## Security

### Credential Storage

- HKDF key derivation from SECRET_KEY: `HKDF(SHA256, 32, salt=b"nesto-caldav", info=b"credential-encryption")`
- Fernet symmetric encryption for stored passwords
- Decryption failure (SECRET_KEY rotated): connection marked errored, UI prompts "re-enter your CalDAV password"
- Credentials accepted via POST only, never in query params
- HTTPS enforced for all CalDAV connections

### Feed Token

- 64-char token via `secrets.token_urlsafe`
- URL: `/api/calendar/feed/{token}.ics`
- Regeneration replaces old token immediately
- Tokens appear in server logs (unavoidable, standard for calendar subscriptions)

### Transport

- All CalDAV connections over HTTPS — reject plain HTTP
- TLS certificate validation enabled (no `verify=False`)

## Operations

### Failure Modes

| Scenario | Behavior |
|---|---|
| Bad credentials | Validation on create; error state + "re-enter password" on decrypt failure |
| Server unreachable | Logged, error_count incremented, next run retries |
| Stale sync token (410) | Clear token, full re-sync, new token stored |
| App restart mid-sync | Re-syncs from last good token on next run |
| SECRET_KEY rotation | Stored passwords unreadable, connections error, UI prompts re-entry |
| Feed token leak | User regenerates token, old one invalidated |
| Oversized iCal blobs | Blob skipped, structured fields still imported |
| 10+ consecutive failures | Connection auto-disabled, user notified in settings |

### SQLite Considerations

- WAL mode handles concurrent reads (API) + writes (sync) without issue
- `busy_timeout` pragma verified on sync service sessions
- Batch upserts: single transaction per calendar sync

### Sync Behavior

- Polling interval: every 5 minutes
- Sequential per connection (sufficient for household scale)
- Single-instance guard prevents overlapping runs
- `sync_token` + `last_synced_at` updated atomically at end of successful sync only

## Design Decisions

| Decision | Rationale |
|---|---|
| Separate `external_events` table | Clean read-only contract, easy cascade delete, no pollution of events model |
| Raw RRULE preserved | Avoids lossy conversion; expanded server-side for API responses |
| Server-side RRULE expansion | Eliminates ~30KB frontend dependency + timezone complexity |
| Plain asyncio.Task (not APScheduler) | Zero extra deps for a single sleep loop |
| No CalDAV auto-discovery in v1 | Users paste URL directly; add discovery later if needed |
| Feed token on household_members | One token per user-household, no extra table needed |
| `provider` column is UI-only | No code branching — iCloud and Nextcloud are just CalDAV |
| Last-write-wins (remote wins) | Conflict resolution is irrelevant — events managed at source |
| Sequential sync per connection | Sufficient for household scale, simpler error isolation |
