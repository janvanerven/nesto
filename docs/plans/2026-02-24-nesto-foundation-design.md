# Nesto Foundation Design

**Date:** 2026-02-24
**Status:** Approved
**Scope:** App foundation + shared tasks module

## Overview

Nesto is a self-hosted household management app. Bold, vibrant, mobile-first UI. Runs in Docker behind Nginx reverse proxy with Authentik OIDC authentication.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Python 3.12, FastAPI, SQLAlchemy 2.0 async, aiosqlite |
| Database | SQLite (WAL mode), Alembic migrations |
| Frontend | React 19, TypeScript, Vite |
| Routing | TanStack Router (file-based) |
| Server State | TanStack Query v5 |
| Client State | Zustand |
| Styling | Tailwind CSS v4, custom components (no component library) |
| Animation | Framer Motion |
| Auth (FE) | oidc-client-ts, react-oidc-context |
| Auth (BE) | python-jose, JWKS validation against Authentik |
| PWA | vite-plugin-pwa |
| Package Mgmt | uv (Python), npm (JS) |
| Container | Docker, Docker Compose |

## Architecture

SPA + REST API. React frontend handles the OIDC Authorization Code flow with PKCE directly against Authentik. Backend validates JWT access tokens by checking Authentik's JWKS endpoint. No session state on the backend.

### Project Structure

```
nesto/
├── docker-compose.yml
├── docker-compose.prod.yml
├── .env.example
├── backend/
│   ├── Dockerfile
│   ├── pyproject.toml
│   ├── alembic.ini
│   ├── alembic/versions/
│   └── app/
│       ├── main.py
│       ├── config.py
│       ├── database.py
│       ├── auth.py
│       ├── models/
│       ├── schemas/
│       ├── routers/
│       └── services/
├── frontend/
│   ├── Dockerfile
│   ├── package.json
│   ├── vite.config.ts
│   ├── tailwind.config.ts
│   ├── index.html
│   ├── public/manifest.json
│   └── src/
│       ├── main.tsx
│       ├── app.tsx
│       ├── routes/
│       ├── components/
│       │   ├── ui/
│       │   └── layout/
│       ├── features/
│       ├── stores/
│       ├── hooks/
│       ├── api/
│       └── styles/
└── docs/plans/
```

## Data Model

### users
| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | OIDC subject identifier |
| email | TEXT | From OIDC claims |
| display_name | TEXT | From OIDC claims |
| avatar_url | TEXT | Nullable, from OIDC claims |
| created_at | DATETIME | |
| last_login | DATETIME | |

### households
| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | UUID |
| name | TEXT | e.g., "The Johnson Home" |
| created_at | DATETIME | |
| created_by | TEXT FK → users.id | |

### household_members
| Column | Type | Notes |
|--------|------|-------|
| household_id | TEXT FK → households.id | Composite PK |
| user_id | TEXT FK → users.id | Composite PK |
| joined_at | DATETIME | |

### tasks
| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | UUID |
| household_id | TEXT FK → households.id | |
| title | TEXT | |
| description | TEXT | Nullable |
| status | TEXT | pending, in_progress, done |
| priority | INTEGER | 1=urgent, 2=high, 3=normal, 4=low |
| assigned_to | TEXT FK → users.id | Nullable |
| created_by | TEXT FK → users.id | |
| due_date | DATE | Nullable |
| completed_at | DATETIME | Nullable |
| category | TEXT | Nullable, freeform |
| created_at | DATETIME | |
| updated_at | DATETIME | |

### Design Notes
- Users upserted on login from OIDC claims — no registration
- Households are the data isolation boundary
- No roles within a household — all members are equal
- Task categories are freeform text (YAGNI on category table)
- A user can belong to multiple households

## API Endpoints

### Auth
- `POST /api/auth/callback` — Exchange OIDC code for local user upsert
- `GET /api/auth/me` — Current user info

### Households
- `POST /api/households` — Create household
- `GET /api/households` — List user's households
- `POST /api/households/:id/invite` — Generate invite link
- `POST /api/households/:id/join` — Join via invite

### Tasks
- `GET /api/households/:id/tasks` — List tasks (filterable by status, priority, assignee)
- `POST /api/households/:id/tasks` — Create task
- `PATCH /api/households/:id/tasks/:tid` — Update task
- `DELETE /api/households/:id/tasks/:tid` — Delete task

## Visual Design System

### Color Palette
```
Primary:      #6C5CE7  Electric Violet (brand, nav, primary buttons)
Secondary:    #00CEC9  Vivid Cyan (secondary actions, links, progress)
Accent:       #FF6B6B  Coral Red (urgent, notifications, destructive)
Success:      #00B894  Mint Green (completed, confirmations)
Warning:      #FDCB6E  Warm Amber (medium priority, due-soon)

Surface:      #FFFFFF  Cards and content areas
Background:   #F8F7FF  Light violet tint
Text Primary: #2D3436  Near-black
Text Muted:   #636E72  Secondary text

Priority: P1=#FF6B6B, P2=#FDCB6E, P3=#6C5CE7, P4=#B2BEC3
```

### Typography
- **Font:** Inter Variable
- **Headings:** 700-800 weight, 24-32px on mobile
- **Body:** 400 weight, 16px, 1.5 line-height
- **Labels:** 500 weight, 12-14px, uppercase tracking

### Components
- Cards: 16px border-radius, soft shadow, 20px padding
- Buttons: Pill shape (primary), rounded-xl (secondary), scale-on-press (0.96)
- Inputs: 48px min height, rounded-xl, primary-colored focus glow
- Priority dots: Small colored circles next to task titles
- Avatars: Circular, 32-40px, 2px colored ring

### Mobile Layout
- Minimal top bar: app name + user avatar
- Personalized greeting + daily summary on dashboard
- Task cards with swipe gestures (left=complete, right=options)
- Floating Action Button (Electric Violet) for creating tasks
- Bottom navigation: Home, Tasks, Calendar (stub), Settings
- Active tab gets violet highlight

### Animations
- Task completion: SVG checkmark draw animation + spring slide-out + confetti on last task
- List items: Stagger entrance (50ms delay between items)
- Route transitions: Content cross-fade with slight upward slide, fixed bottom nav
- Pull to refresh: Custom Nesto logo bounce
- FAB: Subtle pulse when no tasks exist
- Swipe gestures: Elastic rubber-band at edges

### Empty States
- No tasks: "All caught up! Time to put your feet up." + illustration
- New household: "Welcome home! Invite your household members to get started."

## Auth Flow

1. User opens Nesto → branded login screen (logo, tagline, animated gradient)
2. "Sign in" button → redirect to Authentik
3. Authentik handles login (SSO, MFA, etc.)
4. Redirect back with auth code
5. Frontend exchanges code for tokens (PKCE flow via react-oidc-context)
6. Backend call to `/api/auth/me` → upserts user from JWT claims
7. No household → onboarding (create or join)
8. Has household → dashboard

### Token Management
- Access token in memory (Zustand), never localStorage
- Silent refresh via oidc-client-ts
- Backend validates against Authentik JWKS (cached, refreshed every 24h)
- Token expiry → silent refresh. Refresh failure → redirect to login.

### Household Onboarding
- Create: Just pick a name. Minimal friction.
- Join: Shareable invite link/code with 7-day expiry.

## Docker Setup

### Development
- Two services: `backend` (uvicorn --reload) + `frontend` (vite dev server)
- Volume mounts for hot reload on both services
- SQLite data in named Docker volume
- Ports: backend=8000, frontend=5173

### Production
- Single container: Nginx serves static frontend + proxies `/api/*` to uvicorn
- Single port (8080) exposed
- External Nginx Proxy Manager → nesto:8080
- Auth handled at application layer (JWT), not proxy layer

### Environment Variables
```
OIDC_ISSUER_URL          — Authentik OIDC discovery base URL
OIDC_CLIENT_ID           — OAuth2 client ID
OIDC_CLIENT_SECRET       — OAuth2 client secret (backend only)
VITE_OIDC_AUTHORITY      — Authentik URL (frontend)
VITE_OIDC_CLIENT_ID      — Client ID (frontend)
VITE_OIDC_REDIRECT_URI   — Callback URL (frontend)
SECRET_KEY               — App secret for signing
```

## SQLite Configuration
```sql
PRAGMA journal_mode=WAL;
PRAGMA synchronous=NORMAL;
PRAGMA cache_size=-64000;      -- 64MB
PRAGMA mmap_size=268435456;    -- 256MB
PRAGMA foreign_keys=ON;
PRAGMA busy_timeout=5000;
```

## MVP Scope
Foundation + dashboard + shared tasks module. Calendar and other modules are stubs in the navigation for future development.
