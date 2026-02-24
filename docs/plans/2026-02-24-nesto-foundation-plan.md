# Nesto Foundation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the foundation of Nesto — a self-hosted household management app with OIDC auth, app shell, dashboard, and shared tasks module.

**Architecture:** React 19 SPA (mobile-first, bold/vibrant design) communicating with a FastAPI REST backend. SQLite database with async access. OIDC auth via Authentik with JWT validation. Dockerized for self-hosting.

**Tech Stack:** Python 3.12 / FastAPI / SQLAlchemy 2.0 / aiosqlite / Alembic | React 19 / TypeScript / Vite / TanStack Router / TanStack Query / Zustand / Tailwind CSS v4 / Framer Motion | Docker Compose

**Design doc:** `docs/plans/2026-02-24-nesto-foundation-design.md`

---

## Task 1: Backend Project Scaffolding

**Files:**
- Create: `backend/pyproject.toml`
- Create: `backend/app/__init__.py`
- Create: `backend/app/main.py`
- Create: `backend/app/config.py`

**Step 1: Create backend directory structure**

```bash
mkdir -p backend/app/{models,schemas,routers,services}
mkdir -p backend/tests
touch backend/app/__init__.py
touch backend/app/models/__init__.py
touch backend/app/schemas/__init__.py
touch backend/app/routers/__init__.py
touch backend/app/services/__init__.py
touch backend/tests/__init__.py
```

**Step 2: Create pyproject.toml**

Create `backend/pyproject.toml`:

```toml
[project]
name = "nesto-backend"
version = "0.1.0"
description = "Nesto household management API"
requires-python = ">=3.12"
dependencies = [
    "fastapi>=0.115.0",
    "uvicorn[standard]>=0.34.0",
    "sqlalchemy>=2.0.36",
    "aiosqlite>=0.20.0",
    "alembic>=1.14.0",
    "python-jose[cryptography]>=3.3.0",
    "httpx>=0.28.0",
    "pydantic-settings>=2.6.0",
]

[project.optional-dependencies]
dev = [
    "pytest>=8.3.0",
    "pytest-asyncio>=0.24.0",
    "httpx>=0.28.0",
]

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.pytest.ini_options]
asyncio_mode = "auto"
testpaths = ["tests"]
```

**Step 3: Create config.py**

Create `backend/app/config.py`:

```python
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "sqlite+aiosqlite:///./data/nesto.db"
    oidc_issuer_url: str = ""
    oidc_client_id: str = ""
    oidc_client_secret: str = ""
    secret_key: str = "change-me-in-production"
    environment: str = "development"
    cors_origins: list[str] = ["http://localhost:5173"]

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


settings = Settings()
```

**Step 4: Create main.py**

Create `backend/app/main.py`:

```python
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    yield
    # Shutdown


app = FastAPI(title="Nesto", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
async def health():
    return {"status": "ok"}
```

**Step 5: Install dependencies and verify**

```bash
cd backend
uv sync
cd ..
```

Run: `cd backend && uv run uvicorn app.main:app --host 0.0.0.0 --port 8000`
Test: `curl http://localhost:8000/api/health` → `{"status":"ok"}`

**Step 6: Commit**

```bash
git add backend/
git commit -m "feat: backend project scaffolding with FastAPI"
```

---

## Task 2: Database Layer and Models

**Files:**
- Create: `backend/app/database.py`
- Create: `backend/app/models/user.py`
- Create: `backend/app/models/household.py`
- Create: `backend/app/models/task.py`
- Modify: `backend/app/models/__init__.py`
- Modify: `backend/app/main.py`

**Step 1: Create database.py**

Create `backend/app/database.py`:

```python
from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.config import settings

engine = create_async_engine(settings.database_url, echo=settings.environment == "development")


@event.listens_for(engine.sync_engine, "connect")
def set_sqlite_pragmas(dbapi_connection, connection_record):
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA synchronous=NORMAL")
    cursor.execute("PRAGMA cache_size=-64000")
    cursor.execute("PRAGMA mmap_size=268435456")
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.execute("PRAGMA busy_timeout=5000")
    cursor.close()


async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def get_db() -> AsyncSession:
    async with async_session() as session:
        yield session
```

**Step 2: Create user model**

Create `backend/app/models/user.py`:

```python
from datetime import datetime

from sqlalchemy import DateTime, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    email: Mapped[str] = mapped_column(Text, nullable=False)
    display_name: Mapped[str] = mapped_column(Text, nullable=False)
    avatar_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    last_login: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())
```

**Step 3: Create household models**

Create `backend/app/models/household.py`:

```python
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class Household(Base):
    __tablename__ = "households"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    created_by: Mapped[str] = mapped_column(Text, ForeignKey("users.id"), nullable=False)


class HouseholdMember(Base):
    __tablename__ = "household_members"

    household_id: Mapped[str] = mapped_column(Text, ForeignKey("households.id"), primary_key=True)
    user_id: Mapped[str] = mapped_column(Text, ForeignKey("users.id"), primary_key=True)
    joined_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class HouseholdInvite(Base):
    __tablename__ = "household_invites"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    household_id: Mapped[str] = mapped_column(Text, ForeignKey("households.id"), nullable=False)
    created_by: Mapped[str] = mapped_column(Text, ForeignKey("users.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
```

**Step 4: Create task model**

Create `backend/app/models/task.py`:

```python
from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, Integer, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class Task(Base):
    __tablename__ = "tasks"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    household_id: Mapped[str] = mapped_column(Text, ForeignKey("households.id"), nullable=False)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(Text, nullable=False, default="pending")
    priority: Mapped[int] = mapped_column(Integer, nullable=False, default=3)
    assigned_to: Mapped[str | None] = mapped_column(Text, ForeignKey("users.id"), nullable=True)
    created_by: Mapped[str] = mapped_column(Text, ForeignKey("users.id"), nullable=False)
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    category: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())
```

**Step 5: Update models __init__.py**

Update `backend/app/models/__init__.py`:

```python
from app.models.household import Household, HouseholdInvite, HouseholdMember
from app.models.task import Task
from app.models.user import User

__all__ = ["User", "Household", "HouseholdMember", "HouseholdInvite", "Task"]
```

**Step 6: Update main.py lifespan to create data directory**

Update `backend/app/main.py` lifespan to ensure data dir exists:

```python
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings


@asynccontextmanager
async def lifespan(app: FastAPI):
    os.makedirs("data", exist_ok=True)
    yield
```

**Step 7: Commit**

```bash
git add backend/
git commit -m "feat: database layer with SQLAlchemy models"
```

---

## Task 3: Alembic Migrations

**Files:**
- Create: `backend/alembic.ini`
- Create: `backend/alembic/env.py`
- Create: `backend/alembic/script.py.mako`

**Step 1: Initialize alembic**

```bash
cd backend && uv run alembic init alembic
```

**Step 2: Update alembic.ini**

In `backend/alembic.ini`, set:
```ini
sqlalchemy.url = sqlite+aiosqlite:///./data/nesto.db
```

**Step 3: Update alembic/env.py for async**

Replace `backend/alembic/env.py` with:

```python
import asyncio
from logging.config import fileConfig

from alembic import context
from sqlalchemy import pool
from sqlalchemy.ext.asyncio import async_engine_from_config

from app.database import Base
from app.models import *  # noqa: F401, F403 - import all models for autogenerate

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    url = config.get_main_option("sqlalchemy.url")
    context.configure(url=url, target_metadata=target_metadata, literal_binds=True)
    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection):
    context.configure(connection=connection, target_metadata=target_metadata)
    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations():
    connectable = async_engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)
    await connectable.dispose()


def run_migrations_online() -> None:
    asyncio.run(run_async_migrations())


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
```

**Step 4: Generate initial migration**

```bash
cd backend && uv run alembic revision --autogenerate -m "initial schema"
```

**Step 5: Run migration**

```bash
cd backend && uv run alembic upgrade head
```

Verify: `ls backend/data/nesto.db` — file should exist.

**Step 6: Commit**

```bash
git add backend/alembic* backend/data/.gitkeep
echo "*.db" >> backend/.gitignore
echo "*.db-wal" >> backend/.gitignore
echo "*.db-shm" >> backend/.gitignore
git add backend/.gitignore
git commit -m "feat: alembic async migrations with initial schema"
```

---

## Task 4: Auth Dependency (JWT Validation)

**Files:**
- Create: `backend/app/auth.py`
- Create: `backend/tests/test_auth.py`

**Step 1: Write the test**

Create `backend/tests/test_auth.py`:

```python
import pytest
from unittest.mock import AsyncMock, patch
from fastapi import HTTPException

from app.auth import decode_token


@pytest.mark.asyncio
async def test_decode_token_rejects_missing_token():
    with pytest.raises(HTTPException) as exc:
        await decode_token(None)
    assert exc.value.status_code == 401


@pytest.mark.asyncio
async def test_decode_token_rejects_invalid_token():
    with pytest.raises(HTTPException) as exc:
        await decode_token("invalid.jwt.token")
    assert exc.value.status_code == 401
```

**Step 2: Run test to verify it fails**

```bash
cd backend && uv run pytest tests/test_auth.py -v
```

Expected: FAIL (module not found)

**Step 3: Write auth.py**

Create `backend/app/auth.py`:

```python
import time
from typing import Any

import httpx
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt

from app.config import settings

security = HTTPBearer(auto_error=False)

_jwks_cache: dict[str, Any] = {}
_jwks_cache_time: float = 0
_JWKS_CACHE_TTL = 86400  # 24 hours


async def _get_jwks() -> dict[str, Any]:
    global _jwks_cache, _jwks_cache_time
    now = time.time()
    if _jwks_cache and (now - _jwks_cache_time) < _JWKS_CACHE_TTL:
        return _jwks_cache

    async with httpx.AsyncClient() as client:
        discovery_url = f"{settings.oidc_issuer_url}/.well-known/openid-configuration"
        discovery = await client.get(discovery_url)
        discovery.raise_for_status()
        jwks_uri = discovery.json()["jwks_uri"]
        jwks_resp = await client.get(jwks_uri)
        jwks_resp.raise_for_status()
        _jwks_cache = jwks_resp.json()
        _jwks_cache_time = now
        return _jwks_cache


async def decode_token(
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
) -> dict[str, Any]:
    if credentials is None:
        raise HTTPException(status_code=401, detail="Not authenticated")

    token = credentials.credentials
    try:
        jwks = await _get_jwks()
        payload = jwt.decode(
            token,
            jwks,
            algorithms=["RS256"],
            audience=settings.oidc_client_id,
            issuer=settings.oidc_issuer_url,
        )
        return payload
    except (JWTError, httpx.HTTPError, KeyError):
        raise HTTPException(status_code=401, detail="Invalid or expired token")


async def get_current_user_id(token: dict[str, Any] = Depends(decode_token)) -> str:
    sub = token.get("sub")
    if not sub:
        raise HTTPException(status_code=401, detail="Token missing subject")
    return sub
```

**Step 4: Run tests**

```bash
cd backend && uv run pytest tests/test_auth.py -v
```

Expected: PASS

**Step 5: Commit**

```bash
git add backend/app/auth.py backend/tests/test_auth.py
git commit -m "feat: JWT validation auth dependency"
```

---

## Task 5: Auth & User API Endpoints

**Files:**
- Create: `backend/app/schemas/user.py`
- Create: `backend/app/services/user_service.py`
- Create: `backend/app/routers/auth.py`
- Create: `backend/tests/test_auth_router.py`
- Modify: `backend/app/main.py`

**Step 1: Create user schemas**

Create `backend/app/schemas/user.py`:

```python
from datetime import datetime

from pydantic import BaseModel


class UserResponse(BaseModel):
    id: str
    email: str
    display_name: str
    avatar_url: str | None
    created_at: datetime
    last_login: datetime

    model_config = {"from_attributes": True}
```

**Step 2: Create user service**

Create `backend/app/services/user_service.py`:

```python
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User


async def upsert_user(db: AsyncSession, sub: str, email: str, name: str, avatar: str | None = None) -> User:
    result = await db.execute(select(User).where(User.id == sub))
    user = result.scalar_one_or_none()

    if user:
        user.email = email
        user.display_name = name
        user.avatar_url = avatar
        user.last_login = datetime.now(timezone.utc)
    else:
        user = User(
            id=sub,
            email=email,
            display_name=name,
            avatar_url=avatar,
        )
        db.add(user)

    await db.commit()
    await db.refresh(user)
    return user


async def get_user(db: AsyncSession, user_id: str) -> User | None:
    result = await db.execute(select(User).where(User.id == user_id))
    return result.scalar_one_or_none()
```

**Step 3: Create auth router**

Create `backend/app/routers/auth.py`:

```python
from typing import Any

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import decode_token, get_current_user_id
from app.database import get_db
from app.schemas.user import UserResponse
from app.services.user_service import upsert_user

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.get("/me", response_model=UserResponse)
async def get_me(
    token: dict[str, Any] = Depends(decode_token),
    db: AsyncSession = Depends(get_db),
):
    sub = token["sub"]
    email = token.get("email", "")
    name = token.get("preferred_username", token.get("name", email))
    avatar = token.get("picture")

    user = await upsert_user(db, sub=sub, email=email, name=name, avatar=avatar)
    return user
```

**Step 4: Register router in main.py**

Add to `backend/app/main.py` after the CORS middleware:

```python
from app.routers import auth

app.include_router(auth.router)
```

**Step 5: Commit**

```bash
git add backend/app/schemas/ backend/app/services/ backend/app/routers/auth.py backend/app/main.py
git commit -m "feat: auth/me endpoint with user upsert"
```

---

## Task 6: Household API Endpoints

**Files:**
- Create: `backend/app/schemas/household.py`
- Create: `backend/app/services/household_service.py`
- Create: `backend/app/routers/households.py`
- Modify: `backend/app/main.py`

**Step 1: Create household schemas**

Create `backend/app/schemas/household.py`:

```python
from datetime import datetime

from pydantic import BaseModel


class HouseholdCreate(BaseModel):
    name: str


class HouseholdResponse(BaseModel):
    id: str
    name: str
    created_at: datetime
    created_by: str

    model_config = {"from_attributes": True}


class InviteResponse(BaseModel):
    code: str
    expires_at: datetime


class JoinRequest(BaseModel):
    code: str
```

**Step 2: Create household service**

Create `backend/app/services/household_service.py`:

```python
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.household import Household, HouseholdInvite, HouseholdMember


async def create_household(db: AsyncSession, name: str, user_id: str) -> Household:
    household = Household(id=str(uuid.uuid4()), name=name, created_by=user_id)
    db.add(household)
    member = HouseholdMember(household_id=household.id, user_id=user_id)
    db.add(member)
    await db.commit()
    await db.refresh(household)
    return household


async def list_user_households(db: AsyncSession, user_id: str) -> list[Household]:
    result = await db.execute(
        select(Household)
        .join(HouseholdMember, Household.id == HouseholdMember.household_id)
        .where(HouseholdMember.user_id == user_id)
    )
    return list(result.scalars().all())


async def get_household(db: AsyncSession, household_id: str, user_id: str) -> Household:
    # Verify membership
    result = await db.execute(
        select(HouseholdMember).where(
            HouseholdMember.household_id == household_id,
            HouseholdMember.user_id == user_id,
        )
    )
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=403, detail="Not a member of this household")

    result = await db.execute(select(Household).where(Household.id == household_id))
    household = result.scalar_one_or_none()
    if not household:
        raise HTTPException(status_code=404, detail="Household not found")
    return household


async def create_invite(db: AsyncSession, household_id: str, user_id: str) -> HouseholdInvite:
    # Verify membership
    await get_household(db, household_id, user_id)

    invite = HouseholdInvite(
        id=str(uuid.uuid4()),
        household_id=household_id,
        created_by=user_id,
        expires_at=datetime.now(timezone.utc) + timedelta(days=7),
    )
    db.add(invite)
    await db.commit()
    await db.refresh(invite)
    return invite


async def join_household(db: AsyncSession, code: str, user_id: str) -> Household:
    result = await db.execute(select(HouseholdInvite).where(HouseholdInvite.id == code))
    invite = result.scalar_one_or_none()

    if not invite:
        raise HTTPException(status_code=404, detail="Invalid invite code")
    if invite.expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=410, detail="Invite has expired")

    # Check if already a member
    result = await db.execute(
        select(HouseholdMember).where(
            HouseholdMember.household_id == invite.household_id,
            HouseholdMember.user_id == user_id,
        )
    )
    if result.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Already a member")

    member = HouseholdMember(household_id=invite.household_id, user_id=user_id)
    db.add(member)
    await db.commit()

    result = await db.execute(select(Household).where(Household.id == invite.household_id))
    return result.scalar_one()
```

**Step 3: Create households router**

Create `backend/app/routers/households.py`:

```python
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user_id
from app.database import get_db
from app.schemas.household import HouseholdCreate, HouseholdResponse, InviteResponse, JoinRequest
from app.services.household_service import create_household, create_invite, join_household, list_user_households

router = APIRouter(prefix="/api/households", tags=["households"])


@router.get("", response_model=list[HouseholdResponse])
async def list_households(
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    return await list_user_households(db, user_id)


@router.post("", response_model=HouseholdResponse, status_code=201)
async def create(
    body: HouseholdCreate,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    return await create_household(db, name=body.name, user_id=user_id)


@router.post("/{household_id}/invite", response_model=InviteResponse)
async def invite(
    household_id: str,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    inv = await create_invite(db, household_id, user_id)
    return InviteResponse(code=inv.id, expires_at=inv.expires_at)


@router.post("/{household_id}/join", response_model=HouseholdResponse)
async def join(
    household_id: str,
    body: JoinRequest,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    return await join_household(db, code=body.code, user_id=user_id)
```

**Step 4: Register router in main.py**

Add to `backend/app/main.py`:

```python
from app.routers import auth, households

app.include_router(auth.router)
app.include_router(households.router)
```

**Step 5: Commit**

```bash
git add backend/app/schemas/household.py backend/app/services/household_service.py backend/app/routers/households.py backend/app/main.py
git commit -m "feat: household CRUD with invite/join"
```

---

## Task 7: Tasks API Endpoints

**Files:**
- Create: `backend/app/schemas/task.py`
- Create: `backend/app/services/task_service.py`
- Create: `backend/app/routers/tasks.py`
- Modify: `backend/app/main.py`

**Step 1: Create task schemas**

Create `backend/app/schemas/task.py`:

```python
from datetime import date, datetime

from pydantic import BaseModel, Field


class TaskCreate(BaseModel):
    title: str
    description: str | None = None
    priority: int = Field(default=3, ge=1, le=4)
    assigned_to: str | None = None
    due_date: date | None = None
    category: str | None = None


class TaskUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    status: str | None = None
    priority: int | None = Field(default=None, ge=1, le=4)
    assigned_to: str | None = None
    due_date: date | None = None
    category: str | None = None


class TaskResponse(BaseModel):
    id: str
    household_id: str
    title: str
    description: str | None
    status: str
    priority: int
    assigned_to: str | None
    created_by: str
    due_date: date | None
    completed_at: datetime | None
    category: str | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
```

**Step 2: Create task service**

Create `backend/app/services/task_service.py`:

```python
import uuid
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.task import Task


async def list_tasks(
    db: AsyncSession,
    household_id: str,
    status: str | None = None,
    priority: int | None = None,
    assigned_to: str | None = None,
) -> list[Task]:
    query = select(Task).where(Task.household_id == household_id)
    if status:
        query = query.where(Task.status == status)
    if priority:
        query = query.where(Task.priority == priority)
    if assigned_to:
        query = query.where(Task.assigned_to == assigned_to)
    query = query.order_by(Task.priority.asc(), Task.created_at.desc())
    result = await db.execute(query)
    return list(result.scalars().all())


async def create_task(db: AsyncSession, household_id: str, user_id: str, **kwargs) -> Task:
    task = Task(
        id=str(uuid.uuid4()),
        household_id=household_id,
        created_by=user_id,
        **kwargs,
    )
    db.add(task)
    await db.commit()
    await db.refresh(task)
    return task


async def update_task(db: AsyncSession, task_id: str, household_id: str, **kwargs) -> Task:
    result = await db.execute(
        select(Task).where(Task.id == task_id, Task.household_id == household_id)
    )
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    for key, value in kwargs.items():
        if value is not None:
            setattr(task, key, value)

    # Auto-set completed_at
    if kwargs.get("status") == "done" and not task.completed_at:
        task.completed_at = datetime.now(timezone.utc)
    elif kwargs.get("status") and kwargs["status"] != "done":
        task.completed_at = None

    await db.commit()
    await db.refresh(task)
    return task


async def delete_task(db: AsyncSession, task_id: str, household_id: str) -> None:
    result = await db.execute(
        select(Task).where(Task.id == task_id, Task.household_id == household_id)
    )
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    await db.delete(task)
    await db.commit()
```

**Step 3: Create tasks router**

Create `backend/app/routers/tasks.py`:

```python
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user_id
from app.database import get_db
from app.schemas.task import TaskCreate, TaskResponse, TaskUpdate
from app.services.household_service import get_household
from app.services.task_service import create_task, delete_task, list_tasks, update_task

router = APIRouter(prefix="/api/households/{household_id}/tasks", tags=["tasks"])


@router.get("", response_model=list[TaskResponse])
async def get_tasks(
    household_id: str,
    status: str | None = Query(None),
    priority: int | None = Query(None),
    assigned_to: str | None = Query(None),
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    await get_household(db, household_id, user_id)
    return await list_tasks(db, household_id, status=status, priority=priority, assigned_to=assigned_to)


@router.post("", response_model=TaskResponse, status_code=201)
async def create(
    household_id: str,
    body: TaskCreate,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    await get_household(db, household_id, user_id)
    return await create_task(db, household_id, user_id, **body.model_dump())


@router.patch("/{task_id}", response_model=TaskResponse)
async def update(
    household_id: str,
    task_id: str,
    body: TaskUpdate,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    await get_household(db, household_id, user_id)
    return await update_task(db, task_id, household_id, **body.model_dump(exclude_unset=True))


@router.delete("/{task_id}", status_code=204)
async def delete(
    household_id: str,
    task_id: str,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    await get_household(db, household_id, user_id)
    await delete_task(db, task_id, household_id)
```

**Step 4: Register router in main.py**

Add to `backend/app/main.py`:

```python
from app.routers import auth, households, tasks

app.include_router(auth.router)
app.include_router(households.router)
app.include_router(tasks.router)
```

**Step 5: Commit**

```bash
git add backend/app/schemas/task.py backend/app/services/task_service.py backend/app/routers/tasks.py backend/app/main.py
git commit -m "feat: tasks CRUD API with filtering"
```

---

## Task 8: Frontend Project Scaffolding

**Files:**
- Create: `frontend/package.json`
- Create: `frontend/tsconfig.json`
- Create: `frontend/vite.config.ts`
- Create: `frontend/index.html`
- Create: `frontend/src/main.tsx`
- Create: `frontend/src/styles/index.css`

**Step 1: Initialize frontend project**

```bash
mkdir -p frontend/src/styles frontend/public
cd frontend && npm init -y
```

**Step 2: Install dependencies**

```bash
cd frontend && npm install react react-dom @tanstack/react-router @tanstack/react-query framer-motion oidc-client-ts react-oidc-context zustand
```

```bash
cd frontend && npm install -D typescript @types/react @types/react-dom vite @vitejs/plugin-react tailwindcss @tailwindcss/vite @tanstack/router-plugin vite-plugin-pwa
```

**Step 3: Create tsconfig.json**

Create `frontend/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noEmit": true,
    "isolatedModules": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["src"]
}
```

**Step 4: Create vite.config.ts**

Create `frontend/vite.config.ts`:

```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { TanStackRouterVite } from '@tanstack/router-plugin/vite'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'path'

export default defineConfig({
  plugins: [
    TanStackRouterVite({
      target: 'react',
      autoCodeSplitting: true,
    }),
    tailwindcss(),
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Nesto',
        short_name: 'Nesto',
        description: 'Your home, organized.',
        theme_color: '#6C5CE7',
        background_color: '#F8F7FF',
        display: 'standalone',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8000',
    },
  },
})
```

**Step 5: Create index.html**

Create `frontend/index.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="theme-color" content="#6C5CE7" />
  <title>Nesto</title>
  <link rel="preconnect" href="https://rsms.me/" />
  <link rel="stylesheet" href="https://rsms.me/inter/inter.css" />
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/src/main.tsx"></script>
</body>
</html>
```

**Step 6: Create index.css with Tailwind v4 + design tokens**

Create `frontend/src/styles/index.css`:

```css
@import "tailwindcss";

@theme {
  /* Colors */
  --color-primary: #6C5CE7;
  --color-primary-light: #8B7CF0;
  --color-primary-dark: #5A4BD1;
  --color-secondary: #00CEC9;
  --color-secondary-light: #33D9D5;
  --color-accent: #FF6B6B;
  --color-accent-light: #FF8787;
  --color-success: #00B894;
  --color-warning: #FDCB6E;
  --color-surface: #FFFFFF;
  --color-background: #F8F7FF;
  --color-text: #2D3436;
  --color-text-muted: #636E72;

  /* Priority colors */
  --color-priority-urgent: #FF6B6B;
  --color-priority-high: #FDCB6E;
  --color-priority-normal: #6C5CE7;
  --color-priority-low: #B2BEC3;

  /* Typography */
  --font-family-sans: 'Inter', 'InterVariable', system-ui, sans-serif;

  /* Radius */
  --radius-card: 16px;
  --radius-button: 9999px;
  --radius-input: 12px;

  /* Shadows */
  --shadow-card: 0 2px 8px rgba(0, 0, 0, 0.06);
  --shadow-card-hover: 0 4px 16px rgba(0, 0, 0, 0.1);
  --shadow-fab: 0 4px 12px rgba(108, 92, 231, 0.4);
}

html {
  font-family: var(--font-family-sans);
  background-color: var(--color-background);
  color: var(--color-text);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

body {
  margin: 0;
  min-height: 100dvh;
}
```

**Step 7: Create main.tsx**

Create `frontend/src/main.tsx`:

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@/styles/index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <div className="flex items-center justify-center min-h-dvh">
      <h1 className="text-4xl font-extrabold text-primary">Nesto</h1>
    </div>
  </StrictMode>,
)
```

**Step 8: Verify it runs**

```bash
cd frontend && npx vite
```

Open `http://localhost:5173` — should show "Nesto" in Electric Violet, bold text, on a light violet-tinted background.

**Step 9: Commit**

```bash
git add frontend/
echo "node_modules" >> frontend/.gitignore
echo "dist" >> frontend/.gitignore
git add frontend/.gitignore
git commit -m "feat: frontend scaffolding with React, Vite, Tailwind v4"
```

---

## Task 9: Design System — Base UI Components

**Files:**
- Create: `frontend/src/components/ui/button.tsx`
- Create: `frontend/src/components/ui/card.tsx`
- Create: `frontend/src/components/ui/input.tsx`
- Create: `frontend/src/components/ui/avatar.tsx`
- Create: `frontend/src/components/ui/priority-dot.tsx`
- Create: `frontend/src/components/ui/index.ts`

These are the custom UI primitives that define Nesto's visual identity. Bold, vibrant, with Framer Motion micro-interactions.

**Step 1: Create Button component**

Create `frontend/src/components/ui/button.tsx`:

```tsx
import { motion } from 'framer-motion'
import { type ButtonHTMLAttributes, forwardRef } from 'react'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size = 'sm' | 'md' | 'lg'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
}

const variantStyles: Record<Variant, string> = {
  primary: 'bg-gradient-to-r from-primary to-primary-light text-white shadow-md hover:shadow-lg',
  secondary: 'bg-secondary/10 text-secondary hover:bg-secondary/20',
  ghost: 'bg-transparent text-text-muted hover:bg-black/5',
  danger: 'bg-accent/10 text-accent hover:bg-accent/20',
}

const sizeStyles: Record<Size, string> = {
  sm: 'px-4 py-2 text-sm',
  md: 'px-6 py-3 text-base',
  lg: 'px-8 py-4 text-lg',
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', size = 'md', className = '', children, ...props }, ref) => {
    return (
      <motion.button
        ref={ref}
        whileTap={{ scale: 0.96 }}
        className={`
          inline-flex items-center justify-center gap-2
          font-semibold rounded-full
          transition-colors duration-200
          disabled:opacity-50 disabled:pointer-events-none
          ${variantStyles[variant]}
          ${sizeStyles[size]}
          ${className}
        `}
        {...(props as any)}
      >
        {children}
      </motion.button>
    )
  },
)

Button.displayName = 'Button'
```

**Step 2: Create Card component**

Create `frontend/src/components/ui/card.tsx`:

```tsx
import { motion, type HTMLMotionProps } from 'framer-motion'
import { forwardRef } from 'react'

interface CardProps extends HTMLMotionProps<'div'> {
  interactive?: boolean
}

export const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ interactive = false, className = '', children, ...props }, ref) => {
    return (
      <motion.div
        ref={ref}
        whileTap={interactive ? { scale: 0.98 } : undefined}
        className={`
          bg-surface rounded-[var(--radius-card)] p-5
          shadow-[var(--shadow-card)]
          ${interactive ? 'cursor-pointer hover:shadow-[var(--shadow-card-hover)] transition-shadow' : ''}
          ${className}
        `}
        {...props}
      >
        {children}
      </motion.div>
    )
  },
)

Card.displayName = 'Card'
```

**Step 3: Create Input component**

Create `frontend/src/components/ui/input.tsx`:

```tsx
import { forwardRef, type InputHTMLAttributes } from 'react'

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, className = '', id, ...props }, ref) => {
    const inputId = id || label?.toLowerCase().replace(/\s+/g, '-')

    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label htmlFor={inputId} className="text-sm font-medium text-text-muted">
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          className={`
            h-12 px-4 rounded-[var(--radius-input)]
            border-2 border-black/10
            bg-surface text-text
            placeholder:text-text-muted/50
            focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20
            transition-all duration-200
            ${error ? 'border-accent focus:border-accent focus:ring-accent/20' : ''}
            ${className}
          `}
          {...props}
        />
        {error && <p className="text-sm text-accent">{error}</p>}
      </div>
    )
  },
)

Input.displayName = 'Input'
```

**Step 4: Create Avatar component**

Create `frontend/src/components/ui/avatar.tsx`:

```tsx
interface AvatarProps {
  src?: string | null
  name: string
  size?: 'sm' | 'md' | 'lg'
  ringColor?: string
}

const sizeMap = { sm: 'w-8 h-8 text-xs', md: 'w-10 h-10 text-sm', lg: 'w-14 h-14 text-lg' }

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
}

function hashColor(name: string): string {
  const colors = ['#6C5CE7', '#00CEC9', '#FF6B6B', '#00B894', '#FDCB6E', '#E84393', '#0984E3']
  let hash = 0
  for (const char of name) hash = char.charCodeAt(0) + ((hash << 5) - hash)
  return colors[Math.abs(hash) % colors.length]
}

export function Avatar({ src, name, size = 'md', ringColor }: AvatarProps) {
  const ring = ringColor || hashColor(name)

  return (
    <div
      className={`${sizeMap[size]} rounded-full flex items-center justify-center font-bold ring-2 overflow-hidden`}
      style={{ ringColor: ring, '--tw-ring-color': ring } as React.CSSProperties}
    >
      {src ? (
        <img src={src} alt={name} className="w-full h-full object-cover" />
      ) : (
        <div
          className="w-full h-full flex items-center justify-center text-white"
          style={{ backgroundColor: ring }}
        >
          {getInitials(name)}
        </div>
      )}
    </div>
  )
}
```

**Step 5: Create PriorityDot component**

Create `frontend/src/components/ui/priority-dot.tsx`:

```tsx
const priorityColors: Record<number, string> = {
  1: 'bg-priority-urgent',
  2: 'bg-priority-high',
  3: 'bg-priority-normal',
  4: 'bg-priority-low',
}

const priorityLabels: Record<number, string> = {
  1: 'Urgent',
  2: 'High',
  3: 'Normal',
  4: 'Low',
}

export function PriorityDot({ priority }: { priority: number }) {
  return (
    <span
      className={`inline-block w-2.5 h-2.5 rounded-full ${priorityColors[priority] || priorityColors[3]}`}
      title={priorityLabels[priority]}
    />
  )
}
```

**Step 6: Create barrel export**

Create `frontend/src/components/ui/index.ts`:

```typescript
export { Button } from './button'
export { Card } from './card'
export { Input } from './input'
export { Avatar } from './avatar'
export { PriorityDot } from './priority-dot'
```

**Step 7: Commit**

```bash
git add frontend/src/components/
git commit -m "feat: design system base components (button, card, input, avatar, priority dot)"
```

---

## Task 10: OIDC Auth Integration

**Files:**
- Create: `frontend/src/auth/config.ts`
- Create: `frontend/src/auth/provider.tsx`
- Create: `frontend/src/stores/auth-store.ts`
- Create: `frontend/src/api/client.ts`

**Step 1: Create auth config**

Create `frontend/src/auth/config.ts`:

```typescript
import { WebStorageStateStore } from 'oidc-client-ts'

export const oidcConfig = {
  authority: import.meta.env.VITE_OIDC_AUTHORITY || '',
  client_id: import.meta.env.VITE_OIDC_CLIENT_ID || '',
  redirect_uri: import.meta.env.VITE_OIDC_REDIRECT_URI || `${window.location.origin}/callback`,
  post_logout_redirect_uri: window.location.origin,
  scope: 'openid profile email',
  response_type: 'code',
  automaticSilentRenew: true,
  // Store auth state in sessionStorage (not localStorage) for security
  userStore: new WebStorageStateStore({ store: window.sessionStorage }),
}
```

**Step 2: Create auth provider wrapper**

Create `frontend/src/auth/provider.tsx`:

```tsx
import { AuthProvider as OidcProvider } from 'react-oidc-context'
import { type ReactNode } from 'react'
import { oidcConfig } from './config'

export function AuthProvider({ children }: { children: ReactNode }) {
  return (
    <OidcProvider
      {...oidcConfig}
      onSigninCallback={() => {
        // Remove the code/state from the URL after login
        window.history.replaceState({}, document.title, window.location.pathname)
      }}
    >
      {children}
    </OidcProvider>
  )
}
```

**Step 3: Create API client**

Create `frontend/src/api/client.ts`:

```typescript
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

let getToken: (() => string | undefined) | null = null

export function setTokenGetter(getter: () => string | undefined) {
  getToken = getter
}

export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken?.()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  const response = await fetch(`/api${path}`, { ...options, headers })

  if (!response.ok) {
    const body = await response.json().catch(() => ({ detail: response.statusText }))
    throw new ApiError(response.status, body.detail || response.statusText)
  }

  if (response.status === 204) return undefined as T
  return response.json()
}
```

**Step 4: Create auth store**

Create `frontend/src/stores/auth-store.ts`:

```typescript
import { create } from 'zustand'

interface AuthState {
  isInitialized: boolean
  setInitialized: (v: boolean) => void
}

export const useAuthStore = create<AuthState>((set) => ({
  isInitialized: false,
  setInitialized: (v) => set({ isInitialized: v }),
}))
```

**Step 5: Commit**

```bash
git add frontend/src/auth/ frontend/src/api/ frontend/src/stores/
git commit -m "feat: OIDC auth integration with API client"
```

---

## Task 11: TanStack Router Setup & App Shell

**Files:**
- Create: `frontend/src/routes/__root.tsx`
- Create: `frontend/src/routes/index.tsx`
- Create: `frontend/src/routes/callback.tsx`
- Create: `frontend/src/routes/login.tsx`
- Create: `frontend/src/components/layout/app-shell.tsx`
- Create: `frontend/src/components/layout/bottom-nav.tsx`
- Modify: `frontend/src/main.tsx`

**Step 1: Create the root route with auth gating**

Create `frontend/src/routes/__root.tsx`:

```tsx
import { createRootRoute, Outlet } from '@tanstack/react-router'
import { useAuth } from 'react-oidc-context'
import { useEffect } from 'react'
import { setTokenGetter } from '@/api/client'

export const Route = createRootRoute({
  component: RootComponent,
})

function RootComponent() {
  const auth = useAuth()

  useEffect(() => {
    setTokenGetter(() => auth.user?.access_token)
  }, [auth.user])

  return <Outlet />
}
```

**Step 2: Create login route**

Create `frontend/src/routes/login.tsx`:

```tsx
import { createFileRoute, Navigate } from '@tanstack/react-router'
import { useAuth } from 'react-oidc-context'
import { motion } from 'framer-motion'
import { Button } from '@/components/ui'

export const Route = createFileRoute('/login')({
  component: LoginPage,
})

function LoginPage() {
  const auth = useAuth()

  if (auth.isAuthenticated) {
    return <Navigate to="/" />
  }

  return (
    <div className="min-h-dvh flex flex-col items-center justify-center px-6 bg-gradient-to-br from-primary/5 via-background to-secondary/5">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="text-center"
      >
        <h1 className="text-5xl font-extrabold text-primary mb-2">Nesto</h1>
        <p className="text-lg text-text-muted mb-12">Your home, organized.</p>

        <Button size="lg" onClick={() => auth.signinRedirect()}>
          Sign in
        </Button>
      </motion.div>
    </div>
  )
}
```

**Step 3: Create callback route**

Create `frontend/src/routes/callback.tsx`:

```tsx
import { createFileRoute, Navigate } from '@tanstack/react-router'
import { useAuth } from 'react-oidc-context'

export const Route = createFileRoute('/callback')({
  component: CallbackPage,
})

function CallbackPage() {
  const auth = useAuth()

  if (auth.isLoading) {
    return (
      <div className="min-h-dvh flex items-center justify-center">
        <div className="text-primary text-xl font-bold animate-pulse">Loading...</div>
      </div>
    )
  }

  if (auth.isAuthenticated) {
    return <Navigate to="/" />
  }

  return <Navigate to="/login" />
}
```

**Step 4: Create bottom navigation**

Create `frontend/src/components/layout/bottom-nav.tsx`:

```tsx
import { Link, useRouterState } from '@tanstack/react-router'
import { motion } from 'framer-motion'

const tabs = [
  { to: '/' as const, label: 'Home', icon: HomeIcon },
  { to: '/tasks' as const, label: 'Tasks', icon: CheckIcon },
  { to: '/calendar' as const, label: 'Calendar', icon: CalendarIcon },
  { to: '/settings' as const, label: 'More', icon: SettingsIcon },
]

export function BottomNav() {
  const routerState = useRouterState()
  const currentPath = routerState.location.pathname

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-surface border-t border-black/5 pb-[env(safe-area-inset-bottom)]">
      <div className="flex items-center justify-around h-16 max-w-lg mx-auto">
        {tabs.map((tab) => {
          const isActive = currentPath === tab.to || (tab.to !== '/' && currentPath.startsWith(tab.to))
          return (
            <Link
              key={tab.to}
              to={tab.to}
              className="flex flex-col items-center gap-1 px-4 py-2 relative"
            >
              {isActive && (
                <motion.div
                  layoutId="nav-indicator"
                  className="absolute -top-0.5 w-8 h-1 bg-primary rounded-full"
                  transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                />
              )}
              <tab.icon active={isActive} />
              <span className={`text-xs font-medium ${isActive ? 'text-primary' : 'text-text-muted'}`}>
                {tab.label}
              </span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}

// Inline SVG icons — small, no external dependency
function HomeIcon({ active }: { active: boolean }) {
  const color = active ? '#6C5CE7' : '#636E72'
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0a1 1 0 01-1-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 01-1 1" />
    </svg>
  )
}

function CheckIcon({ active }: { active: boolean }) {
  const color = active ? '#6C5CE7' : '#636E72'
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
    </svg>
  )
}

function CalendarIcon({ active }: { active: boolean }) {
  const color = active ? '#6C5CE7' : '#636E72'
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  )
}

function SettingsIcon({ active }: { active: boolean }) {
  const color = active ? '#6C5CE7' : '#636E72'
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="1" /><circle cx="12" cy="5" r="1" /><circle cx="12" cy="19" r="1" />
    </svg>
  )
}
```

**Step 5: Create app shell**

Create `frontend/src/components/layout/app-shell.tsx`:

```tsx
import { Outlet } from '@tanstack/react-router'
import { BottomNav } from './bottom-nav'

export function AppShell() {
  return (
    <div className="min-h-dvh bg-background pb-20">
      <main className="max-w-lg mx-auto px-4 pt-4">
        <Outlet />
      </main>
      <BottomNav />
    </div>
  )
}
```

**Step 6: Create dashboard index route (placeholder)**

Create `frontend/src/routes/index.tsx`:

```tsx
import { createFileRoute, Navigate } from '@tanstack/react-router'
import { useAuth } from 'react-oidc-context'

export const Route = createFileRoute('/')({
  component: DashboardPage,
})

function DashboardPage() {
  const auth = useAuth()

  if (!auth.isAuthenticated) {
    return <Navigate to="/login" />
  }

  const name = auth.user?.profile?.preferred_username || auth.user?.profile?.name || 'there'

  return (
    <div>
      <h1 className="text-3xl font-extrabold text-text mt-2">
        Good morning, {name}
      </h1>
      <p className="text-text-muted mt-1">Welcome to Nesto</p>
    </div>
  )
}
```

**Step 7: Update main.tsx with providers and router**

Replace `frontend/src/main.tsx`:

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider, createRouter } from '@tanstack/react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from '@/auth/provider'
import { routeTree } from './routeTree.gen'
import '@/styles/index.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60,
      retry: 1,
    },
  },
})

const router = createRouter({ routeTree })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
)
```

**Step 8: Run dev server to generate route tree and verify**

```bash
cd frontend && npx vite
```

TanStack Router plugin will auto-generate `routeTree.gen.ts`. Verify the app loads at `http://localhost:5173/login`.

**Step 9: Commit**

```bash
git add frontend/src/
git commit -m "feat: app shell with TanStack Router, bottom nav, login/callback routes"
```

---

## Task 12: Household Onboarding Screens

**Files:**
- Create: `frontend/src/api/households.ts`
- Create: `frontend/src/routes/onboarding.tsx`

**Step 1: Create household API hooks**

Create `frontend/src/api/households.ts`:

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from './client'

export interface Household {
  id: string
  name: string
  created_at: string
  created_by: string
}

export interface InviteResponse {
  code: string
  expires_at: string
}

export function useHouseholds() {
  return useQuery({
    queryKey: ['households'],
    queryFn: () => apiFetch<Household[]>('/households'),
  })
}

export function useCreateHousehold() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (name: string) =>
      apiFetch<Household>('/households', {
        method: 'POST',
        body: JSON.stringify({ name }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['households'] }),
  })
}

export function useJoinHousehold() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ householdId, code }: { householdId: string; code: string }) =>
      apiFetch<Household>(`/households/${householdId}/join`, {
        method: 'POST',
        body: JSON.stringify({ code }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['households'] }),
  })
}

export function useCreateInvite(householdId: string) {
  return useMutation({
    mutationFn: () => apiFetch<InviteResponse>(`/households/${householdId}/invite`, { method: 'POST' }),
  })
}
```

**Step 2: Create onboarding page**

Create `frontend/src/routes/onboarding.tsx`:

```tsx
import { createFileRoute, Navigate, useNavigate } from '@tanstack/react-router'
import { useAuth } from 'react-oidc-context'
import { motion, AnimatePresence } from 'framer-motion'
import { useState } from 'react'
import { Button, Card, Input } from '@/components/ui'
import { useCreateHousehold, useHouseholds, useJoinHousehold } from '@/api/households'

export const Route = createFileRoute('/onboarding')({
  component: OnboardingPage,
})

function OnboardingPage() {
  const auth = useAuth()
  const { data: households, isLoading } = useHouseholds()
  const [mode, setMode] = useState<'choose' | 'create' | 'join'>('choose')

  if (!auth.isAuthenticated) return <Navigate to="/login" />
  if (isLoading) return <LoadingScreen />
  if (households && households.length > 0) return <Navigate to="/" />

  return (
    <div className="min-h-dvh flex flex-col items-center justify-center px-6">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-sm"
      >
        <h1 className="text-3xl font-extrabold text-text mb-2">Welcome to Nesto!</h1>
        <p className="text-text-muted mb-8">Let's set up your household.</p>

        <AnimatePresence mode="wait">
          {mode === 'choose' && <ChooseMode key="choose" onSelect={setMode} />}
          {mode === 'create' && <CreateHousehold key="create" onBack={() => setMode('choose')} />}
          {mode === 'join' && <JoinHousehold key="join" onBack={() => setMode('choose')} />}
        </AnimatePresence>
      </motion.div>
    </div>
  )
}

function ChooseMode({ onSelect }: { onSelect: (m: 'create' | 'join') => void }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="flex flex-col gap-3"
    >
      <Card interactive onClick={() => onSelect('create')}>
        <p className="font-semibold text-lg">Create a new household</p>
        <p className="text-sm text-text-muted mt-1">Start fresh and invite others</p>
      </Card>
      <Card interactive onClick={() => onSelect('join')}>
        <p className="font-semibold text-lg">Join with an invite code</p>
        <p className="text-sm text-text-muted mt-1">Someone shared a code with you</p>
      </Card>
    </motion.div>
  )
}

function CreateHousehold({ onBack }: { onBack: () => void }) {
  const [name, setName] = useState('')
  const createMutation = useCreateHousehold()
  const navigate = useNavigate()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    await createMutation.mutateAsync(name.trim())
    navigate({ to: '/' })
  }

  return (
    <motion.form
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      onSubmit={handleSubmit}
      className="flex flex-col gap-4"
    >
      <Input
        label="Household name"
        placeholder="e.g. The Smith Home"
        value={name}
        onChange={(e) => setName(e.target.value)}
        autoFocus
      />
      <Button type="submit" disabled={!name.trim() || createMutation.isPending}>
        {createMutation.isPending ? 'Creating...' : 'Create household'}
      </Button>
      <Button variant="ghost" type="button" onClick={onBack}>
        Back
      </Button>
    </motion.form>
  )
}

function JoinHousehold({ onBack }: { onBack: () => void }) {
  const [code, setCode] = useState('')
  const joinMutation = useJoinHousehold()
  const navigate = useNavigate()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!code.trim()) return
    // The code IS the invite ID, household_id is embedded in the invite
    await joinMutation.mutateAsync({ householdId: '_', code: code.trim() })
    navigate({ to: '/' })
  }

  return (
    <motion.form
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      onSubmit={handleSubmit}
      className="flex flex-col gap-4"
    >
      <Input
        label="Invite code"
        placeholder="Paste your invite code"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        autoFocus
      />
      <Button type="submit" disabled={!code.trim() || joinMutation.isPending}>
        {joinMutation.isPending ? 'Joining...' : 'Join household'}
      </Button>
      <Button variant="ghost" type="button" onClick={onBack}>
        Back
      </Button>
    </motion.form>
  )
}

function LoadingScreen() {
  return (
    <div className="min-h-dvh flex items-center justify-center">
      <div className="text-primary text-xl font-bold animate-pulse">Loading...</div>
    </div>
  )
}
```

**Step 3: Update index route to redirect to onboarding if no household**

Update `frontend/src/routes/index.tsx` to check households:

```tsx
import { createFileRoute, Navigate } from '@tanstack/react-router'
import { useAuth } from 'react-oidc-context'
import { useHouseholds } from '@/api/households'

export const Route = createFileRoute('/')({
  component: DashboardPage,
})

function DashboardPage() {
  const auth = useAuth()
  const { data: households, isLoading } = useHouseholds()

  if (!auth.isAuthenticated) return <Navigate to="/login" />
  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[50dvh]">
        <div className="text-primary text-xl font-bold animate-pulse">Loading...</div>
      </div>
    )
  }
  if (!households || households.length === 0) return <Navigate to="/onboarding" />

  const name = auth.user?.profile?.preferred_username || auth.user?.profile?.name || 'there'

  return (
    <div>
      <h1 className="text-3xl font-extrabold text-text mt-2">
        Good morning, {name}
      </h1>
      <p className="text-text-muted mt-1">Welcome to Nesto</p>
    </div>
  )
}
```

**Step 4: Commit**

```bash
git add frontend/src/
git commit -m "feat: household onboarding (create/join) with animated transitions"
```

---

## Task 13: Dashboard with Task Summary

**Files:**
- Create: `frontend/src/api/tasks.ts`
- Create: `frontend/src/api/user.ts`
- Modify: `frontend/src/routes/index.tsx`

**Step 1: Create user API hook**

Create `frontend/src/api/user.ts`:

```typescript
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from './client'

export interface User {
  id: string
  email: string
  display_name: string
  avatar_url: string | null
  created_at: string
  last_login: string
}

export function useCurrentUser() {
  return useQuery({
    queryKey: ['user', 'me'],
    queryFn: () => apiFetch<User>('/auth/me'),
  })
}
```

**Step 2: Create tasks API hooks**

Create `frontend/src/api/tasks.ts`:

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from './client'

export interface Task {
  id: string
  household_id: string
  title: string
  description: string | null
  status: string
  priority: number
  assigned_to: string | null
  created_by: string
  due_date: string | null
  completed_at: string | null
  category: string | null
  created_at: string
  updated_at: string
}

export interface TaskCreate {
  title: string
  description?: string
  priority?: number
  assigned_to?: string
  due_date?: string
  category?: string
}

export interface TaskUpdate {
  title?: string
  description?: string
  status?: string
  priority?: number
  assigned_to?: string
  due_date?: string
  category?: string
}

export function useTasks(householdId: string, filters?: { status?: string; priority?: number; assigned_to?: string }) {
  const params = new URLSearchParams()
  if (filters?.status) params.set('status', filters.status)
  if (filters?.priority) params.set('priority', String(filters.priority))
  if (filters?.assigned_to) params.set('assigned_to', filters.assigned_to)
  const qs = params.toString()

  return useQuery({
    queryKey: ['tasks', householdId, filters],
    queryFn: () => apiFetch<Task[]>(`/households/${householdId}/tasks${qs ? `?${qs}` : ''}`),
    enabled: !!householdId,
  })
}

export function useCreateTask(householdId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (task: TaskCreate) =>
      apiFetch<Task>(`/households/${householdId}/tasks`, {
        method: 'POST',
        body: JSON.stringify(task),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks', householdId] }),
  })
}

export function useUpdateTask(householdId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ taskId, ...update }: TaskUpdate & { taskId: string }) =>
      apiFetch<Task>(`/households/${householdId}/tasks/${taskId}`, {
        method: 'PATCH',
        body: JSON.stringify(update),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks', householdId] }),
  })
}

export function useDeleteTask(householdId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (taskId: string) =>
      apiFetch<void>(`/households/${householdId}/tasks/${taskId}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks', householdId] }),
  })
}
```

**Step 3: Build the full dashboard**

Replace `frontend/src/routes/index.tsx`:

```tsx
import { createFileRoute, Navigate, Link } from '@tanstack/react-router'
import { useAuth } from 'react-oidc-context'
import { motion } from 'framer-motion'
import { useHouseholds } from '@/api/households'
import { useCurrentUser } from '@/api/user'
import { useTasks } from '@/api/tasks'
import { Avatar, Card, PriorityDot } from '@/components/ui'

export const Route = createFileRoute('/')({
  component: DashboardPage,
})

function getGreeting(): string {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

function DashboardPage() {
  const auth = useAuth()
  const { data: user } = useCurrentUser()
  const { data: households, isLoading: loadingHouseholds } = useHouseholds()

  if (!auth.isAuthenticated) return <Navigate to="/login" />
  if (loadingHouseholds) {
    return (
      <div className="flex items-center justify-center min-h-[50dvh]">
        <div className="text-primary text-xl font-bold animate-pulse">Loading...</div>
      </div>
    )
  }
  if (!households || households.length === 0) return <Navigate to="/onboarding" />

  const household = households[0]

  return (
    <div className="pb-4">
      {/* Header */}
      <div className="flex items-center justify-between mt-2 mb-6">
        <div>
          <h1 className="text-2xl font-extrabold text-text">
            {getGreeting()}, {user?.display_name?.split(' ')[0] || 'there'}
          </h1>
          <p className="text-text-muted text-sm mt-0.5">{household.name}</p>
        </div>
        <Avatar name={user?.display_name || '?'} src={user?.avatar_url} />
      </div>

      {/* Task Summary */}
      <TaskSummary householdId={household.id} />
    </div>
  )
}

function TaskSummary({ householdId }: { householdId: string }) {
  const { data: tasks, isLoading } = useTasks(householdId)

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-20 bg-surface rounded-[var(--radius-card)] animate-pulse" />
        ))}
      </div>
    )
  }

  const pendingTasks = tasks?.filter((t) => t.status !== 'done') || []
  const todayStr = new Date().toISOString().split('T')[0]
  const todayTasks = pendingTasks.filter((t) => t.due_date === todayStr)
  const overdueTasks = pendingTasks.filter((t) => t.due_date && t.due_date < todayStr)

  return (
    <div>
      {/* Stats row */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <StatCard label="Open" value={pendingTasks.length} color="text-primary" />
        <StatCard label="Today" value={todayTasks.length} color="text-secondary" />
        <StatCard label="Overdue" value={overdueTasks.length} color="text-accent" />
      </div>

      {/* Recent tasks */}
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-bold text-text">Upcoming tasks</h2>
        <Link to="/tasks" className="text-sm font-medium text-primary">
          View all
        </Link>
      </div>

      {pendingTasks.length === 0 ? (
        <EmptyState />
      ) : (
        <motion.div className="space-y-3">
          {pendingTasks.slice(0, 5).map((task, i) => (
            <motion.div
              key={task.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
            >
              <Card>
                <div className="flex items-start gap-3">
                  <PriorityDot priority={task.priority} />
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-text truncate">{task.title}</p>
                    <p className="text-sm text-text-muted mt-0.5">
                      {task.due_date ? `Due ${task.due_date}` : 'No due date'}
                      {task.category && ` · ${task.category}`}
                    </p>
                  </div>
                </div>
              </Card>
            </motion.div>
          ))}
        </motion.div>
      )}
    </div>
  )
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <Card className="text-center">
      <p className={`text-2xl font-extrabold ${color}`}>{value}</p>
      <p className="text-xs font-medium text-text-muted uppercase tracking-wide mt-1">{label}</p>
    </Card>
  )
}

function EmptyState() {
  return (
    <Card className="text-center py-8">
      <p className="text-4xl mb-3">&#127968;</p>
      <p className="font-semibold text-text">All caught up!</p>
      <p className="text-sm text-text-muted mt-1">Time to put your feet up.</p>
    </Card>
  )
}
```

**Step 4: Commit**

```bash
git add frontend/src/
git commit -m "feat: dashboard with greeting, task summary stats, and upcoming tasks"
```

---

## Task 14: Tasks Module — Full Task Management UI

**Files:**
- Create: `frontend/src/routes/tasks.tsx`
- Create: `frontend/src/components/tasks/task-card.tsx`
- Create: `frontend/src/components/tasks/create-task-sheet.tsx`
- Create: `frontend/src/components/ui/fab.tsx`

**Step 1: Create FAB component**

Create `frontend/src/components/ui/fab.tsx`:

```tsx
import { motion } from 'framer-motion'
import { type ButtonHTMLAttributes } from 'react'

interface FabProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  pulse?: boolean
}

export function Fab({ pulse = false, children, ...props }: FabProps) {
  return (
    <motion.button
      whileTap={{ scale: 0.9 }}
      className={`
        fixed bottom-20 right-4
        w-14 h-14 rounded-full
        bg-gradient-to-r from-primary to-primary-light
        text-white text-2xl font-bold
        shadow-[var(--shadow-fab)]
        flex items-center justify-center
        z-50
        ${pulse ? 'animate-pulse' : ''}
      `}
      {...props}
    >
      {children}
    </motion.button>
  )
}
```

Add to `frontend/src/components/ui/index.ts`:
```typescript
export { Fab } from './fab'
```

**Step 2: Create TaskCard component with swipe**

Create `frontend/src/components/tasks/task-card.tsx`:

```tsx
import { motion, useMotionValue, useTransform, type PanInfo } from 'framer-motion'
import { Card, PriorityDot } from '@/components/ui'
import type { Task } from '@/api/tasks'

interface TaskCardProps {
  task: Task
  onComplete: (id: string) => void
  onDelete: (id: string) => void
}

export function TaskCard({ task, onComplete, onDelete }: TaskCardProps) {
  const x = useMotionValue(0)
  const bgLeft = useTransform(x, [-100, 0], ['#00B894', '#00B89400'])
  const bgRight = useTransform(x, [0, 100], ['#FF6B6B00', '#FF6B6B'])

  const handleDragEnd = (_: any, info: PanInfo) => {
    if (info.offset.x < -80) {
      onComplete(task.id)
    } else if (info.offset.x > 80) {
      onDelete(task.id)
    }
  }

  const isDone = task.status === 'done'

  return (
    <div className="relative overflow-hidden rounded-[var(--radius-card)]">
      {/* Swipe backgrounds */}
      <motion.div className="absolute inset-0 flex items-center justify-start px-4" style={{ backgroundColor: bgRight }}>
        <span className="text-white font-bold text-sm">Delete</span>
      </motion.div>
      <motion.div className="absolute inset-0 flex items-center justify-end px-4" style={{ backgroundColor: bgLeft }}>
        <span className="text-white font-bold text-sm">Done</span>
      </motion.div>

      {/* Card */}
      <motion.div
        drag="x"
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={0.3}
        style={{ x }}
        onDragEnd={handleDragEnd}
      >
        <Card className={isDone ? 'opacity-60' : ''}>
          <div className="flex items-start gap-3">
            <div className="mt-1.5">
              <PriorityDot priority={task.priority} />
            </div>
            <div className="flex-1 min-w-0">
              <p className={`font-semibold text-text truncate ${isDone ? 'line-through' : ''}`}>
                {task.title}
              </p>
              <div className="flex items-center gap-2 mt-1">
                {task.due_date && (
                  <span className="text-xs text-text-muted">{task.due_date}</span>
                )}
                {task.category && (
                  <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                    {task.category}
                  </span>
                )}
              </div>
            </div>
          </div>
        </Card>
      </motion.div>
    </div>
  )
}
```

**Step 3: Create task creation sheet**

Create `frontend/src/components/tasks/create-task-sheet.tsx`:

```tsx
import { motion, AnimatePresence } from 'framer-motion'
import { useState } from 'react'
import { Button, Input } from '@/components/ui'
import type { TaskCreate } from '@/api/tasks'

interface CreateTaskSheetProps {
  open: boolean
  onClose: () => void
  onSubmit: (task: TaskCreate) => void
  isPending: boolean
}

export function CreateTaskSheet({ open, onClose, onSubmit, isPending }: CreateTaskSheetProps) {
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState('')
  const [priority, setPriority] = useState(3)
  const [dueDate, setDueDate] = useState('')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return
    onSubmit({
      title: title.trim(),
      category: category.trim() || undefined,
      priority,
      due_date: dueDate || undefined,
    })
    setTitle('')
    setCategory('')
    setPriority(3)
    setDueDate('')
  }

  const priorities = [
    { value: 1, label: 'Urgent', color: 'bg-priority-urgent' },
    { value: 2, label: 'High', color: 'bg-priority-high' },
    { value: 3, label: 'Normal', color: 'bg-priority-normal' },
    { value: 4, label: 'Low', color: 'bg-priority-low' },
  ]

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/30 z-40"
            onClick={onClose}
          />

          {/* Sheet */}
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="fixed bottom-0 left-0 right-0 bg-surface rounded-t-3xl p-6 pb-[env(safe-area-inset-bottom)] z-50 max-w-lg mx-auto"
          >
            <div className="w-12 h-1.5 bg-black/10 rounded-full mx-auto mb-6" />
            <h2 className="text-xl font-bold text-text mb-4">New task</h2>

            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <Input
                label="What needs to be done?"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                autoFocus
              />
              <Input
                label="Category"
                placeholder="e.g. kitchen, shopping"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              />
              <Input
                label="Due date"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />

              {/* Priority selector */}
              <div>
                <label className="text-sm font-medium text-text-muted mb-2 block">Priority</label>
                <div className="flex gap-2">
                  {priorities.map((p) => (
                    <button
                      key={p.value}
                      type="button"
                      onClick={() => setPriority(p.value)}
                      className={`
                        flex-1 py-2 rounded-xl text-sm font-medium transition-all
                        ${priority === p.value
                          ? `${p.color} text-white shadow-md`
                          : 'bg-black/5 text-text-muted'
                        }
                      `}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              <Button type="submit" disabled={!title.trim() || isPending}>
                {isPending ? 'Adding...' : 'Add task'}
              </Button>
            </form>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
```

**Step 4: Create tasks route**

Create `frontend/src/routes/tasks.tsx`:

```tsx
import { createFileRoute, Navigate } from '@tanstack/react-router'
import { useAuth } from 'react-oidc-context'
import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useHouseholds } from '@/api/households'
import { useTasks, useCreateTask, useUpdateTask, useDeleteTask } from '@/api/tasks'
import { TaskCard } from '@/components/tasks/task-card'
import { CreateTaskSheet } from '@/components/tasks/create-task-sheet'
import { Fab, Card } from '@/components/ui'

export const Route = createFileRoute('/tasks')({
  component: TasksPage,
})

function TasksPage() {
  const auth = useAuth()
  const { data: households } = useHouseholds()
  const [showCreate, setShowCreate] = useState(false)
  const [filter, setFilter] = useState<'all' | 'pending' | 'done'>('all')

  if (!auth.isAuthenticated) return <Navigate to="/login" />
  if (!households?.length) return <Navigate to="/onboarding" />

  const householdId = households[0].id

  return (
    <TasksContent
      householdId={householdId}
      filter={filter}
      setFilter={setFilter}
      showCreate={showCreate}
      setShowCreate={setShowCreate}
    />
  )
}

function TasksContent({
  householdId,
  filter,
  setFilter,
  showCreate,
  setShowCreate,
}: {
  householdId: string
  filter: 'all' | 'pending' | 'done'
  setFilter: (f: 'all' | 'pending' | 'done') => void
  showCreate: boolean
  setShowCreate: (v: boolean) => void
}) {
  const statusFilter = filter === 'all' ? undefined : filter === 'done' ? 'done' : 'pending'
  const { data: tasks, isLoading } = useTasks(householdId, { status: statusFilter })
  const createMutation = useCreateTask(householdId)
  const updateMutation = useUpdateTask(householdId)
  const deleteMutation = useDeleteTask(householdId)

  const filters = [
    { key: 'all' as const, label: 'All' },
    { key: 'pending' as const, label: 'Active' },
    { key: 'done' as const, label: 'Done' },
  ]

  return (
    <div className="pb-4">
      <h1 className="text-2xl font-extrabold text-text mt-2 mb-4">Tasks</h1>

      {/* Filter tabs */}
      <div className="flex gap-2 mb-4">
        {filters.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`
              px-4 py-2 rounded-full text-sm font-medium transition-all
              ${filter === f.key
                ? 'bg-primary text-white'
                : 'bg-black/5 text-text-muted hover:bg-black/10'
              }
            `}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Task list */}
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-20 bg-surface rounded-[var(--radius-card)] animate-pulse" />
          ))}
        </div>
      ) : !tasks?.length ? (
        <Card className="text-center py-8">
          <p className="text-4xl mb-3">&#10024;</p>
          <p className="font-semibold text-text">
            {filter === 'done' ? 'No completed tasks yet' : 'No tasks yet'}
          </p>
          <p className="text-sm text-text-muted mt-1">
            {filter === 'done' ? 'Complete some tasks to see them here.' : 'Tap + to add your first task.'}
          </p>
        </Card>
      ) : (
        <motion.div className="space-y-3">
          <AnimatePresence>
            {tasks.map((task, i) => (
              <motion.div
                key={task.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, x: -200 }}
                transition={{ delay: i * 0.05 }}
              >
                <TaskCard
                  task={task}
                  onComplete={(id) => updateMutation.mutate({ taskId: id, status: 'done' })}
                  onDelete={(id) => deleteMutation.mutate(id)}
                />
              </motion.div>
            ))}
          </AnimatePresence>
        </motion.div>
      )}

      {/* FAB */}
      <Fab pulse={!tasks?.length} onClick={() => setShowCreate(true)}>
        +
      </Fab>

      {/* Create sheet */}
      <CreateTaskSheet
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onSubmit={async (task) => {
          await createMutation.mutateAsync(task)
          setShowCreate(false)
        }}
        isPending={createMutation.isPending}
      />
    </div>
  )
}
```

**Step 5: Commit**

```bash
git add frontend/src/
git commit -m "feat: tasks module with swipe gestures, FAB, and bottom sheet creation"
```

---

## Task 15: Stub Routes (Calendar, Settings)

**Files:**
- Create: `frontend/src/routes/calendar.tsx`
- Create: `frontend/src/routes/settings.tsx`

**Step 1: Create calendar stub**

Create `frontend/src/routes/calendar.tsx`:

```tsx
import { createFileRoute, Navigate } from '@tanstack/react-router'
import { useAuth } from 'react-oidc-context'
import { Card } from '@/components/ui'

export const Route = createFileRoute('/calendar')({
  component: CalendarPage,
})

function CalendarPage() {
  const auth = useAuth()
  if (!auth.isAuthenticated) return <Navigate to="/login" />

  return (
    <div className="pb-4">
      <h1 className="text-2xl font-extrabold text-text mt-2 mb-4">Calendar</h1>
      <Card className="text-center py-12">
        <p className="text-4xl mb-3">&#128197;</p>
        <p className="font-semibold text-text">Coming soon</p>
        <p className="text-sm text-text-muted mt-1">Shared calendar is on the way.</p>
      </Card>
    </div>
  )
}
```

**Step 2: Create settings page**

Create `frontend/src/routes/settings.tsx`:

```tsx
import { createFileRoute, Navigate } from '@tanstack/react-router'
import { useAuth } from 'react-oidc-context'
import { useCurrentUser } from '@/api/user'
import { useHouseholds, useCreateInvite } from '@/api/households'
import { Avatar, Button, Card } from '@/components/ui'
import { useState } from 'react'

export const Route = createFileRoute('/settings')({
  component: SettingsPage,
})

function SettingsPage() {
  const auth = useAuth()
  const { data: user } = useCurrentUser()
  const { data: households } = useHouseholds()

  if (!auth.isAuthenticated) return <Navigate to="/login" />

  const household = households?.[0]

  return (
    <div className="pb-4">
      <h1 className="text-2xl font-extrabold text-text mt-2 mb-6">Settings</h1>

      {/* Profile */}
      <Card className="mb-4">
        <div className="flex items-center gap-4">
          <Avatar name={user?.display_name || '?'} src={user?.avatar_url} size="lg" />
          <div>
            <p className="font-bold text-lg text-text">{user?.display_name}</p>
            <p className="text-sm text-text-muted">{user?.email}</p>
          </div>
        </div>
      </Card>

      {/* Household */}
      {household && (
        <Card className="mb-4">
          <h2 className="font-bold text-text mb-3">Household</h2>
          <p className="text-text-muted mb-4">{household.name}</p>
          <InviteSection householdId={household.id} />
        </Card>
      )}

      {/* Sign out */}
      <Button variant="ghost" className="w-full" onClick={() => auth.signoutRedirect()}>
        Sign out
      </Button>
    </div>
  )
}

function InviteSection({ householdId }: { householdId: string }) {
  const inviteMutation = useCreateInvite(householdId)
  const [code, setCode] = useState<string | null>(null)

  const handleInvite = async () => {
    const result = await inviteMutation.mutateAsync()
    setCode(result.code)
  }

  return (
    <div>
      {code ? (
        <div className="bg-background rounded-xl p-3">
          <p className="text-xs text-text-muted mb-1">Share this invite code:</p>
          <p className="font-mono text-sm text-primary break-all">{code}</p>
        </div>
      ) : (
        <Button variant="secondary" size="sm" onClick={handleInvite} disabled={inviteMutation.isPending}>
          {inviteMutation.isPending ? 'Generating...' : 'Invite member'}
        </Button>
      )}
    </div>
  )
}
```

**Step 3: Commit**

```bash
git add frontend/src/routes/
git commit -m "feat: calendar stub and settings page with invite generation"
```

---

## Task 16: Docker Setup (Dev & Production)

**Files:**
- Create: `backend/Dockerfile`
- Create: `frontend/Dockerfile`
- Create: `docker-compose.yml`
- Create: `docker-compose.prod.yml`
- Create: `nginx/nginx.conf`
- Create: `.env.example`
- Create: `.gitignore`

**Step 1: Create backend Dockerfile**

Create `backend/Dockerfile`:

```dockerfile
FROM python:3.12-slim AS base
WORKDIR /app
RUN pip install uv
COPY pyproject.toml .
RUN uv pip install --system .

FROM base AS dev
COPY . .
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]

FROM base AS prod
COPY . .
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2"]
```

**Step 2: Create frontend Dockerfile**

Create `frontend/Dockerfile`:

```dockerfile
FROM node:22-slim AS base
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM base AS dev
COPY . .
EXPOSE 5173
CMD ["npx", "vite", "--host", "0.0.0.0"]

FROM base AS build
COPY . .
RUN npm run build

FROM nginx:alpine AS prod
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
```

**Step 3: Create nginx config for frontend (production)**

Create `nginx/nginx.conf`:

```nginx
server {
    listen 8080;
    root /usr/share/nginx/html;
    index index.html;

    # Frontend SPA fallback
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Proxy API to backend
    location /api/ {
        proxy_pass http://backend:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Also create `frontend/nginx.conf` (same content, used in the frontend prod Dockerfile):

```nginx
server {
    listen 80;
    root /usr/share/nginx/html;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

**Step 4: Create docker-compose.yml (dev)**

Create `docker-compose.yml`:

```yaml
services:
  backend:
    build:
      context: ./backend
      target: dev
    volumes:
      - ./backend/app:/app/app
      - nesto-data:/app/data
    ports:
      - "8000:8000"
    env_file: .env
    restart: unless-stopped

  frontend:
    build:
      context: ./frontend
      target: dev
    volumes:
      - ./frontend/src:/app/src
      - ./frontend/index.html:/app/index.html
    ports:
      - "5173:5173"
    env_file: .env
    depends_on:
      - backend
    restart: unless-stopped

volumes:
  nesto-data:
```

**Step 5: Create docker-compose.prod.yml**

Create `docker-compose.prod.yml`:

```yaml
services:
  backend:
    build:
      context: ./backend
      target: prod
    volumes:
      - nesto-data:/app/data
    env_file: .env
    restart: unless-stopped

  frontend:
    build:
      context: ./frontend
      target: prod
    ports:
      - "8080:80"
    depends_on:
      - backend
    restart: unless-stopped

  nginx:
    image: nginx:alpine
    ports:
      - "8080:8080"
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/conf.d/default.conf:ro
    depends_on:
      - backend
      - frontend
    restart: unless-stopped

volumes:
  nesto-data:
```

**Step 6: Create .env.example**

Create `.env.example`:

```env
# OIDC / Authentik
OIDC_ISSUER_URL=https://auth.example.com/application/o/nesto
OIDC_CLIENT_ID=nesto-client-id
OIDC_CLIENT_SECRET=nesto-client-secret

# Frontend OIDC (VITE_ prefix makes them available in the browser)
VITE_OIDC_AUTHORITY=https://auth.example.com/application/o/nesto
VITE_OIDC_CLIENT_ID=nesto-client-id
VITE_OIDC_REDIRECT_URI=https://nesto.example.com/callback

# App
SECRET_KEY=change-me-to-a-random-string
DATABASE_URL=sqlite+aiosqlite:///./data/nesto.db
CORS_ORIGINS=["http://localhost:5173"]
ENVIRONMENT=development
```

**Step 7: Create root .gitignore**

Create `.gitignore`:

```
.env
node_modules/
__pycache__/
*.pyc
dist/
*.db
*.db-wal
*.db-shm
.venv/
```

**Step 8: Add build script to frontend package.json**

Ensure `frontend/package.json` has:
```json
{
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview"
  }
}
```

**Step 9: Test dev compose**

```bash
docker compose up --build
```

Verify: `http://localhost:5173` loads the app, `http://localhost:8000/api/health` returns ok.

**Step 10: Commit**

```bash
git add docker-compose.yml docker-compose.prod.yml nginx/ .env.example .gitignore backend/Dockerfile frontend/Dockerfile frontend/nginx.conf
git commit -m "feat: Docker setup for dev (hot reload) and production"
```

---

## Summary

| Task | Description | Key Output |
|------|-------------|------------|
| 1 | Backend scaffolding | FastAPI app with health endpoint |
| 2 | Database models | User, Household, Task SQLAlchemy models |
| 3 | Alembic migrations | Async migration setup + initial schema |
| 4 | Auth dependency | JWT validation against Authentik JWKS |
| 5 | Auth API | /api/auth/me with user upsert |
| 6 | Household API | CRUD + invite/join |
| 7 | Tasks API | CRUD with filtering |
| 8 | Frontend scaffolding | React + Vite + Tailwind v4 + TanStack Router |
| 9 | Design system | Button, Card, Input, Avatar, PriorityDot |
| 10 | OIDC auth | react-oidc-context integration + API client |
| 11 | App shell | Root route, bottom nav, login/callback |
| 12 | Onboarding | Create/join household screens |
| 13 | Dashboard | Greeting, stats, upcoming tasks |
| 14 | Tasks module | Full task list with swipe, FAB, create sheet |
| 15 | Stub routes | Calendar (coming soon), Settings with invite |
| 16 | Docker | Dev compose (hot reload) + production compose |
