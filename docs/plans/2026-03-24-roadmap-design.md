# Nesto Roadmap — Notifications & Household Communication

**Date:** 2026-03-24
**Status:** Approved

## Problem

Nesto is silent and one-way. The app doesn't remind users of upcoming tasks and events, and household members have no way to communicate through it — coordination still happens in WhatsApp alongside Nesto. This limits daily engagement and prevents the app from becoming the household's single operating system.

## Goals

- Make Nesto speak: surface due tasks and events before they're missed
- Make Nesto a communication layer: give the household a lightweight shared space that replaces the "hey can you grab milk" WhatsApp messages
- Build notification infrastructure once that all future features can leverage

## Non-Goals

- Real-time chat or messaging
- Native mobile app (PWA is sufficient for v1)
- iOS Web Push (defer — requires extra Apple entitlements)
- Per-task notification customisation (v1 uses a single lead time)
- Rich text, media attachments, or reactions in notice board/comments (v1)

---

## Phase 1 — Email Reminders + Household Notice Board

### Email Reminders

**Scheduler:** A new background task in `main.py` runs every 15 minutes alongside the existing digest scheduler. It queries tasks and events due within 1 hour that have not yet had a reminder sent.

**Deduplication:** Add `reminder_sent_at` (nullable datetime) to both `tasks` and `events` tables. One Alembic migration. The scheduler stamps this field after sending to prevent repeat emails.

**User preferences:** Two new boolean columns on `users`: `reminders_tasks` and `reminders_events` (both default `true`). Exposed in Settings under a "Notifications" section, alongside existing digest toggles.

**Email format:** Short and direct — "Your task 'Buy filters' is due in 1 hour." Single call to action. Reuses existing SMTP infrastructure from `digest_service.py`.

**Out of scope for v1:** Per-task opt-out, custom lead time per task, SMS.

### Household Notice Board

**What it is:** A lightweight shared message board — not a chat. Newest posts first. Household-wide. No threading.

**Database:** New `household_notices` table:

| Column | Type | Notes |
|---|---|---|
| `id` | Text (UUID) | Primary key |
| `household_id` | Text | FK → households |
| `author_id` | Text | FK → users |
| `content` | Text | Max 500 chars |
| `pinned` | Boolean | Default false |
| `created_at` | DateTime | |

**API:**

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/households/{id}/notices` | List notices (newest first, pinned floated) |
| `POST` | `/api/households/{id}/notices` | Create a notice |
| `PATCH` | `/api/households/{id}/notices/{noticeId}` | Toggle pinned |
| `DELETE` | `/api/households/{id}/notices/{noticeId}` | Delete (any member) |

**UI:** A "Notice Board" card on the home/dashboard screen above the Reminders section. Shows 3 most recent notices. "Post a note" opens a bottom sheet with a plain text area (no rich text). Tapping the card expands to the full list.

**Out of scope for v1:** Real-time updates (pull-to-refresh is fine), push notifications for new posts (Phase 2), media attachments.

---

## Phase 2 — PWA Push Notifications

**Infrastructure:** Web Push API with VAPID key pair. Keys generated once and stored in environment config. Frontend requests notification permission on first use and registers a push subscription with the backend.

**Database:** New `push_subscriptions` table:

| Column | Type | Notes |
|---|---|---|
| `id` | Text (UUID) | Primary key |
| `user_id` | Text | FK → users |
| `endpoint` | Text | Browser push endpoint |
| `p256dh` | Text | Browser public key |
| `auth` | Text | Auth secret |
| `created_at` | DateTime | |

One user can have multiple subscriptions (phone + desktop).

**Service worker:** Minimal `sw.js` registered by the frontend. Handles `push` events and displays the notification. No offline caching in v1.

**Triggers:**

| Event | Trigger |
|---|---|
| Task due in ~1 hour | Existing 15-min scheduler (Phase 1) |
| Event starting in ~1 hour | Existing 15-min scheduler (Phase 1) |
| New notice posted | Notice creation endpoint |

**Backend:** New `push_service.py` wrapping `pywebpush`. Called from the scheduler and from the notice creation endpoint.

**User preferences:** Extend the Phase 1 notifications settings section with a "Browser notifications" toggle. Falls back to email only if denied.

**Out of scope for v1:** iOS Safari Web Push, notification grouping/batching, in-app notification history.

---

## Phase 3 — Comments + @mentions

**Comments:**

New `task_comments` table and `event_comments` table:

| Column | Type |
|---|---|
| `id` | Text (UUID) |
| `task_id` / `event_id` | Text (FK) |
| `author_id` | Text (FK → users) |
| `content` | Text |
| `created_at` | DateTime |

Surfaced as a collapsible section at the bottom of the task/event edit sheet. Chronological, no threading.

**@mentions:** Parsed client-side during composition (`@` triggers member autocomplete). Stored as plain text. On save, the backend parses mentioned user IDs and fires a push notification via Phase 2 infrastructure: "Jan mentioned you in 'Fix the boiler'."

**Out of scope for v1:** Edit/delete comments, reactions, rich text.

---

## Sequencing Summary

| Phase | Features | Key Deliverables |
|---|---|---|
| **1** | Email reminders + Notice board | `reminder_sent_at` migration, 15-min scheduler, notices table + API + UI |
| **2** | PWA push notifications | VAPID setup, service worker, `push_subscriptions` table, `push_service.py` |
| **3** | Comments + @mentions | `task_comments` + `event_comments` tables, comment UI, @mention parsing + push |

Each phase is independently shippable. Phase 2 is the enabling infrastructure that makes Phase 3 notifications free.

---

## Success Metric

Every adult in the household opens Nesto at least once a day without being prompted by someone else.
