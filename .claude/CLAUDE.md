# Nesto

Self-hosted household management app. Mobile-first SPA with bold/vibrant design.

## Tech Stack

**Backend:** FastAPI, SQLAlchemy 2.0 (async), aiosqlite, Alembic, PyJWT, httpx, Pydantic Settings
**Frontend:** React 19, TypeScript, TanStack Router (file-based), TanStack Query, Zustand, Tailwind CSS v4, Framer Motion, oidc-client-ts
**Auth:** OIDC via Authentik with JWT/JWKS validation, refresh tokens (offline_access)
**Infra:** Docker Compose, SQLite (WAL mode), nginx reverse proxy, GitHub Actions CI, GHCR images

## Project Structure

```
backend/app/
  main.py          # FastAPI app, CORS, router registration
  config.py        # Pydantic Settings with validators
  database.py      # Async SQLAlchemy engine, session, SQLite pragmas
  auth.py          # JWT decode via PyJWKClient, user auto-upsert
  models/          # SQLAlchemy ORM (user, household, task, event, shopping_list)
  schemas/         # Pydantic request/response models with validation
  routers/         # API routes: /api/auth, /api/households, /api/households/{id}/tasks, /api/households/{id}/events, /api/households/{id}/members, /api/households/{id}/lists
  services/        # Business logic (user_service, household_service, task_service, event_service, shopping_list_service, digest_service)
backend/alembic/   # Async migrations
backend/tests/     # pytest-asyncio tests

frontend/src/
  routes/          # TanStack Router file-based routes (__root, index, login, callback, tasks, onboarding, settings, calendar, lists, lists.$listId)
  api/             # apiFetch client with token refresh + session expiry, React Query hooks per domain
  auth/            # OIDC config and provider
  components/      # ui/ (Button, Card, Input, Avatar, Fab, PriorityDot), layout/ (bottom-nav), tasks/ (task-card, create-task-sheet, edit-task-sheet), calendar/ (week-strip, event-card, create-event-sheet, edit-event-sheet), lists/ (list-card, create-list-sheet, edit-list-sheet)
  stores/          # Zustand stores (auth-store, theme-store)
  utils/           # recurrence.ts (client-side recurring event expansion)
  styles/          # Tailwind CSS v4 theme with light/dark mode
```

## Running

```bash
cp .env.example .env   # Fill in OIDC + SECRET_KEY
docker compose up      # Dev: backend:8000, frontend:5173
docker compose -f docker-compose.prod.yml up  # Prod: nginx:8080 (prebuilt images from GHCR)
```

## Production Architecture

Prod uses prebuilt multi-arch images from `ghcr.io/janvanerven/nesto/{backend,frontend,nginx}:latest`, built by GitHub Actions on push to main. No source checkout needed on the deploy server — just `docker-compose.prod.yml` + `.env`.

- **frontend** — serves static dist files via its own nginx, generates `/config.js` at container startup from env vars (`OIDC_ISSUER_URL`, `OIDC_CLIENT_ID`, `OIDC_REDIRECT_URI`) via `docker-entrypoint.sh`
- **nginx** — reverse proxy with security headers and rate limiting; proxies `/api/` to backend, everything else to frontend
- **backend** — FastAPI app

OIDC config is injected at runtime via `window.__NESTO_CONFIG__` (set by `/config.js`), with fallback to `import.meta.env.VITE_*` for dev mode. This allows the same frontend image to work across environments.

## Key Conventions

- **File naming:** kebab-case for frontend files, snake_case for Python
- **Imports:** `@/` alias for `frontend/src/`
- **API routes:** All prefixed with `/api/`
- **Auth:** All protected endpoints use `Depends(get_current_user_id)` which auto-upserts the user
- **IDs:** Text/UUID strings, generated with `uuid.uuid4()`
- **Task updates:** Explicit field allowlist (`_UPDATABLE_FIELDS`), no mass-assignment
- **Invite codes:** Single-use, deleted after consumption, 7-day expiry
- **Token refresh:** API client deduplicates concurrent refresh calls; redirects to OIDC login on session expiry
- **Queries:** React Query hooks gate on `hasToken()` to avoid pre-auth 401s
- **UI terminology:** "Reminders" in UI (backed by `tasks` table in DB)
- **Font:** Outfit (Google Fonts, variable weight 300-700)
- **Dark mode:** System preference by default, manual toggle in settings, stored in localStorage (`nesto-theme`)
- **Onboarding:** First name step → household create/join. First name stored on user model.

## Testing

```bash
cd backend && pytest tests/  # asyncio_mode = "auto"
```

## Security Notes

- SECRET_KEY validated at startup (min 32 chars)
- CORS restricted to specific methods/headers
- Containers run as non-root (appuser/node, nginxinc/nginx-unprivileged)
- OpenAPI docs disabled in production
- nginx has security headers (CSP, X-Frame-Options, etc.), rate limiting (20r/s + burst 40), and request size limits
- Assigned_to validated against household membership before accepting
- .env is gitignored; .env.example has no real secrets

## Database

SQLite with WAL mode, async via aiosqlite. Tables: users, households, household_members, household_invites, tasks, events, shopping_lists, shopping_items. Alembic for migrations. Indexes on all FK/filter columns.

User model includes: id, email, display_name, first_name (nullable), avatar_url, created_at, last_login, email_digest_daily, email_digest_weekly.

Automated daily backup service copies DB to `./backups/` with 7-day retention.

## API Endpoints

- `GET/PATCH /api/auth/me` — Current user info / update first_name
- `GET/POST /api/households` — List/create households
- `POST /api/households/join` — Join via invite code
- `POST /api/households/{id}/invite` — Generate invite code
- `GET /api/households/{id}/members` — List household members
- `GET/POST /api/households/{id}/tasks` — List/create tasks (reminders)
- `PATCH/DELETE /api/households/{id}/tasks/{taskId}` — Update/delete task
- `GET/POST /api/households/{id}/events` — List/create events (with date range filter)
- `PATCH/DELETE /api/households/{id}/events/{eventId}` — Update/delete event
- `GET/POST /api/households/{id}/lists` — List/create shopping lists
- `PATCH/DELETE /api/households/{id}/lists/{listId}` — Update/delete list
- `POST /api/households/{id}/lists/{listId}/complete` — Archive list + check all items
- `GET/POST /api/households/{id}/lists/{listId}/items` — List/add items
- `PATCH/DELETE /api/households/{id}/lists/{listId}/items/{itemId}` — Update/delete item

## Environment Variables

OIDC: `OIDC_ISSUER_URL`, `OIDC_CLIENT_ID`, `OIDC_REDIRECT_URI` (shared by backend + frontend; injected at runtime in prod via config.js, via VITE_ env vars in dev)
Backend: `SECRET_KEY`, `DATABASE_URL`, `CORS_ORIGINS`, `ENVIRONMENT`
SMTP (optional): `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`, `SMTP_USE_TLS`
