# Nesto

Self-hosted household management app. Mobile-first PWA.

Manage your household's reminders, calendar, and shopping lists — all in one place. Invite family members, assign tasks, and stay organized together.

## Features

- **Reminders** — Create tasks with due dates, priorities, recurrence, and assignees
- **Calendar** — Week view with event management and recurring events (daily/weekly/monthly/yearly)
- **Shopping lists** — Collaborative lists with check-off, item attribution, and archival
- **Households** — Create or join households via invite codes, manage members
- **Email digests** — Optional daily and weekly summary emails (SMTP)
- **Dark mode** — System preference detection with manual override
- **PWA** — Installable on mobile, works standalone

## Tech Stack

| Layer | Stack |
|-------|-------|
| Backend | FastAPI, SQLAlchemy 2.0 (async), SQLite (WAL), Alembic, PyJWT |
| Frontend | React 19, TypeScript, TanStack Router, TanStack Query, Tailwind CSS v4, Framer Motion |
| Auth | OIDC via [Authentik](https://goauthentik.io/) with JWT/JWKS validation |
| Infra | Docker Compose, nginx reverse proxy |

## Prerequisites

- Docker and Docker Compose
- An [Authentik](https://goauthentik.io/) instance (or any OIDC provider)

## Setup

### 1. Configure Authentik

Create an **OAuth2/OpenID Provider** in Authentik:

1. Go to **Applications > Providers > Create** and choose **OAuth2/OpenID Provider**
2. Set **Client type** to **Public** (the SPA uses PKCE, no client secret needed)
3. Set the **Redirect URI** to `https://your-nesto-domain.com/callback`
4. Under **Advanced Protocol Settings**, ensure these scopes are included: `openid`, `email`, `profile`, `offline_access`
5. Create an **Application** and link it to the provider
6. Note down the **Client ID** and **Issuer URL** (found under the provider's OpenID Configuration URL, typically `https://auth.example.com/application/o/your-app/`)

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` with your values:

```env
# OIDC / Authentik (single provider, shared by backend + frontend)
OIDC_ISSUER_URL=https://auth.example.com/application/o/nesto/
OIDC_CLIENT_ID=your-client-id
OIDC_REDIRECT_URI=https://nesto.example.com/callback

# App
SECRET_KEY=          # Generate with: python -c "import secrets; print(secrets.token_urlsafe(64))"
DATABASE_URL=sqlite+aiosqlite:///./data/nesto.db
CORS_ORIGINS=["https://nesto.example.com"]
ENVIRONMENT=production

# SMTP for email digests (optional)
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=your-email@example.com
SMTP_PASSWORD=your-smtp-password
SMTP_FROM=nesto@example.com
```

### 3. Run

**Development** (hot reload, ports 8000 + 5173):

```bash
docker compose up
```

**Production** (nginx on port 8080):

```bash
docker compose -f docker-compose.prod.yml up -d
```

The production setup runs:
- **Backend** — FastAPI with auto-migration on startup
- **Frontend** — Static build served by nginx
- **nginx** — Reverse proxy on port 8080 with security headers (CSP, X-Frame-Options, etc.) and rate limiting
- **backup** — Daily SQLite backup with 7-day retention

### 4. Reverse proxy (recommended)

In production, put nginx behind a reverse proxy that handles TLS. Example with an external nginx or Caddy:

```nginx
server {
    listen 443 ssl;
    server_name nesto.example.com;

    ssl_certificate     /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
    }
}
```

Or with Caddy (automatic TLS):

```
nesto.example.com {
    reverse_proxy localhost:8080
}
```

## Container Images

Multi-arch Docker images (amd64 + arm64) are published to GitHub Container Registry on every push to `main`:

```
ghcr.io/janvanerven/nesto/backend:latest
ghcr.io/janvanerven/nesto/frontend:latest
```

To use pre-built images instead of building locally, replace the `build:` sections in `docker-compose.prod.yml` with:

```yaml
services:
  backend:
    image: ghcr.io/janvanerven/nesto/backend:latest
    # ...

  frontend:
    image: ghcr.io/janvanerven/nesto/frontend:latest
    # ...
```

## Project Structure

```
backend/
  app/
    main.py            # FastAPI app, CORS, background scheduler
    config.py          # Environment config with validation
    auth.py            # JWT/JWKS validation via PyJWT, user auto-upsert
    database.py        # Async SQLAlchemy + SQLite pragmas
    models/            # ORM models
    schemas/           # Pydantic request/response schemas
    routers/           # API routes
    services/          # Business logic
  alembic/             # Database migrations

frontend/
  src/
    routes/            # File-based routes (TanStack Router)
    api/               # API client + React Query hooks
    components/        # UI components (sheets, cards, nav)
    stores/            # Zustand stores (auth, theme)
    utils/             # Recurrence expansion
    styles/            # Tailwind theme (light/dark)

nginx/
  nginx.conf           # Production reverse proxy config
```

## API

All endpoints are prefixed with `/api/`. Protected routes require a Bearer token.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/auth/me` | Current user |
| PATCH | `/api/auth/me` | Update profile |
| GET | `/api/households` | List households |
| POST | `/api/households` | Create household |
| POST | `/api/households/join` | Join via invite code |
| POST | `/api/households/{id}/invite` | Generate invite code |
| GET | `/api/households/{id}/members` | List members |
| GET/POST | `/api/households/{id}/tasks` | List/create reminders |
| PATCH/DELETE | `/api/households/{id}/tasks/{taskId}` | Update/delete reminder |
| GET/POST | `/api/households/{id}/events` | List/create events |
| PATCH/DELETE | `/api/households/{id}/events/{eventId}` | Update/delete event |
| GET/POST | `/api/households/{id}/lists` | List/create shopping lists |
| PATCH/DELETE | `/api/households/{id}/lists/{listId}` | Update/delete list |
| POST | `/api/households/{id}/lists/{listId}/complete` | Archive list |
| GET/POST | `/api/households/{id}/lists/{listId}/items` | List/add items |
| PATCH/DELETE | `/api/households/{id}/lists/{listId}/items/{itemId}` | Update/delete item |
| GET | `/api/health` | Health check |

## Database

SQLite with WAL mode, managed via Alembic migrations. In production, migrations run automatically on container startup.

Data is stored in a Docker volume (`nesto-data`) mounted at `/app/data/`.

**Backup** — copy the database file while the app is running (WAL mode is safe for this):

```bash
docker compose exec backend sqlite3 /app/data/nesto.db ".backup '/app/data/backup.db'"
docker compose cp backend:/app/data/backup.db ./nesto-backup.db
```

## Development

```bash
# Start dev containers (hot reload)
docker compose up

# Run backend tests
docker compose exec backend pytest tests/ -v

# Access API docs (dev only)
open http://localhost:8000/docs
```

## License

Private project.
