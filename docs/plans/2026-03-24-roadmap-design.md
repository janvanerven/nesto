# Nesto Roadmap — Notifications & Household Communication

**Date:** 2026-03-24
**Status:** Approved + reviewed by architect and UX

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

**Scheduler:** A new background task in `main.py` runs every 15 minutes alongside the existing digest scheduler.

**Recipient logic:**
- Tasks: notify `assigned_to` if set, otherwise `created_by`
- Events: notify all household members (events are inherently shared)

**Timing:**
- Events: send reminder ~1 hour before `start_time` (events store a full datetime)
- Tasks: send reminder on the morning of `due_date` (tasks store a date only — "1 hour before" is meaningless)

**Deduplication:** Use a `reminders_sent` table instead of a column on the task/event row. This correctly handles recurring items — a reminder is keyed by `(entity_type, entity_id, occurrence_date)`, not just the entity. Stamp the row *before* sending (prevents double-send on crash; a missed send is preferable to a duplicate).

```
reminders_sent: id, entity_type, entity_id, occurrence_date, channel, sent_at
```

Add a cleanup job (or rolling delete) for rows older than 30 days.

**User preferences:** Two new boolean columns on `users`: `reminders_tasks` and `reminders_events` (both default `true`). Exposed in Settings under "Alerts & Reminders", alongside existing digest toggles. Labels: "Task reminders (morning of due date)" and "Event reminders (1 hour before)".

**Email format:** Short and direct. Reuses existing SMTP infrastructure from `digest_service.py`.

**Timezone:** Add `timezone` (text, IANA format, e.g. `"Europe/Amsterdam"`) to the `households` table. The scheduler converts "now" to the household's timezone before comparing. Without this, reminders will be wrong for any household not in UTC.

**Out of scope for v1:** Per-task opt-out, custom lead time, SMS.

### Household Notice Board

**What it is:** A lightweight shared message board — not a chat. Newest posts first. Household-wide. No threading. Max 500 chars per post.

**Database:** New `household_notices` table:

| Column | Type | Notes |
|---|---|---|
| `id` | Text (UUID) | Primary key |
| `household_id` | Text | FK → households |
| `author_id` | Text | FK → users |
| `content` | Text | Max 500 chars |
| `pinned` | Boolean | Default false |
| `created_at` | DateTime | |
| `updated_at` | DateTime | Nullable — set when content is edited |

**API:**

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/households/{id}/notices` | List notices (pinned first, then newest); paginated (limit/offset) |
| `POST` | `/api/households/{id}/notices` | Create a notice |
| `PATCH` | `/api/households/{id}/notices/{noticeId}` | Edit content (author only) or toggle pinned (any member) |
| `DELETE` | `/api/households/{id}/notices/{noticeId}` | Delete (author or household admin only) |

**UI placement:** Notice board gets its own tab in the bottom nav (between Lists and More), not a dashboard card. This keeps the dashboard focused on actionable time-sensitive content (reminders + upcoming events) and gives communication its own dedicated space.

**Dashboard integration:** Small unread indicator on the Notice Board nav tab showing count of posts since last viewed (stored in localStorage).

**Compose:** FAB on the notice board screen opens a bottom sheet with a growing textarea. Live character counter shown when >400 chars typed (e.g. "423 / 500", orange at 450+, red at 500). Posting dismisses the sheet and shows a brief success toast.

**Empty state:** "No notes yet" with a CTA to post the first note.

**Permission to delete:** Author can delete their own posts. Household admin (creator) can delete any post.

**Out of scope for v1:** Real-time updates (pull-to-refresh is fine), push notifications for new posts (Phase 2), media attachments, pinned post auto-expiry.

---

## Phase 2 — PWA Push Notifications

**Infrastructure:** Web Push API with VAPID key pair. `VAPID_PRIVATE_KEY` and `VAPID_PUBLIC_KEY` stored in environment config. Public key exposed to the frontend via the existing runtime `config.js` (consistent with the OIDC pattern — no new endpoint needed).

**Database:** New `push_subscriptions` table:

| Column | Type | Notes |
|---|---|---|
| `id` | Text (UUID) | Primary key |
| `user_id` | Text | FK → users |
| `endpoint` | Text | Browser push endpoint |
| `p256dh` | Text | Browser public key |
| `auth` | Text | Auth secret |
| `created_at` | DateTime | |
| `last_used_at` | DateTime | Updated on successful delivery |

One user can have multiple subscriptions (phone browser + desktop browser). Handle 410 Gone responses from push services by deleting the subscription row. Prune subscriptions with `last_used_at` older than 90 days.

**Service worker:** `sw.js` in `public/` (served from root scope). Handles `push` events and displays the notification. No offline caching in v1. Ensure `Content-Type: application/javascript` and correct `Service-Worker-Allowed` header in nginx config.

**CSP:** Add push service domains to `connect-src` in nginx security headers (`fcm.googleapis.com`, `updates.push.services.mozilla.com`).

**Triggers:**

| Event | Trigger |
|---|---|
| Task due on morning of due date | 15-min scheduler (Phase 1) |
| Event starting in ~1 hour | 15-min scheduler (Phase 1) |
| New notice posted | Notice creation endpoint — fired via `asyncio.create_task` (non-blocking) |

**Backend:** New `push_service.py` wrapping `pywebpush`. All push sends from the notice endpoint are fired as background tasks to avoid blocking the API response.

**Permission UX:** Do NOT request push permission on app load or login. Ask only when the user explicitly enables "Browser notifications" in Settings. Show a pre-permission explanation sheet before the browser native prompt. Handle all three outcomes gracefully (granted / denied / dismissed). Store a "last dismissed" timestamp in localStorage; don't re-prompt for 7 days on dismiss.

**User preferences:** Extend Phase 1 notifications settings section with a "Browser notifications" toggle. Falls back to email-only if denied or unavailable.

**Notification copy:**
- Task reminder: "Buy filters — due today"
- Event reminder: "Dinner with parents — starts in 1 hour"
- New notice: "Jan posted on the notice board" (don't quote content — drives the open)

Tapping a notification deep-links directly to the task/event/notice board, not the dashboard.

**Out of scope for v1:** iOS Safari Web Push, notification grouping/batching, in-app notification history/inbox.

---

## Phase 3 — Comments + @mentions

**Comments:** Single `comments` table (polymorphic association, not two separate tables):

| Column | Type | Notes |
|---|---|---|
| `id` | Text (UUID) | Primary key |
| `entity_type` | Text | `"task"` or `"event"` |
| `entity_id` | Text | FK (validated in service layer) |
| `author_id` | Text | FK → users |
| `content` | Text | |
| `created_at` | DateTime | |

Index on `(entity_type, entity_id, created_at)`. Include `DELETE` endpoint from day one — author can delete their own comment.

Comments surface as a dedicated full-screen modal/route (e.g. `/tasks/:taskId/comments`), not a collapsible section inside the edit sheet. This avoids the keyboard-overlap problem on mobile.

**@mentions:** Client sends `content` as plain text plus a separate `mentions: string[]` array of user IDs (populated by the autocomplete selection — don't parse @names from prose). Backend validates each mentioned user is a household member, then fires push notifications via Phase 2 infrastructure.

**Out of scope for v1:** Edit comments, reactions, rich text.

---

## Sequencing Summary

| Phase | Features | Key Deliverables |
|---|---|---|
| **1** | Email reminders + Notice board | `reminders_sent` table, `household_notices` table + API + UI, 15-min scheduler, `timezone` on household |
| **2** | PWA push notifications | VAPID setup, `sw.js`, `push_subscriptions` table, `push_service.py`, CSP + nginx updates |
| **3** | Comments + @mentions | `comments` table, comment modal, @mention `user_id[]` field + push |

Each phase is independently shippable. Phase 2 is the enabling infrastructure that makes Phase 3 notifications free.

---

## Success Metric

Every adult in the household opens Nesto at least once a day without being prompted by someone else.
