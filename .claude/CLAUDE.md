# Nesto

Self-hosted household management app. Mobile-first SPA with bold/vibrant design.

## Tech Stack

**Backend:** FastAPI, SQLAlchemy 2.0 (async), aiosqlite, Alembic, python-jose, httpx, Pydantic Settings
**Frontend:** React 19, TypeScript, TanStack Router (file-based), TanStack Query, Zustand, Tailwind CSS v4, Framer Motion, oidc-client-ts
**Auth:** OIDC via Authentik with JWT/JWKS validation, refresh tokens (offline_access)
**Infra:** Docker Compose, SQLite (WAL mode), nginx reverse proxy

## Project Structure

```
backend/app/
  main.py          # FastAPI app, CORS, router registration
  config.py        # Pydantic Settings with validators
  database.py      # Async SQLAlchemy engine, session, SQLite pragmas
  auth.py          # JWT decode, JWKS caching with asyncio.Lock, user auto-upsert
  models/          # SQLAlchemy ORM (user, household, task)
  schemas/         # Pydantic request/response models with validation
  routers/         # API routes: /api/auth, /api/households, /api/households/{id}/tasks
  services/        # Business logic (user_service, household_service, task_service)
backend/alembic/   # Async migrations
backend/tests/     # pytest-asyncio tests

frontend/src/
  routes/          # TanStack Router file-based routes (__root, index, login, callback, tasks, etc.)
  api/             # apiFetch client with token refresh, React Query hooks per domain
  auth/            # OIDC config and provider
  components/      # ui/ (Button, Card, Input, Avatar), layout/ (bottom-nav), tasks/
  stores/          # Zustand stores
```

## Running

```bash
cp .env.example .env   # Fill in OIDC + SECRET_KEY
docker compose up      # Dev: backend:8000, frontend:5173
docker compose -f docker-compose.prod.yml up  # Prod: nginx:8080
```

## Key Conventions

- **File naming:** kebab-case for frontend files, snake_case for Python
- **Imports:** `@/` alias for `frontend/src/`
- **API routes:** All prefixed with `/api/`
- **Auth:** All protected endpoints use `Depends(get_current_user_id)` which auto-upserts the user
- **IDs:** Text/UUID strings, generated with `uuid.uuid4()`
- **Task updates:** Explicit field allowlist (`_UPDATABLE_FIELDS`), no mass-assignment
- **Invite codes:** Single-use, deleted after consumption, 7-day expiry
- **Token refresh:** API client retries 401s with silent OIDC refresh
- **Queries:** React Query hooks gate on `hasToken()` to avoid pre-auth 401s

## Testing

```bash
cd backend && pytest tests/  # asyncio_mode = "auto"
```

## Security Notes

- SECRET_KEY validated at startup (min 32 chars)
- CORS restricted to specific methods/headers
- Containers run as non-root (appuser/node)
- OpenAPI docs disabled in production
- nginx has security headers + request limits
- .env is gitignored; .env.example has no real secrets

## Database

SQLite with WAL mode, async via aiosqlite. Tables: users, households, household_members, household_invites, tasks. Alembic for migrations.

## Environment Variables

Backend: `OIDC_ISSUER_URL`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `SECRET_KEY`, `DATABASE_URL`, `CORS_ORIGINS`, `ENVIRONMENT`
Frontend (VITE_): `VITE_OIDC_AUTHORITY`, `VITE_OIDC_CLIENT_ID`, `VITE_OIDC_REDIRECT_URI`
