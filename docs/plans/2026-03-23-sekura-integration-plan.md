# Sekura Integration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace Nesto's local document storage with Sekura as the document backend via a thin proxy, giving users hierarchical folder browsing, versioning, trash, and sharing.

**Architecture:** Nesto backend proxies all Sekura REST API calls using per-user encrypted API keys. A single `SekuraService` class wraps httpx calls. Frontend folder-browsing UI replaces the flat document list. Thumbnails cached locally.

**Tech Stack:** FastAPI, httpx (async streaming), Fernet encryption, Pillow, React 19, TanStack Router/Query, Tailwind CSS v4, Framer Motion

**Design doc:** `docs/plans/2026-03-23-sekura-integration-design.md`

---

## Phase 0: Foundation

### Task 1: Add SEKURA_URL to backend config

**Files:**
- Modify: `backend/app/config.py`
- Test: `backend/tests/test_sekura.py` (create)

**Step 1: Write the test**

```python
# backend/tests/test_sekura.py
import pytest
from app.config import Settings

def test_sekura_url_default_empty():
    """SEKURA_URL defaults to empty string when not set."""
    s = Settings(
        secret_key="a" * 32,
        oidc_issuer_url="https://auth.example.com",
        oidc_client_id="test",
    )
    assert s.sekura_url == ""
```

**Step 2: Run test, verify it fails**

Run: `cd backend && python -m pytest tests/test_sekura.py::test_sekura_url_default_empty -v`
Expected: FAIL — `Settings` has no field `sekura_url`

**Step 3: Add the field to config.py**

In `backend/app/config.py`, add after the `cors_origins` field (around line 11):

```python
sekura_url: str = ""
```

**Step 4: Run test, verify it passes**

Run: `cd backend && python -m pytest tests/test_sekura.py::test_sekura_url_default_empty -v`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/app/config.py backend/tests/test_sekura.py
git commit -m "feat(sekura): add SEKURA_URL config field"
```

---

### Task 2: SekuraConnection model

**Files:**
- Create: `backend/app/models/sekura.py`
- Modify: `backend/app/models/__init__.py`

**Step 1: Write the test**

Add to `backend/tests/test_sekura.py`:

```python
import uuid
from datetime import datetime, timezone
from sqlalchemy import select
from app.models.sekura import SekuraConnection

@pytest.mark.asyncio
async def test_sekura_connection_model(db_session):
    conn = SekuraConnection(
        id=str(uuid.uuid4()),
        user_id="test-user-id",
        encrypted_api_key="encrypted-value",
        key_scope="readwrite",
    )
    db_session.add(conn)
    await db_session.commit()

    result = await db_session.execute(
        select(SekuraConnection).where(SekuraConnection.user_id == "test-user-id")
    )
    saved = result.scalar_one()
    assert saved.key_scope == "readwrite"
    assert saved.encrypted_api_key == "encrypted-value"
    assert saved.created_at is not None
```

This test needs the db_session fixture. Add these fixtures at the top of the test file (follow the pattern from `test_birthdays.py`):

```python
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from app.database import Base
from app.models import *  # noqa: ensure all models registered

@pytest_asyncio.fixture
async def db_session():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    session_maker = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with session_maker() as session:
        # Seed a test user
        from app.models.user import User
        user = User(id="test-user-id", email="test@example.com", display_name="Test User")
        session.add(user)
        await session.commit()
        yield session
    await engine.dispose()
```

**Step 2: Run test, verify it fails**

Run: `cd backend && python -m pytest tests/test_sekura.py::test_sekura_connection_model -v`
Expected: FAIL — `SekuraConnection` does not exist

**Step 3: Create the model**

```python
# backend/app/models/sekura.py
from datetime import datetime, timezone
from sqlalchemy import Column, DateTime, ForeignKey, Index, Text
from app.database import Base

class SekuraConnection(Base):
    __tablename__ = "sekura_connections"

    id = Column(Text, primary_key=True)
    user_id = Column(Text, ForeignKey("users.id"), nullable=False, unique=True)
    encrypted_api_key = Column(Text, nullable=False)
    key_scope = Column(Text, nullable=False, default="readwrite")
    created_at = Column(
        DateTime, default=lambda: datetime.now(timezone.utc), nullable=False
    )

    __table_args__ = (Index("ix_sekura_connections_user_id", "user_id"),)
```

Update `backend/app/models/__init__.py` — add import:

```python
from app.models.sekura import SekuraConnection
```

And add `"SekuraConnection"` to `__all__`.

**Step 4: Run test, verify it passes**

Run: `cd backend && python -m pytest tests/test_sekura.py -v`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/app/models/sekura.py backend/app/models/__init__.py backend/tests/test_sekura.py
git commit -m "feat(sekura): add SekuraConnection model"
```

---

### Task 3: Sekura Pydantic schemas

**Files:**
- Create: `backend/app/schemas/sekura.py`

**Step 1: Write the test**

Add to `backend/tests/test_sekura.py`:

```python
from app.schemas.sekura import (
    SekuraConnectionCreate,
    SekuraConnectionResponse,
    SekuraTestResponse,
)

def test_sekura_connection_create_schema():
    data = SekuraConnectionCreate(api_key="sk_sekura_abc123")
    assert data.api_key == "sk_sekura_abc123"

def test_sekura_connection_response_schema():
    resp = SekuraConnectionResponse(configured=True, key_scope="readwrite")
    assert resp.configured is True
    assert resp.key_scope == "readwrite"

def test_sekura_test_response_schema():
    resp = SekuraTestResponse(ok=True)
    assert resp.ok is True
    assert resp.error is None
```

**Step 2: Run test, verify it fails**

Run: `cd backend && python -m pytest tests/test_sekura.py::test_sekura_connection_create_schema -v`
Expected: FAIL — module does not exist

**Step 3: Create schemas**

```python
# backend/app/schemas/sekura.py
from pydantic import BaseModel

class SekuraConnectionCreate(BaseModel):
    api_key: str

class SekuraConnectionResponse(BaseModel):
    configured: bool
    key_scope: str | None = None

class SekuraTestResponse(BaseModel):
    ok: bool
    error: str | None = None

# Sekura API response models (what Sekura returns, mapped for Nesto's frontend)

class SekuraFolder(BaseModel):
    id: str
    name: str
    parent_id: str | None = None
    created_at: str
    item_count: int = 0

class SekuraFolderAncestor(BaseModel):
    id: str
    name: str

class SekuraFile(BaseModel):
    id: str
    name: str
    mime_type: str | None = None
    size: int
    folder_id: str | None = None
    created_at: str
    updated_at: str | None = None

class SekuraFolderContents(BaseModel):
    folder: SekuraFolder | None = None
    ancestors: list[SekuraFolderAncestor] = []
    folders: list[SekuraFolder] = []
    files: list[SekuraFile] = []

class SekuraCreateFolder(BaseModel):
    name: str
    parent_id: str | None = None

class SekuraRenameRequest(BaseModel):
    name: str

class SekuraMoveRequest(BaseModel):
    parent_id: str | None = None

class SekuraFileVersion(BaseModel):
    id: str
    version_number: int
    size: int
    created_at: str

class SekuraTrashItem(BaseModel):
    id: str
    name: str
    type: str  # "file" or "folder"
    deleted_at: str

class SekuraShare(BaseModel):
    id: str
    resource_type: str
    resource_id: str
    shared_with: str
    shared_with_name: str | None = None
    permission: str
    created_at: str

class SekuraCreateShare(BaseModel):
    resource_type: str
    resource_id: str
    shared_with: str
    permission: str

class SekuraUpdateShare(BaseModel):
    permission: str

class SekuraUser(BaseModel):
    id: str
    email: str
    display_name: str | None = None
```

**Step 4: Run tests, verify they pass**

Run: `cd backend && python -m pytest tests/test_sekura.py -v`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/app/schemas/sekura.py backend/tests/test_sekura.py
git commit -m "feat(sekura): add Pydantic request/response schemas"
```

---

### Task 4: Alembic migration

**Files:**
- Create: `backend/alembic/versions/<timestamp>_replace_documents_with_sekura.py`

**Step 1: Generate migration**

```bash
cd backend && alembic revision --autogenerate -m "replace_documents_with_sekura"
```

**Step 2: Verify the migration**

The autogenerated migration should:
1. Create `sekura_connections` table
2. Drop `document_tag_links`, `document_tags`, `documents` tables

Review and adjust if needed. The drop order matters due to FK constraints — `document_tag_links` first, then `document_tags`, then `documents`.

**Step 3: Run migration**

```bash
cd backend && alembic upgrade head
```

**Step 4: Verify**

```bash
cd backend && python -c "
import sqlite3
conn = sqlite3.connect('../data/nesto.db')
tables = [r[0] for r in conn.execute(\"SELECT name FROM sqlite_master WHERE type='table'\").fetchall()]
assert 'sekura_connections' in tables, 'sekura_connections missing'
assert 'documents' not in tables, 'documents table still exists'
assert 'document_tags' not in tables, 'document_tags table still exists'
print('Migration verified OK')
conn.close()
"
```

**Step 5: Commit**

```bash
git add backend/alembic/versions/
git commit -m "migrate: replace document tables with sekura_connections"
```

---

### Task 5: Remove old document code

**Files:**
- Delete: `backend/app/models/document.py`
- Delete: `backend/app/services/document_service.py`
- Delete: `backend/app/schemas/document.py`
- Delete: `backend/app/routers/documents.py`
- Modify: `backend/app/models/__init__.py` — remove Document, DocumentTag, DocumentTagLink imports and __all__ entries
- Modify: `backend/app/main.py` — remove document router import (line 12), registration (lines 147-148), and `os.makedirs("data/documents")` (line 104)

**Step 1: Remove files**

```bash
rm backend/app/models/document.py
rm backend/app/services/document_service.py
rm backend/app/schemas/document.py
rm backend/app/routers/documents.py
```

**Step 2: Update imports in models/__init__.py**

Remove the line importing `Document, DocumentTag, DocumentTagLink` and remove them from `__all__`.

**Step 3: Update main.py**

- Remove `from app.routers import documents` import
- Remove `app.include_router(documents.router, ...)` and `app.include_router(documents.tags_router, ...)` lines
- Remove `os.makedirs("data/documents", exist_ok=True)`

**Step 4: Run existing tests to verify nothing else broke**

```bash
cd backend && python -m pytest tests/ -v --ignore=tests/test_sekura.py
```

Expected: Existing tests still pass (document tests may need to be removed too if they exist).

**Step 5: Commit**

```bash
git add -A
git commit -m "refactor: remove local document storage code"
```

---

### Task 6: httpx client in lifespan + SekuraService skeleton

**Files:**
- Modify: `backend/app/main.py` — add httpx client to lifespan
- Create: `backend/app/services/sekura_service.py`

**Step 1: Write the test**

Add to `backend/tests/test_sekura.py`:

```python
import httpx
from app.services.sekura_service import SekuraService

@pytest.mark.asyncio
async def test_sekura_service_init():
    async with httpx.AsyncClient() as client:
        service = SekuraService(base_url="https://sekura.example.com", client=client)
        assert service.base_url == "https://sekura.example.com"
```

**Step 2: Run test, verify it fails**

Run: `cd backend && python -m pytest tests/test_sekura.py::test_sekura_service_init -v`
Expected: FAIL — module does not exist

**Step 3: Create SekuraService skeleton and update lifespan**

```python
# backend/app/services/sekura_service.py
import httpx
from starlette.responses import StreamingResponse

class SekuraService:
    def __init__(self, base_url: str, client: httpx.AsyncClient):
        self.base_url = base_url.rstrip("/")
        self.client = client

    def _headers(self, api_key: str) -> dict:
        return {"Authorization": f"Bearer {api_key}"}

    def _url(self, path: str) -> str:
        return f"{self.base_url}/api/v1{path}"
```

In `backend/app/main.py` lifespan, add after existing setup:

```python
import httpx

# Inside lifespan, before yield:
app.state.httpx_client = httpx.AsyncClient(
    timeout=httpx.Timeout(30.0, read=300.0),
    limits=httpx.Limits(max_connections=20, max_keepalive_connections=10),
)
if settings.sekura_url:
    from app.services.sekura_service import SekuraService
    app.state.sekura = SekuraService(
        base_url=settings.sekura_url,
        client=app.state.httpx_client,
    )

# After yield (cleanup):
await app.state.httpx_client.aclose()
```

**Step 4: Run tests**

Run: `cd backend && python -m pytest tests/test_sekura.py -v`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/app/services/sekura_service.py backend/app/main.py backend/tests/test_sekura.py
git commit -m "feat(sekura): add httpx client lifecycle and SekuraService skeleton"
```

---

## Phase 1: Connection Management

### Task 7: Sekura connection service (CRUD + test)

**Files:**
- Create: `backend/app/services/sekura_connection_service.py`

Follow the pattern from `backend/app/services/calendar_connection_service.py` — encrypt on save, decrypt on read.

**Step 1: Write the tests**

Add to `backend/tests/test_sekura.py`:

```python
from app.services.sekura_connection_service import (
    get_sekura_connection,
    save_sekura_connection,
    delete_sekura_connection,
    get_decrypted_api_key,
)

@pytest.mark.asyncio
async def test_save_and_get_sekura_connection(db_session):
    await save_sekura_connection(db_session, "test-user-id", "sk_sekura_test123", "readwrite")
    conn = await get_sekura_connection(db_session, "test-user-id")
    assert conn is not None
    assert conn.key_scope == "readwrite"
    # encrypted_api_key should NOT be the plaintext
    assert conn.encrypted_api_key != "sk_sekura_test123"

@pytest.mark.asyncio
async def test_get_decrypted_api_key(db_session):
    await save_sekura_connection(db_session, "test-user-id", "sk_sekura_test123", "readwrite")
    key = await get_decrypted_api_key(db_session, "test-user-id")
    assert key == "sk_sekura_test123"

@pytest.mark.asyncio
async def test_delete_sekura_connection(db_session):
    await save_sekura_connection(db_session, "test-user-id", "sk_sekura_test123", "readwrite")
    await delete_sekura_connection(db_session, "test-user-id")
    conn = await get_sekura_connection(db_session, "test-user-id")
    assert conn is None

@pytest.mark.asyncio
async def test_save_sekura_connection_overwrites(db_session):
    await save_sekura_connection(db_session, "test-user-id", "sk_sekura_old", "read")
    await save_sekura_connection(db_session, "test-user-id", "sk_sekura_new", "readwrite")
    key = await get_decrypted_api_key(db_session, "test-user-id")
    assert key == "sk_sekura_new"
    conn = await get_sekura_connection(db_session, "test-user-id")
    assert conn.key_scope == "readwrite"
```

**Step 2: Run tests, verify they fail**

**Step 3: Implement**

```python
# backend/app/services/sekura_connection_service.py
import uuid
from sqlalchemy import select, delete as sa_delete
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.sekura import SekuraConnection
from app.services.crypto_service import encrypt_password, decrypt_password

async def get_sekura_connection(db: AsyncSession, user_id: str) -> SekuraConnection | None:
    result = await db.execute(
        select(SekuraConnection).where(SekuraConnection.user_id == user_id)
    )
    return result.scalar_one_or_none()

async def save_sekura_connection(
    db: AsyncSession, user_id: str, api_key: str, key_scope: str
) -> SekuraConnection:
    existing = await get_sekura_connection(db, user_id)
    encrypted = encrypt_password(api_key)
    if existing:
        existing.encrypted_api_key = encrypted
        existing.key_scope = key_scope
    else:
        existing = SekuraConnection(
            id=str(uuid.uuid4()),
            user_id=user_id,
            encrypted_api_key=encrypted,
            key_scope=key_scope,
        )
        db.add(existing)
    await db.commit()
    await db.refresh(existing)
    return existing

async def delete_sekura_connection(db: AsyncSession, user_id: str) -> None:
    await db.execute(
        sa_delete(SekuraConnection).where(SekuraConnection.user_id == user_id)
    )
    await db.commit()

async def get_decrypted_api_key(db: AsyncSession, user_id: str) -> str | None:
    conn = await get_sekura_connection(db, user_id)
    if conn is None:
        return None
    return decrypt_password(conn.encrypted_api_key)
```

**Step 4: Run tests, verify they pass**

Run: `cd backend && python -m pytest tests/test_sekura.py -v`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/app/services/sekura_connection_service.py backend/tests/test_sekura.py
git commit -m "feat(sekura): add connection CRUD service with encryption"
```

---

### Task 8: Sekura connection API routes

**Files:**
- Modify: `backend/app/routers/auth.py` — add /me/sekura endpoints
- Or create: `backend/app/routers/sekura_connection.py` (if auth.py would get too large)

**Step 1: Write integration tests**

Add to `backend/tests/test_sekura.py`. Need a full `client` fixture with the FastAPI test client:

```python
from app.main import app
from app.database import get_db
from app.auth import get_current_user_id

@pytest_asyncio.fixture
async def client(db_session):
    async def override_db():
        yield db_session

    async def override_user():
        return "test-user-id"

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_current_user_id] = override_user
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as c:
        yield c
    app.dependency_overrides.clear()

@pytest.mark.asyncio
async def test_get_sekura_connection_not_configured(client):
    resp = await client.get("/api/auth/me/sekura")
    assert resp.status_code == 200
    assert resp.json() == {"configured": False, "key_scope": None}

@pytest.mark.asyncio
async def test_save_sekura_connection_api(client):
    resp = await client.post("/api/auth/me/sekura", json={"api_key": "sk_sekura_test"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["configured"] is True

@pytest.mark.asyncio
async def test_delete_sekura_connection_api(client):
    await client.post("/api/auth/me/sekura", json={"api_key": "sk_sekura_test"})
    resp = await client.delete("/api/auth/me/sekura")
    assert resp.status_code == 200
    # Verify it's gone
    check = await client.get("/api/auth/me/sekura")
    assert check.json()["configured"] is False
```

**Step 2: Run tests, verify they fail**

**Step 3: Implement the routes**

Add to `backend/app/routers/auth.py`:

```python
from app.schemas.sekura import SekuraConnectionCreate, SekuraConnectionResponse, SekuraTestResponse
from app.services.sekura_connection_service import (
    get_sekura_connection,
    save_sekura_connection,
    delete_sekura_connection,
)

@router.get("/me/sekura", response_model=SekuraConnectionResponse)
async def get_my_sekura(
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    conn = await get_sekura_connection(db, user_id)
    if conn is None:
        return SekuraConnectionResponse(configured=False)
    return SekuraConnectionResponse(configured=True, key_scope=conn.key_scope)

@router.post("/me/sekura", response_model=SekuraConnectionResponse)
async def save_my_sekura(
    body: SekuraConnectionCreate,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    # TODO: In Task 9, validate the key against Sekura before saving
    conn = await save_sekura_connection(db, user_id, body.api_key, "readwrite")
    return SekuraConnectionResponse(configured=True, key_scope=conn.key_scope)

@router.delete("/me/sekura")
async def delete_my_sekura(
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    await delete_sekura_connection(db, user_id)
    return {"ok": True}
```

**Step 4: Run tests, verify they pass**

**Step 5: Commit**

```bash
git add backend/app/routers/auth.py backend/tests/test_sekura.py
git commit -m "feat(sekura): add connection management API routes"
```

---

### Task 9: Test connection endpoint + key scope detection

**Files:**
- Modify: `backend/app/routers/auth.py` — add POST /me/sekura/test
- Modify: `backend/app/services/sekura_service.py` — add `test_connection` method

**Step 1: Write the test**

```python
@pytest.mark.asyncio
async def test_sekura_test_connection_no_key(client):
    resp = await client.post("/api/auth/me/sekura/test")
    assert resp.status_code == 200
    assert resp.json()["ok"] is False
    assert "not configured" in resp.json()["error"].lower()
```

For testing with a real Sekura, we'll mock httpx. Add:

```python
from unittest.mock import AsyncMock, patch

@pytest.mark.asyncio
async def test_sekura_test_connection_success(client, db_session):
    # Save a connection first
    await client.post("/api/auth/me/sekura", json={"api_key": "sk_sekura_test"})

    mock_resp = AsyncMock()
    mock_resp.status_code = 200
    mock_resp.is_success = True
    mock_resp.json.return_value = {"status": "ok", "db": True}

    with patch.object(app.state, "sekura", create=True) as mock_sekura:
        mock_sekura.test_connection = AsyncMock(return_value=(True, None))
        resp = await client.post("/api/auth/me/sekura/test")
        assert resp.status_code == 200
        assert resp.json()["ok"] is True
```

**Step 2: Run tests, verify they fail**

**Step 3: Implement**

Add to `SekuraService`:

```python
async def test_connection(self, api_key: str) -> tuple[bool, str | None]:
    """Test connection to Sekura. Returns (ok, error_message)."""
    try:
        resp = await self.client.get(
            self._url("/health"),
            headers=self._headers(api_key),
            timeout=10.0,
        )
        if not resp.is_success:
            return False, f"Sekura returned {resp.status_code}"

        # Verify the API key works
        me_resp = await self.client.get(
            self._url("/auth/me"),
            headers=self._headers(api_key),
            timeout=10.0,
        )
        if not me_resp.is_success:
            return False, "API key is invalid"

        return True, None
    except httpx.ConnectError:
        return False, "Could not connect to Sekura"
    except httpx.TimeoutException:
        return False, "Connection timed out"
    except Exception as e:
        return False, str(e)

async def detect_key_scope(self, api_key: str) -> str:
    """Detect whether a Sekura API key is read or readwrite."""
    try:
        resp = await self.client.get(
            self._url("/api-keys"),
            headers=self._headers(api_key),
            timeout=10.0,
        )
        if resp.is_success:
            keys = resp.json()
            # Match by prefix from the key
            key_prefix = api_key[:20]
            for k in keys:
                if k.get("prefix") and key_prefix.startswith(k["prefix"]):
                    return k.get("scope", "readwrite")
        return "readwrite"  # default assumption
    except Exception:
        return "readwrite"
```

Add route to `auth.py`:

```python
@router.post("/me/sekura/test", response_model=SekuraTestResponse)
async def test_my_sekura(
    request: Request,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    from app.services.sekura_connection_service import get_decrypted_api_key

    api_key = await get_decrypted_api_key(db, user_id)
    if api_key is None:
        return SekuraTestResponse(ok=False, error="Sekura not configured")

    sekura = request.app.state.sekura if hasattr(request.app.state, "sekura") else None
    if sekura is None:
        return SekuraTestResponse(ok=False, error="Sekura not enabled on this server")

    ok, error = await sekura.test_connection(api_key)
    return SekuraTestResponse(ok=ok, error=error)
```

Also update the POST /me/sekura save endpoint to detect scope when Sekura is configured:

```python
@router.post("/me/sekura", response_model=SekuraConnectionResponse)
async def save_my_sekura(
    body: SekuraConnectionCreate,
    request: Request,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    key_scope = "readwrite"
    sekura = getattr(request.app.state, "sekura", None)
    if sekura:
        ok, error = await sekura.test_connection(body.api_key)
        if not ok:
            raise HTTPException(status_code=400, detail=f"Invalid Sekura API key: {error}")
        key_scope = await sekura.detect_key_scope(body.api_key)

    conn = await save_sekura_connection(db, user_id, body.api_key, key_scope)
    return SekuraConnectionResponse(configured=True, key_scope=conn.key_scope)
```

**Step 4: Run tests, verify they pass**

**Step 5: Commit**

```bash
git add backend/app/services/sekura_service.py backend/app/routers/auth.py backend/tests/test_sekura.py
git commit -m "feat(sekura): add test connection endpoint with key scope detection"
```

---

## Phase 2: Sekura Proxy (Backend)

### Task 10: SekuraService — folder operations

**Files:**
- Modify: `backend/app/services/sekura_service.py`

**Step 1: Write tests**

```python
@pytest.mark.asyncio
async def test_sekura_service_list_root_folders():
    """Test that list_root_folders calls the correct Sekura endpoint."""
    mock_response = AsyncMock()
    mock_response.is_success = True
    mock_response.status_code = 200
    mock_response.json.return_value = [
        {"id": "f1", "name": "Documents", "parent_id": None, "created_at": "2026-01-01T00:00:00Z"}
    ]

    mock_client = AsyncMock(spec=httpx.AsyncClient)
    mock_client.get = AsyncMock(return_value=mock_response)

    service = SekuraService(base_url="https://sekura.test", client=mock_client)
    result = await service.list_root_folders("test-key")

    mock_client.get.assert_called_once()
    call_url = mock_client.get.call_args[0][0]
    assert "/folders" in call_url
    assert len(result) == 1
    assert result[0]["name"] == "Documents"
```

**Step 2: Run test, verify it fails**

**Step 3: Implement folder methods**

Add to `SekuraService`:

```python
from fastapi import HTTPException
import logging

logger = logging.getLogger(__name__)

def _raise_for_error(self, resp: httpx.Response) -> None:
    if resp.is_success:
        return
    try:
        body = resp.json()
        detail = body.get("detail", resp.reason_phrase)
    except Exception:
        detail = resp.reason_phrase

    status_map = {
        400: 400,
        401: 502,
        403: 502,
        404: 404,
        413: 413,
        429: 503,
    }
    status = status_map.get(resp.status_code, 502)
    raise HTTPException(status_code=status, detail=detail)

async def list_root_folders(self, api_key: str) -> list[dict]:
    resp = await self.client.get(self._url("/folders"), headers=self._headers(api_key))
    self._raise_for_error(resp)
    return resp.json()

async def get_folder(self, api_key: str, folder_id: str) -> dict:
    resp = await self.client.get(
        self._url(f"/folders/{folder_id}"), headers=self._headers(api_key)
    )
    self._raise_for_error(resp)
    return resp.json()

async def get_folder_contents(self, api_key: str, folder_id: str | None = None) -> dict:
    if folder_id:
        url = self._url(f"/folders/{folder_id}/contents")
    else:
        url = self._url("/folders/root/contents")
    resp = await self.client.get(url, headers=self._headers(api_key))
    self._raise_for_error(resp)
    return resp.json()

async def get_folder_tree(self, api_key: str) -> list[dict]:
    resp = await self.client.get(self._url("/folders/tree"), headers=self._headers(api_key))
    self._raise_for_error(resp)
    return resp.json()

async def create_folder(self, api_key: str, name: str, parent_id: str | None = None) -> dict:
    body = {"name": name}
    if parent_id:
        body["parent_id"] = parent_id
    resp = await self.client.post(
        self._url("/folders"), headers=self._headers(api_key), json=body
    )
    self._raise_for_error(resp)
    return resp.json()

async def rename_folder(self, api_key: str, folder_id: str, name: str) -> dict:
    resp = await self.client.put(
        self._url(f"/folders/{folder_id}"),
        headers=self._headers(api_key),
        json={"name": name},
    )
    self._raise_for_error(resp)
    return resp.json()

async def move_folder(self, api_key: str, folder_id: str, parent_id: str | None) -> dict:
    resp = await self.client.put(
        self._url(f"/folders/{folder_id}"),
        headers=self._headers(api_key),
        json={"parent_folder_id": parent_id},
    )
    self._raise_for_error(resp)
    return resp.json()

async def delete_folder(self, api_key: str, folder_id: str) -> None:
    resp = await self.client.delete(
        self._url(f"/folders/{folder_id}"), headers=self._headers(api_key)
    )
    self._raise_for_error(resp)
```

**Step 4: Run tests, verify they pass**

**Step 5: Commit**

```bash
git add backend/app/services/sekura_service.py backend/tests/test_sekura.py
git commit -m "feat(sekura): implement folder proxy operations"
```

---

### Task 11: SekuraService — file operations

**Files:**
- Modify: `backend/app/services/sekura_service.py`

**Step 1: Write tests** (following same mock pattern as Task 10)

Test `upload_file`, `get_file`, `download_file`, `rename_file`, `move_file`, `delete_file`.

**Step 2: Run tests, verify they fail**

**Step 3: Implement**

```python
async def upload_file(
    self, api_key: str, file: "UploadFile", folder_id: str | None = None
) -> dict:
    data = {}
    if folder_id:
        data["folder_id"] = folder_id
    files = {"file": (file.filename, file.file, file.content_type)}
    resp = await self.client.post(
        self._url("/files"),
        headers=self._headers(api_key),
        files=files,
        data=data,
        timeout=httpx.Timeout(30.0, read=300.0, write=300.0),
    )
    self._raise_for_error(resp)
    return resp.json()

async def get_file(self, api_key: str, file_id: str) -> dict:
    resp = await self.client.get(
        self._url(f"/files/{file_id}"), headers=self._headers(api_key)
    )
    self._raise_for_error(resp)
    return resp.json()

async def download_file_stream(self, api_key: str, file_id: str):
    """Returns an httpx Response in streaming mode. Caller must close it."""
    req = self.client.build_request(
        "GET",
        self._url(f"/files/{file_id}/download"),
        headers=self._headers(api_key),
    )
    resp = await self.client.send(req, stream=True)
    self._raise_for_error(resp)
    return resp

async def rename_file(self, api_key: str, file_id: str, name: str) -> dict:
    resp = await self.client.put(
        self._url(f"/files/{file_id}"),
        headers=self._headers(api_key),
        json={"name": name},
    )
    self._raise_for_error(resp)
    return resp.json()

async def move_file(self, api_key: str, file_id: str, folder_id: str | None) -> dict:
    resp = await self.client.put(
        self._url(f"/files/{file_id}"),
        headers=self._headers(api_key),
        json={"parent_folder_id": folder_id},
    )
    self._raise_for_error(resp)
    return resp.json()

async def delete_file(self, api_key: str, file_id: str) -> None:
    resp = await self.client.delete(
        self._url(f"/files/{file_id}"), headers=self._headers(api_key)
    )
    self._raise_for_error(resp)
```

**Step 4: Run tests, verify they pass**

**Step 5: Commit**

```bash
git add backend/app/services/sekura_service.py backend/tests/test_sekura.py
git commit -m "feat(sekura): implement file proxy operations"
```

---

### Task 12: SekuraService — versioning, trash, sharing

**Files:**
- Modify: `backend/app/services/sekura_service.py`

**Step 1: Write tests** (same mock pattern)

**Step 2: Run tests, verify they fail**

**Step 3: Implement**

```python
# Versioning
async def upload_new_version(self, api_key: str, file_id: str, file: "UploadFile") -> dict:
    files = {"file": (file.filename, file.file, file.content_type)}
    resp = await self.client.post(
        self._url(f"/files/{file_id}/upload"),
        headers=self._headers(api_key),
        files=files,
        timeout=httpx.Timeout(30.0, read=300.0, write=300.0),
    )
    self._raise_for_error(resp)
    return resp.json()

async def list_versions(self, api_key: str, file_id: str) -> list[dict]:
    resp = await self.client.get(
        self._url(f"/files/{file_id}/versions"), headers=self._headers(api_key)
    )
    self._raise_for_error(resp)
    return resp.json()

async def download_version_stream(self, api_key: str, file_id: str, version_id: str):
    req = self.client.build_request(
        "GET",
        self._url(f"/files/{file_id}/versions/{version_id}/download"),
        headers=self._headers(api_key),
    )
    resp = await self.client.send(req, stream=True)
    self._raise_for_error(resp)
    return resp

# Trash
async def list_trash(self, api_key: str) -> list[dict]:
    resp = await self.client.get(self._url("/trash"), headers=self._headers(api_key))
    self._raise_for_error(resp)
    return resp.json()

async def restore_item(self, api_key: str, item_type: str, item_id: str) -> None:
    resp = await self.client.post(
        self._url(f"/trash/{item_type}/{item_id}/restore"),
        headers=self._headers(api_key),
    )
    self._raise_for_error(resp)

async def delete_permanently(self, api_key: str, item_type: str, item_id: str) -> None:
    resp = await self.client.delete(
        self._url(f"/trash/{item_type}/{item_id}"),
        headers=self._headers(api_key),
    )
    self._raise_for_error(resp)

async def empty_trash(self, api_key: str) -> None:
    resp = await self.client.delete(self._url("/trash"), headers=self._headers(api_key))
    self._raise_for_error(resp)

# Sharing
async def create_share(
    self, api_key: str, resource_type: str, resource_id: str,
    shared_with: str, permission: str,
) -> dict:
    resp = await self.client.post(
        self._url("/shares"),
        headers=self._headers(api_key),
        json={
            "resource_type": resource_type,
            "resource_id": resource_id,
            "shared_with": shared_with,
            "permission": permission,
        },
    )
    self._raise_for_error(resp)
    return resp.json()

async def list_shares(self, api_key: str, share_type: str = "owned") -> list[dict]:
    resp = await self.client.get(
        self._url("/shares"),
        headers=self._headers(api_key),
        params={"type": share_type},
    )
    self._raise_for_error(resp)
    return resp.json()

async def update_share(self, api_key: str, share_id: str, permission: str) -> dict:
    resp = await self.client.put(
        self._url(f"/shares/{share_id}"),
        headers=self._headers(api_key),
        json={"permission": permission},
    )
    self._raise_for_error(resp)
    return resp.json()

async def delete_share(self, api_key: str, share_id: str) -> None:
    resp = await self.client.delete(
        self._url(f"/shares/{share_id}"), headers=self._headers(api_key)
    )
    self._raise_for_error(resp)

async def search_users(self, api_key: str) -> list[dict]:
    resp = await self.client.get(
        self._url("/users/search"), headers=self._headers(api_key)
    )
    self._raise_for_error(resp)
    return resp.json()
```

**Step 4: Run tests, verify they pass**

**Step 5: Commit**

```bash
git add backend/app/services/sekura_service.py backend/tests/test_sekura.py
git commit -m "feat(sekura): implement versioning, trash, and sharing proxy operations"
```

---

### Task 13: Thumbnail proxy with local caching

**Files:**
- Modify: `backend/app/services/sekura_service.py` — add `fetch_file_for_thumbnail`
- Create helper in the service or a small utility

**Step 1: Write tests**

```python
import os
import tempfile

@pytest.mark.asyncio
async def test_thumbnail_cache_miss_generates_and_caches():
    """On cache miss, fetches from Sekura, generates thumbnail, caches it."""
    # Create a small valid JPEG in memory
    from PIL import Image
    import io
    img = Image.new("RGB", (100, 100), color="red")
    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    jpeg_bytes = buf.getvalue()

    mock_resp = AsyncMock()
    mock_resp.is_success = True
    mock_resp.status_code = 200
    mock_resp.content = jpeg_bytes
    mock_resp.headers = {"etag": '"abc123"', "content-type": "image/jpeg", "content-length": str(len(jpeg_bytes))}

    mock_client = AsyncMock(spec=httpx.AsyncClient)
    mock_client.get = AsyncMock(return_value=mock_resp)

    with tempfile.TemporaryDirectory() as cache_dir:
        service = SekuraService(base_url="https://sekura.test", client=mock_client)
        thumb_bytes = await service.get_thumbnail(
            "test-key", "file-123", cache_dir=cache_dir
        )
        assert thumb_bytes is not None
        assert len(thumb_bytes) > 0
        # Should be cached now
        cached_files = os.listdir(cache_dir)
        assert len(cached_files) == 1
        assert "file-123" in cached_files[0]
```

**Step 2: Run test, verify it fails**

**Step 3: Implement**

```python
import asyncio
import os
from io import BytesIO
from PIL import Image, ImageOps

Image.MAX_IMAGE_PIXELS = 20_000_000
THUMBNAIL_MAX_SIZE = (400, 800)
THUMBNAIL_FETCH_LIMIT = 25 * 1024 * 1024  # 25MB
IMAGE_MAGIC_BYTES = {
    b"\xff\xd8\xff": "image/jpeg",
    b"\x89PNG": "image/png",
    b"RIFF": "image/webp",
}

async def get_thumbnail(
    self, api_key: str, file_id: str, cache_dir: str = "data/thumbnail-cache"
) -> bytes | None:
    os.makedirs(cache_dir, exist_ok=True)

    # Check cache — look for any file starting with file_id
    for fname in os.listdir(cache_dir):
        if fname.startswith(file_id):
            cached_path = os.path.join(cache_dir, fname)
            with open(cached_path, "rb") as f:
                return f.read()

    # Cache miss — fetch file metadata for etag
    try:
        meta_resp = await self.client.get(
            self._url(f"/files/{file_id}"), headers=self._headers(api_key)
        )
        if not meta_resp.is_success:
            return None
        meta = meta_resp.json()

        # Only generate thumbnails for images
        mime = meta.get("mime_type", "")
        if not mime.startswith("image/"):
            return None

        size = meta.get("size", 0)
        if size > THUMBNAIL_FETCH_LIMIT:
            return None

        # Fetch full file
        resp = await self.client.get(
            self._url(f"/files/{file_id}/download"),
            headers=self._headers(api_key),
        )
        if not resp.is_success:
            return None

        content = resp.content

        # Validate magic bytes
        if not any(content.startswith(magic) for magic in IMAGE_MAGIC_BYTES):
            return None

        # Generate thumbnail in thread (CPU-bound)
        etag = meta.get("updated_at", "none").replace(":", "-")
        thumb_bytes = await asyncio.to_thread(
            self._generate_thumbnail, content
        )
        if thumb_bytes is None:
            return None

        # Cache it
        cache_path = os.path.join(cache_dir, f"{file_id}_{etag}.jpg")
        with open(cache_path, "wb") as f:
            f.write(thumb_bytes)

        return thumb_bytes
    except Exception:
        logger.warning(f"Thumbnail generation failed for file {file_id}", exc_info=True)
        return None

@staticmethod
def _generate_thumbnail(content: bytes) -> bytes | None:
    try:
        img = Image.open(BytesIO(content))
        img = ImageOps.exif_transpose(img)
        img.thumbnail(THUMBNAIL_MAX_SIZE, Image.Resampling.LANCZOS)
        if img.mode != "RGB":
            img = img.convert("RGB")
        buf = BytesIO()
        img.save(buf, format="JPEG", quality=80)
        return buf.getvalue()
    except Exception:
        return None
```

**Step 4: Run tests, verify they pass**

**Step 5: Commit**

```bash
git add backend/app/services/sekura_service.py backend/tests/test_sekura.py
git commit -m "feat(sekura): add thumbnail proxy with local cache"
```

---

### Task 14: Document proxy router

**Files:**
- Create: `backend/app/routers/documents.py` (new file, same path as old one)
- Modify: `backend/app/main.py` — register new router

This is the main proxy router. It needs a helper dependency to get the user's decrypted Sekura API key.

**Step 1: Write integration tests**

```python
@pytest.mark.asyncio
async def test_list_root_folder_contents_no_sekura_key(client):
    resp = await client.get("/api/households/test-household/documents/folders")
    assert resp.status_code == 400  # No Sekura key configured

@pytest.mark.asyncio
async def test_list_root_folder_contents_success(client, db_session):
    # Save a Sekura key first
    await client.post("/api/auth/me/sekura", json={"api_key": "sk_sekura_test"})
    # Mock the SekuraService call... (depends on app.state.sekura being mocked)
```

**Step 2: Run tests, verify they fail**

**Step 3: Implement the router**

```python
# backend/app/routers/documents.py
import logging
from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile, File, Form
from starlette.background import BackgroundTask
from starlette.responses import Response, StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from app.auth import get_current_user_id
from app.database import get_db
from app.services.sekura_connection_service import get_decrypted_api_key
from app.schemas.sekura import (
    SekuraCreateFolder, SekuraRenameRequest, SekuraMoveRequest,
    SekuraCreateShare, SekuraUpdateShare,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/households/{household_id}/documents", tags=["documents"])

async def _get_sekura_key(
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> str:
    key = await get_decrypted_api_key(db, user_id)
    if key is None:
        raise HTTPException(status_code=400, detail="Sekura not configured")
    return key

def _get_sekura(request: Request):
    sekura = getattr(request.app.state, "sekura", None)
    if sekura is None:
        raise HTTPException(status_code=503, detail="Sekura not enabled on this server")
    return sekura

# --- Folders ---

@router.get("/folders")
async def list_root_folders(
    request: Request,
    api_key: str = Depends(_get_sekura_key),
):
    sekura = _get_sekura(request)
    return await sekura.get_folder_contents(api_key)

@router.post("/folders")
async def create_folder(
    request: Request,
    body: SekuraCreateFolder,
    api_key: str = Depends(_get_sekura_key),
):
    sekura = _get_sekura(request)
    return await sekura.create_folder(api_key, body.name, body.parent_id)

@router.get("/folders/tree")
async def get_folder_tree(
    request: Request,
    api_key: str = Depends(_get_sekura_key),
):
    sekura = _get_sekura(request)
    return await sekura.get_folder_tree(api_key)

@router.get("/folders/{folder_id}")
async def get_folder(
    request: Request,
    folder_id: str,
    api_key: str = Depends(_get_sekura_key),
):
    sekura = _get_sekura(request)
    return await sekura.get_folder(api_key, folder_id)

@router.get("/folders/{folder_id}/contents")
async def get_folder_contents(
    request: Request,
    folder_id: str,
    api_key: str = Depends(_get_sekura_key),
):
    sekura = _get_sekura(request)
    return await sekura.get_folder_contents(api_key, folder_id)

@router.put("/folders/{folder_id}")
async def update_folder(
    request: Request,
    folder_id: str,
    body: dict,
    api_key: str = Depends(_get_sekura_key),
):
    sekura = _get_sekura(request)
    if "name" in body:
        return await sekura.rename_folder(api_key, folder_id, body["name"])
    if "parent_id" in body:
        return await sekura.move_folder(api_key, folder_id, body.get("parent_id"))
    raise HTTPException(status_code=400, detail="Must provide name or parent_id")

@router.delete("/folders/{folder_id}")
async def delete_folder(
    request: Request,
    folder_id: str,
    api_key: str = Depends(_get_sekura_key),
):
    sekura = _get_sekura(request)
    await sekura.delete_folder(api_key, folder_id)
    return {"ok": True}

# --- Files ---

@router.post("/files")
async def upload_file(
    request: Request,
    file: UploadFile = File(...),
    folder_id: str | None = Form(None),
    api_key: str = Depends(_get_sekura_key),
):
    sekura = _get_sekura(request)
    return await sekura.upload_file(api_key, file, folder_id)

@router.get("/files/{file_id}")
async def get_file(
    request: Request,
    file_id: str,
    api_key: str = Depends(_get_sekura_key),
):
    sekura = _get_sekura(request)
    return await sekura.get_file(api_key, file_id)

@router.get("/files/{file_id}/download")
async def download_file(
    request: Request,
    file_id: str,
    api_key: str = Depends(_get_sekura_key),
):
    sekura = _get_sekura(request)
    resp = await sekura.download_file_stream(api_key, file_id)
    return StreamingResponse(
        resp.aiter_bytes(chunk_size=65536),
        media_type=resp.headers.get("content-type", "application/octet-stream"),
        headers={
            "Content-Disposition": resp.headers.get("content-disposition", "attachment"),
            "X-Content-Type-Options": "nosniff",
        },
        background=BackgroundTask(resp.aclose),
    )

@router.get("/files/{file_id}/thumbnail")
async def get_thumbnail(
    request: Request,
    file_id: str,
    api_key: str = Depends(_get_sekura_key),
):
    sekura = _get_sekura(request)
    thumb = await sekura.get_thumbnail(api_key, file_id)
    if thumb is None:
        raise HTTPException(status_code=404, detail="No thumbnail available")
    return Response(
        content=thumb,
        media_type="image/jpeg",
        headers={"X-Content-Type-Options": "nosniff"},
    )

@router.put("/files/{file_id}")
async def update_file(
    request: Request,
    file_id: str,
    body: dict,
    api_key: str = Depends(_get_sekura_key),
):
    sekura = _get_sekura(request)
    if "name" in body:
        return await sekura.rename_file(api_key, file_id, body["name"])
    if "parent_id" in body:
        return await sekura.move_file(api_key, file_id, body.get("parent_id"))
    raise HTTPException(status_code=400, detail="Must provide name or parent_id")

@router.delete("/files/{file_id}")
async def delete_file(
    request: Request,
    file_id: str,
    api_key: str = Depends(_get_sekura_key),
):
    sekura = _get_sekura(request)
    await sekura.delete_file(api_key, file_id)
    return {"ok": True}

# --- Versioning ---

@router.post("/files/{file_id}/versions")
async def upload_version(
    request: Request,
    file_id: str,
    file: UploadFile = File(...),
    api_key: str = Depends(_get_sekura_key),
):
    sekura = _get_sekura(request)
    return await sekura.upload_new_version(api_key, file_id, file)

@router.get("/files/{file_id}/versions")
async def list_versions(
    request: Request,
    file_id: str,
    api_key: str = Depends(_get_sekura_key),
):
    sekura = _get_sekura(request)
    return await sekura.list_versions(api_key, file_id)

@router.get("/files/{file_id}/versions/{version_id}/download")
async def download_version(
    request: Request,
    file_id: str,
    version_id: str,
    api_key: str = Depends(_get_sekura_key),
):
    sekura = _get_sekura(request)
    resp = await sekura.download_version_stream(api_key, file_id, version_id)
    return StreamingResponse(
        resp.aiter_bytes(chunk_size=65536),
        media_type=resp.headers.get("content-type", "application/octet-stream"),
        headers={
            "Content-Disposition": resp.headers.get("content-disposition", "attachment"),
            "X-Content-Type-Options": "nosniff",
        },
        background=BackgroundTask(resp.aclose),
    )

# --- Trash ---

@router.get("/trash")
async def list_trash(
    request: Request,
    api_key: str = Depends(_get_sekura_key),
):
    sekura = _get_sekura(request)
    return await sekura.list_trash(api_key)

@router.post("/trash/{item_type}/{item_id}/restore")
async def restore_item(
    request: Request,
    item_type: str,
    item_id: str,
    api_key: str = Depends(_get_sekura_key),
):
    sekura = _get_sekura(request)
    await sekura.restore_item(api_key, item_type, item_id)
    return {"ok": True}

@router.delete("/trash/{item_type}/{item_id}")
async def delete_permanently(
    request: Request,
    item_type: str,
    item_id: str,
    api_key: str = Depends(_get_sekura_key),
):
    sekura = _get_sekura(request)
    await sekura.delete_permanently(api_key, item_type, item_id)
    return {"ok": True}

@router.delete("/trash")
async def empty_trash(
    request: Request,
    api_key: str = Depends(_get_sekura_key),
):
    sekura = _get_sekura(request)
    await sekura.empty_trash(api_key)
    return {"ok": True}

# --- Sharing ---

@router.post("/shares")
async def create_share(
    request: Request,
    body: SekuraCreateShare,
    api_key: str = Depends(_get_sekura_key),
):
    sekura = _get_sekura(request)
    return await sekura.create_share(
        api_key, body.resource_type, body.resource_id, body.shared_with, body.permission
    )

@router.get("/shares")
async def list_shares(
    request: Request,
    type: str = "owned",
    api_key: str = Depends(_get_sekura_key),
):
    sekura = _get_sekura(request)
    return await sekura.list_shares(api_key, type)

@router.put("/shares/{share_id}")
async def update_share(
    request: Request,
    share_id: str,
    body: SekuraUpdateShare,
    api_key: str = Depends(_get_sekura_key),
):
    sekura = _get_sekura(request)
    return await sekura.update_share(api_key, share_id, body.permission)

@router.delete("/shares/{share_id}")
async def delete_share(
    request: Request,
    share_id: str,
    api_key: str = Depends(_get_sekura_key),
):
    sekura = _get_sekura(request)
    await sekura.delete_share(api_key, share_id)
    return {"ok": True}

@router.get("/users/search")
async def search_users(
    request: Request,
    api_key: str = Depends(_get_sekura_key),
):
    sekura = _get_sekura(request)
    return await sekura.search_users(api_key)
```

Register in `main.py`:

```python
from app.routers import documents
app.include_router(documents.router, prefix="/api")
```

**Step 4: Run all backend tests**

Run: `cd backend && python -m pytest tests/ -v`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/app/routers/documents.py backend/app/main.py backend/tests/test_sekura.py
git commit -m "feat(sekura): add document proxy router with all endpoints"
```

---

## Phase 3: Frontend — Connection Setup

### Task 15: Sekura API hooks

**Files:**
- Create: `frontend/src/api/sekura.ts`
- Delete: `frontend/src/api/documents.ts`

**Step 1: Implement**

Follow the pattern from existing API files (e.g., `frontend/src/api/documents.ts`, `frontend/src/api/birthdays.ts`). Use `apiFetch` from `@/api/client`.

```typescript
// frontend/src/api/sekura.ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch, hasToken, getAccessToken } from './client'

// --- Connection ---

interface SekuraConnectionResponse {
  configured: boolean
  key_scope: string | null
}

interface SekuraTestResponse {
  ok: boolean
  error?: string
}

export function useSekuraConnection() {
  return useQuery({
    queryKey: ['sekura', 'connection'],
    queryFn: () => apiFetch<SekuraConnectionResponse>('/api/auth/me/sekura'),
    enabled: hasToken(),
  })
}

export function useSaveSekuraKey() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (apiKey: string) =>
      apiFetch<SekuraConnectionResponse>('/api/auth/me/sekura', {
        method: 'POST',
        body: JSON.stringify({ api_key: apiKey }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sekura'] }),
  })
}

export function useDeleteSekuraKey() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () =>
      apiFetch('/api/auth/me/sekura', { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sekura'] }),
  })
}

export function useTestSekuraConnection() {
  return useMutation({
    mutationFn: () =>
      apiFetch<SekuraTestResponse>('/api/auth/me/sekura/test', {
        method: 'POST',
      }),
  })
}

// --- Folders ---

export interface SekuraFolder {
  id: string
  name: string
  parent_id: string | null
  created_at: string
  item_count?: number
}

export interface SekuraFile {
  id: string
  name: string
  mime_type: string | null
  size: number
  folder_id: string | null
  created_at: string
  updated_at?: string
}

export interface SekuraFolderAncestor {
  id: string
  name: string
}

export interface SekuraFolderContents {
  folder?: SekuraFolder
  ancestors: SekuraFolderAncestor[]
  folders: SekuraFolder[]
  files: SekuraFile[]
}

export function useFolderContents(householdId: string, folderId?: string) {
  const path = folderId
    ? `/api/households/${householdId}/documents/folders/${folderId}/contents`
    : `/api/households/${householdId}/documents/folders`
  return useQuery({
    queryKey: ['sekura', 'folder', folderId ?? 'root'],
    queryFn: () => apiFetch<SekuraFolderContents>(path),
    enabled: hasToken(),
  })
}

export function useFolderTree(householdId: string) {
  return useQuery({
    queryKey: ['sekura', 'folder-tree'],
    queryFn: () =>
      apiFetch<SekuraFolder[]>(
        `/api/households/${householdId}/documents/folders/tree`
      ),
    enabled: hasToken(),
  })
}

export function useCreateFolder(householdId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: { name: string; parent_id?: string }) =>
      apiFetch(`/api/households/${householdId}/documents/folders`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({
        queryKey: ['sekura', 'folder', variables.parent_id ?? 'root'],
      })
    },
  })
}

export function useRenameFolder(householdId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ folderId, name }: { folderId: string; name: string }) =>
      apiFetch(`/api/households/${householdId}/documents/folders/${folderId}`, {
        method: 'PUT',
        body: JSON.stringify({ name }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sekura', 'folder'] })
    },
  })
}

export function useDeleteFolder(householdId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (folderId: string) =>
      apiFetch(`/api/households/${householdId}/documents/folders/${folderId}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sekura', 'folder'] })
    },
  })
}

// --- Files ---

export function useFile(householdId: string, fileId: string) {
  return useQuery({
    queryKey: ['sekura', 'file', fileId],
    queryFn: () =>
      apiFetch<SekuraFile>(
        `/api/households/${householdId}/documents/files/${fileId}`
      ),
    enabled: hasToken() && !!fileId,
  })
}

export function useUploadFile(householdId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      file,
      folderId,
    }: {
      file: File
      folderId?: string
    }) => {
      const formData = new FormData()
      formData.append('file', file)
      if (folderId) formData.append('folder_id', folderId)
      const token = await getAccessToken()
      const resp = await fetch(
        `/api/households/${householdId}/documents/files`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: formData,
        }
      )
      if (!resp.ok) throw new Error('Upload failed')
      return resp.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sekura', 'folder'] })
    },
  })
}

export function useRenameFile(householdId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ fileId, name }: { fileId: string; name: string }) =>
      apiFetch(`/api/households/${householdId}/documents/files/${fileId}`, {
        method: 'PUT',
        body: JSON.stringify({ name }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sekura'] })
    },
  })
}

export function useDeleteFile(householdId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (fileId: string) =>
      apiFetch(`/api/households/${householdId}/documents/files/${fileId}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sekura', 'folder'] })
    },
  })
}

// URL builders for authenticated image/download fetches
export function getFileDownloadUrl(householdId: string, fileId: string) {
  return `/api/households/${householdId}/documents/files/${fileId}/download`
}

export function getFileThumbnailUrl(householdId: string, fileId: string) {
  return `/api/households/${householdId}/documents/files/${fileId}/thumbnail`
}
```

Delete `frontend/src/api/documents.ts`.

**Step 2: Verify frontend builds**

Run: `cd frontend && npx tsc --noEmit`

Fix any import errors in route files that still reference `documents.ts`. Those files will be rewritten in later tasks — for now, stub them or comment out broken imports.

**Step 3: Commit**

```bash
git add frontend/src/api/sekura.ts
git rm frontend/src/api/documents.ts
git commit -m "feat(sekura): add frontend API hooks, remove old document hooks"
```

---

### Task 16: Settings page — Sekura connection section

**Files:**
- Modify: `frontend/src/routes/settings.tsx`

**Step 1: Implement**

Add a new `SekuraSection` component to the settings page, positioned after CalendarSyncSection. Follow the exact same Card/section pattern used by existing sections.

```tsx
import { useSekuraConnection, useSaveSekuraKey, useDeleteSekuraKey, useTestSekuraConnection } from '@/api/sekura'

function SekuraSection() {
  const { data: connection } = useSekuraConnection()
  const saveKey = useSaveSekuraKey()
  const deleteKey = useDeleteSekuraKey()
  const testConnection = useTestSekuraConnection()
  const [apiKey, setApiKey] = useState('')
  const [testResult, setTestResult] = useState<{ ok: boolean; error?: string } | null>(null)

  const handleSave = () => {
    if (!apiKey.trim()) return
    saveKey.mutate(apiKey, {
      onSuccess: () => {
        setApiKey('')
        setTestResult(null)
      },
    })
  }

  const handleTest = () => {
    testConnection.mutate(undefined, {
      onSuccess: (data) => setTestResult(data),
    })
  }

  const handleRemove = () => {
    deleteKey.mutate(undefined, {
      onSuccess: () => setTestResult(null),
    })
  }

  return (
    <Card>
      <h2 className="text-lg font-semibold text-text mb-4">Document Storage</h2>
      {connection?.configured ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-green-500" />
            <span className="text-sm text-text-muted">
              Connected ({connection.key_scope} access)
            </span>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={handleTest}
              disabled={testConnection.isPending}>
              {testConnection.isPending ? 'Testing...' : 'Test Connection'}
            </Button>
            <Button size="sm" variant="danger" onClick={handleRemove}
              disabled={deleteKey.isPending}>
              Remove
            </Button>
          </div>
          {testResult && (
            <p className={`text-sm ${testResult.ok ? 'text-green-500' : 'text-red-500'}`}>
              {testResult.ok ? 'Connection successful' : testResult.error}
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-text-muted">
            Connect your Sekura vault to store and browse documents.
          </p>
          <Input
            type="password"
            placeholder="sk_sekura_..."
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
          <Button onClick={handleSave} disabled={!apiKey.trim() || saveKey.isPending}>
            {saveKey.isPending ? 'Saving...' : 'Connect'}
          </Button>
          {saveKey.isError && (
            <p className="text-sm text-red-500">
              {(saveKey.error as Error).message}
            </p>
          )}
        </div>
      )}
    </Card>
  )
}
```

Add `<SekuraSection />` in the settings page JSX, after the Calendar Sync section.

**Step 2: Verify it renders**

Run: `cd frontend && npm run dev`
Navigate to Settings, verify the Sekura section appears.

**Step 3: Commit**

```bash
git add frontend/src/routes/settings.tsx
git commit -m "feat(sekura): add Sekura connection section to Settings page"
```

---

## Phase 4: Frontend — Document Browsing

### Task 17: Shared folder-contents component

**Files:**
- Create: `frontend/src/components/documents/folder-contents.tsx`
- Create: `frontend/src/components/documents/breadcrumbs.tsx`
- Create: `frontend/src/components/documents/folder-card.tsx`
- Create: `frontend/src/components/documents/file-card.tsx`

Build the reusable `<FolderContents>` component that both the root and subfolder routes will render. Includes breadcrumbs, folder grid, file grid, FAB for upload/create.

Follow the card/grid patterns from existing pages (e.g., `documents.index.tsx` grid, `birthday-card.tsx` card pattern). Use `useAuthenticatedImage` from `@/utils/use-authenticated-image.ts` for thumbnail loading.

**Key details:**
- Breadcrumbs: horizontal scroll, "Documents" as root link, ancestors from API, current folder name bolded
- Folders first, then files in a 2-column grid
- FolderCard: folder icon + name + item count
- FileCard: thumbnail (if image) or file type icon + name + size
- FAB with upload + create folder (shown only if key_scope is readwrite)
- Client-side search with 300ms debounce on current folder contents
- Back button in breadcrumbs navigates to parent folder

**Step 1: Create all four component files**

**Step 2: Verify they compile**

Run: `cd frontend && npx tsc --noEmit`

**Step 3: Commit**

```bash
git add frontend/src/components/documents/
git commit -m "feat(sekura): add folder-contents, breadcrumbs, folder-card, file-card components"
```

---

### Task 18: Document route pages

**Files:**
- Rewrite: `frontend/src/routes/documents.index.tsx`
- Create: `frontend/src/routes/documents.folder.$folderId.tsx`
- Keep: `frontend/src/routes/documents.tsx` (layout with Outlet, no changes)

**Step 1: Implement documents.index.tsx**

Renders `<FolderContents>` with no folderId (root):

```tsx
import { createFileRoute } from '@tanstack/react-router'
import FolderContents from '@/components/documents/folder-contents'
import { useAuthStore } from '@/stores/auth-store'

export const Route = createFileRoute('/documents/')({
  component: DocumentsIndex,
})

function DocumentsIndex() {
  const householdId = useAuthStore((s) => s.householdId)
  if (!householdId) return null
  return <FolderContents householdId={householdId} />
}
```

**Step 2: Implement documents.folder.$folderId.tsx**

```tsx
import { createFileRoute } from '@tanstack/react-router'
import FolderContents from '@/components/documents/folder-contents'
import { useAuthStore } from '@/stores/auth-store'

export const Route = createFileRoute('/documents/folder/$folderId')({
  component: FolderPage,
})

function FolderPage() {
  const { folderId } = Route.useParams()
  const householdId = useAuthStore((s) => s.householdId)
  if (!householdId) return null
  return <FolderContents householdId={householdId} folderId={folderId} />
}
```

**Step 3: Delete old documents.$docId.tsx**

```bash
rm frontend/src/routes/documents.\$docId.tsx
```

**Step 4: Verify frontend builds and renders**

Run: `cd frontend && npm run dev`

**Step 5: Commit**

```bash
git add frontend/src/routes/documents.index.tsx frontend/src/routes/documents.folder.\$folderId.tsx
git rm frontend/src/routes/documents.\$docId.tsx
git commit -m "feat(sekura): add folder browsing route pages"
```

---

### Task 19: Upload and create-folder sheets

**Files:**
- Create: `frontend/src/components/documents/upload-file-sheet.tsx`
- Create: `frontend/src/components/documents/create-folder-sheet.tsx`
- Delete: `frontend/src/components/documents/upload-document-sheet.tsx`

Follow the bottom-sheet pattern from existing sheets (e.g., `create-birthday-sheet.tsx`). Use Framer Motion `AnimatePresence` + spring animation, `useScrollLock`.

**upload-file-sheet.tsx**: File picker (no MIME restriction — Sekura handles its own validation), selected file display, upload button. Accepts `folderId` prop.

**create-folder-sheet.tsx**: Name input, create button. Accepts `parentId` prop.

**Step 1: Implement both sheets**

**Step 2: Wire into FolderContents FAB**

**Step 3: Delete old upload-document-sheet.tsx**

**Step 4: Verify**

**Step 5: Commit**

```bash
git add frontend/src/components/documents/upload-file-sheet.tsx frontend/src/components/documents/create-folder-sheet.tsx
git rm frontend/src/components/documents/upload-document-sheet.tsx
git commit -m "feat(sekura): add upload-file and create-folder bottom sheets"
```

---

### Task 20: File detail page

**Files:**
- Create: `frontend/src/routes/documents.file.$fileId.tsx`

Displays file metadata, preview (for images via `useAuthenticatedImage`), download button, rename, delete. Back button navigates to parent folder.

Follow the detail page pattern from `documents.$docId.tsx` (which was deleted) and `cards.$cardId.tsx`.

**Key details:**
- Use `useFile(householdId, fileId)` to fetch metadata
- Image preview for image MIME types, file icon otherwise
- Download: fetch blob with auth token, trigger download
- Rename: inline sheet/modal
- Delete: confirmation dialog, then soft-delete, navigate to parent folder
- Back button: `navigate({ to: '/documents/folder/$folderId', params: { folderId: file.folder_id } })` or `/documents` if root

**Step 1: Implement**

**Step 2: Verify**

**Step 3: Commit**

```bash
git add frontend/src/routes/documents.file.\$fileId.tsx
git commit -m "feat(sekura): add file detail page with preview, download, rename, delete"
```

---

### Task 21: Rename sheet

**Files:**
- Create: `frontend/src/components/documents/rename-sheet.tsx`

Generic bottom sheet for renaming files or folders. Props: `isOpen`, `onClose`, `currentName`, `onRename(newName)`, `isPending`.

**Step 1: Implement following existing sheet patterns**

**Step 2: Wire into file detail page and folder-contents long-press/context menu**

**Step 3: Commit**

```bash
git add frontend/src/components/documents/rename-sheet.tsx
git commit -m "feat(sekura): add rename bottom sheet for files and folders"
```

---

## Phase 5: Navigation & Cleanup

### Task 22: Conditional Documents nav in more.tsx

**Files:**
- Modify: `frontend/src/routes/more.tsx`

**Step 1: Implement**

Import `useSekuraConnection` and conditionally filter the Documents item from the nav list:

```tsx
const { data: sekuraConnection } = useSekuraConnection()

// In the items array, filter:
const items = allItems.filter((item) => {
  if (item.path === '/documents' && !sekuraConnection?.configured) return false
  return true
})
```

**Step 2: Verify** — With no Sekura key, Documents should not appear. After configuring a key in Settings, it should appear.

**Step 3: Commit**

```bash
git add frontend/src/routes/more.tsx
git commit -m "feat(sekura): conditionally show Documents nav based on Sekura connection"
```

---

### Task 23: nginx configuration update

**Files:**
- Modify: `nginx/nginx.conf`

**Step 1: Update the document upload location block**

Replace the existing document upload block (which matched the old document upload path) with a new one for Sekura proxy routes:

```nginx
# Sekura document proxy - large uploads and long reads
location ~ ^/api/households/.*/documents/files {
    client_max_body_size 100m;
    proxy_read_timeout 300s;
    proxy_send_timeout 300s;
    limit_req zone=api burst=20 nodelay;
    proxy_pass http://backend:8000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

**Step 2: Commit**

```bash
git add nginx/nginx.conf
git commit -m "feat(sekura): update nginx config for Sekura proxy routes"
```

---

### Task 24: Remove old document frontend code & cleanup

**Files:**
- Delete any remaining old document components
- Verify no imports reference deleted files
- Remove old document test files if any exist

**Step 1: Search for broken imports**

```bash
cd frontend && grep -r "from.*documents" src/ --include="*.ts" --include="*.tsx"
```

Fix any remaining references to old document API/components.

**Step 2: Run full frontend build**

```bash
cd frontend && npm run build
```

**Step 3: Run full backend tests**

```bash
cd backend && python -m pytest tests/ -v
```

**Step 4: Commit**

```bash
git add -A
git commit -m "chore: clean up remaining old document references"
```

---

### Task 25: Update CLAUDE.md

**Files:**
- Modify: `.claude/CLAUDE.md`

Update the project documentation to reflect:
- Documents now backed by Sekura (not local storage)
- New env var `SEKURA_URL`
- New table `sekura_connections`
- Removed tables: `documents`, `document_tags`, `document_tag_links`
- Updated API endpoints section
- Updated frontend routes and components
- Updated project structure

**Step 1: Update**

**Step 2: Commit**

```bash
git add .claude/CLAUDE.md
git commit -m "docs: update CLAUDE.md for Sekura integration"
```

---

## v2 Tasks (future)

These are documented but not part of the initial implementation:

- **Task v2.1:** Trash view route (`documents.trash.tsx`) + trash API hooks
- **Task v2.2:** Move sheet with one-level-at-a-time folder picker
- **Task v2.3:** Versioning UI on file detail page (version list, upload new version, download old version)
- **Task v2.4:** Sharing UI on file detail page (share sheet, user search, permission management)
