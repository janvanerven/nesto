import os
import uuid

# Env vars must be set before importing app modules
os.environ.setdefault("SECRET_KEY", "a" * 64)
os.environ.setdefault("OIDC_ISSUER_URL", "https://auth.example.com")
os.environ.setdefault("OIDC_CLIENT_ID", "test-client")

import pytest
import pytest_asyncio
import httpx
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from unittest.mock import AsyncMock, patch

from app.database import Base
from app.models.household import Household, HouseholdMember
from app.models.user import User

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

USER_ID = "test-user-id"
HOUSEHOLD_ID = "test-household"


@pytest_asyncio.fixture
async def db_session():
    """In-memory SQLite database with all tables and a seeded test user."""
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    session_factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with session_factory() as session:
        session.add(User(id=USER_ID, email="test@example.com", display_name="Test User"))
        session.add(Household(id=HOUSEHOLD_ID, name="Test Home", created_by=USER_ID))
        session.add(HouseholdMember(household_id=HOUSEHOLD_ID, user_id=USER_ID))
        await session.commit()
        yield session

    await engine.dispose()


@pytest_asyncio.fixture
async def client(db_session: AsyncSession):
    """HTTPX AsyncClient wired to the FastAPI app with auth + DB overrides."""
    from app.auth import get_current_user_id
    from app.database import get_db
    from app.main import app

    async def override_get_db():
        yield db_session

    async def override_get_current_user_id():
        return USER_ID

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_current_user_id] = override_get_current_user_id

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as ac:
        yield ac

    app.dependency_overrides.clear()


# ---------------------------------------------------------------------------
# Task 1: SEKURA_URL config field
# ---------------------------------------------------------------------------

def test_sekura_url_default_empty():
    """SEKURA_URL defaults to empty string when not set."""
    from app.config import Settings
    s = Settings(
        secret_key="a" * 32,
        oidc_issuer_url="https://auth.example.com",
        oidc_client_id="test",
    )
    assert s.sekura_url == ""


# ---------------------------------------------------------------------------
# Task 2: SekuraConnection model
# ---------------------------------------------------------------------------

from sqlalchemy import select
from app.models.sekura import SekuraConnection


@pytest.mark.asyncio
async def test_sekura_connection_model(db_session):
    conn = SekuraConnection(
        id=str(uuid.uuid4()),
        user_id=USER_ID,
        encrypted_api_key="encrypted-value",
        key_scope="readwrite",
    )
    db_session.add(conn)
    await db_session.commit()

    result = await db_session.execute(
        select(SekuraConnection).where(SekuraConnection.user_id == USER_ID)
    )
    saved = result.scalar_one()
    assert saved.key_scope == "readwrite"
    assert saved.encrypted_api_key == "encrypted-value"
    assert saved.created_at is not None


# ---------------------------------------------------------------------------
# Task 3: Sekura schemas
# ---------------------------------------------------------------------------

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


# ---------------------------------------------------------------------------
# Task 6: SekuraService init
# ---------------------------------------------------------------------------

from app.services.sekura_service import SekuraService


@pytest.mark.asyncio
async def test_sekura_service_init():
    async with httpx.AsyncClient() as c:
        service = SekuraService(base_url="https://sekura.example.com", client=c)
        assert service.base_url == "https://sekura.example.com"


# ---------------------------------------------------------------------------
# Task 7: Connection service CRUD
# ---------------------------------------------------------------------------

from app.services.sekura_connection_service import (
    get_sekura_connection,
    save_sekura_connection,
    delete_sekura_connection,
    get_decrypted_api_key,
)


@pytest.mark.asyncio
async def test_save_and_get_sekura_connection(db_session):
    await save_sekura_connection(db_session, USER_ID, "sk_sekura_test123", "readwrite")
    conn = await get_sekura_connection(db_session, USER_ID)
    assert conn is not None
    assert conn.key_scope == "readwrite"
    # encrypted_api_key must NOT be the plaintext
    assert conn.encrypted_api_key != "sk_sekura_test123"


@pytest.mark.asyncio
async def test_get_decrypted_api_key(db_session):
    await save_sekura_connection(db_session, USER_ID, "sk_sekura_test123", "readwrite")
    key = await get_decrypted_api_key(db_session, USER_ID)
    assert key == "sk_sekura_test123"


@pytest.mark.asyncio
async def test_delete_sekura_connection(db_session):
    await save_sekura_connection(db_session, USER_ID, "sk_sekura_test123", "readwrite")
    await delete_sekura_connection(db_session, USER_ID)
    conn = await get_sekura_connection(db_session, USER_ID)
    assert conn is None


@pytest.mark.asyncio
async def test_save_sekura_connection_overwrites(db_session):
    await save_sekura_connection(db_session, USER_ID, "sk_sekura_old", "read")
    await save_sekura_connection(db_session, USER_ID, "sk_sekura_new", "readwrite")
    key = await get_decrypted_api_key(db_session, USER_ID)
    assert key == "sk_sekura_new"
    conn = await get_sekura_connection(db_session, USER_ID)
    assert conn.key_scope == "readwrite"


# ---------------------------------------------------------------------------
# Task 8: Connection API routes
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_get_sekura_connection_not_configured(client):
    resp = await client.get("/api/auth/me/sekura")
    assert resp.status_code == 200
    assert resp.json() == {"configured": False, "key_scope": None}


@pytest.mark.asyncio
async def test_save_sekura_connection_api(client):
    from app.main import app as nesto_app
    # No sekura service configured — save should succeed with readwrite default
    nesto_app.state.sekura = None  # type: ignore
    resp = await client.post("/api/auth/me/sekura", json={"api_key": "sk_sekura_test"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["configured"] is True


@pytest.mark.asyncio
async def test_delete_sekura_connection_api(client):
    from app.main import app as nesto_app
    nesto_app.state.sekura = None  # type: ignore
    await client.post("/api/auth/me/sekura", json={"api_key": "sk_sekura_test"})
    resp = await client.delete("/api/auth/me/sekura")
    assert resp.status_code == 200
    check = await client.get("/api/auth/me/sekura")
    assert check.json()["configured"] is False


# ---------------------------------------------------------------------------
# Task 9: Test connection endpoint
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_sekura_test_connection_no_key(client):
    """Returns ok=False with helpful message when no key is configured."""
    from app.main import app as nesto_app
    nesto_app.state.sekura = None  # type: ignore
    resp = await client.post("/api/auth/me/sekura/test")
    assert resp.status_code == 200
    data = resp.json()
    assert data["ok"] is False
    assert "not configured" in data["error"].lower()


@pytest.mark.asyncio
async def test_sekura_test_connection_no_server(client, db_session):
    """Returns ok=False when key is set but Sekura server is not configured."""
    # Save a key directly in DB (bypassing the save endpoint's validation)
    await save_sekura_connection(db_session, USER_ID, "sk_sekura_test", "readwrite")
    from app.main import app as nesto_app
    # Sekura is not configured on the server (sekura_url is empty in tests)
    # Force it to None so getattr returns None regardless of any previous test state
    nesto_app.state.sekura = None
    resp = await client.post("/api/auth/me/sekura/test")
    assert resp.status_code == 200
    data = resp.json()
    assert data["ok"] is False
    assert "not enabled" in data["error"].lower()


@pytest.mark.asyncio
async def test_sekura_test_connection_success(client, db_session):
    """Returns ok=True when the mock Sekura service returns success."""
    await save_sekura_connection(db_session, USER_ID, "sk_sekura_test", "readwrite")
    from app.main import app as nesto_app

    mock_sekura = AsyncMock()
    mock_sekura.test_connection = AsyncMock(return_value=(True, None))
    nesto_app.state.sekura = mock_sekura

    try:
        resp = await client.post("/api/auth/me/sekura/test")
        assert resp.status_code == 200
        assert resp.json()["ok"] is True
    finally:
        del nesto_app.state.sekura


# ---------------------------------------------------------------------------
# Task 10: SekuraService — folder operations
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_sekura_service_list_root_folders():
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


@pytest.mark.asyncio
async def test_sekura_service_get_folder_contents():
    mock_response = AsyncMock()
    mock_response.is_success = True
    mock_response.status_code = 200
    mock_response.json.return_value = {"folder": {"id": "f1", "name": "Docs"}, "folders": [], "files": []}

    mock_client = AsyncMock(spec=httpx.AsyncClient)
    mock_client.get = AsyncMock(return_value=mock_response)

    service = SekuraService(base_url="https://sekura.test", client=mock_client)
    result = await service.get_folder_contents("test-key", "f1")

    call_url = mock_client.get.call_args[0][0]
    assert "/folders/f1/contents" in call_url


@pytest.mark.asyncio
async def test_sekura_service_create_folder():
    mock_response = AsyncMock()
    mock_response.is_success = True
    mock_response.status_code = 201
    mock_response.json.return_value = {"id": "f2", "name": "New Folder"}

    mock_client = AsyncMock(spec=httpx.AsyncClient)
    mock_client.post = AsyncMock(return_value=mock_response)

    service = SekuraService(base_url="https://sekura.test", client=mock_client)
    result = await service.create_folder("test-key", "New Folder", parent_id="f1")

    assert result["name"] == "New Folder"
    call_kwargs = mock_client.post.call_args
    assert call_kwargs.kwargs["json"]["name"] == "New Folder"
    assert call_kwargs.kwargs["json"]["parent_id"] == "f1"


@pytest.mark.asyncio
async def test_sekura_service_error_mapping_401():
    """Sekura 401 maps to Nesto 502."""
    from fastapi import HTTPException
    mock_response = AsyncMock()
    mock_response.is_success = False
    mock_response.status_code = 401
    mock_response.reason_phrase = "Unauthorized"
    mock_response.json.side_effect = Exception("not json")

    mock_client = AsyncMock(spec=httpx.AsyncClient)
    mock_client.get = AsyncMock(return_value=mock_response)

    service = SekuraService(base_url="https://sekura.test", client=mock_client)
    with pytest.raises(HTTPException) as exc_info:
        await service.list_root_folders("bad-key")
    assert exc_info.value.status_code == 502


@pytest.mark.asyncio
async def test_sekura_service_error_mapping_404():
    """Sekura 404 maps to Nesto 404."""
    from fastapi import HTTPException
    mock_response = AsyncMock()
    mock_response.is_success = False
    mock_response.status_code = 404
    mock_response.reason_phrase = "Not Found"
    mock_response.json.return_value = {"detail": "Folder not found"}

    mock_client = AsyncMock(spec=httpx.AsyncClient)
    mock_client.get = AsyncMock(return_value=mock_response)

    service = SekuraService(base_url="https://sekura.test", client=mock_client)
    with pytest.raises(HTTPException) as exc_info:
        await service.get_folder("bad-key", "nonexistent")
    assert exc_info.value.status_code == 404


# ---------------------------------------------------------------------------
# Task 11: SekuraService — file operations
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_sekura_service_get_file():
    mock_response = AsyncMock()
    mock_response.is_success = True
    mock_response.status_code = 200
    mock_response.json.return_value = {"id": "file1", "name": "report.pdf", "size": 1024}

    mock_client = AsyncMock(spec=httpx.AsyncClient)
    mock_client.get = AsyncMock(return_value=mock_response)

    service = SekuraService(base_url="https://sekura.test", client=mock_client)
    result = await service.get_file("test-key", "file1")

    call_url = mock_client.get.call_args[0][0]
    assert "/files/file1" in call_url
    assert result["name"] == "report.pdf"


@pytest.mark.asyncio
async def test_sekura_service_rename_file():
    mock_response = AsyncMock()
    mock_response.is_success = True
    mock_response.status_code = 200
    mock_response.json.return_value = {"id": "file1", "name": "renamed.pdf"}

    mock_client = AsyncMock(spec=httpx.AsyncClient)
    mock_client.put = AsyncMock(return_value=mock_response)

    service = SekuraService(base_url="https://sekura.test", client=mock_client)
    result = await service.rename_file("test-key", "file1", "renamed.pdf")

    call_kwargs = mock_client.put.call_args
    assert call_kwargs.kwargs["json"]["name"] == "renamed.pdf"


@pytest.mark.asyncio
async def test_sekura_service_delete_file():
    mock_response = AsyncMock()
    mock_response.is_success = True
    mock_response.status_code = 204
    mock_response.json.return_value = {}

    mock_client = AsyncMock(spec=httpx.AsyncClient)
    mock_client.delete = AsyncMock(return_value=mock_response)

    service = SekuraService(base_url="https://sekura.test", client=mock_client)
    await service.delete_file("test-key", "file1")

    call_url = mock_client.delete.call_args[0][0]
    assert "/files/file1" in call_url


# ---------------------------------------------------------------------------
# Task 12: SekuraService — versioning, trash, sharing
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_sekura_service_list_versions():
    mock_response = AsyncMock()
    mock_response.is_success = True
    mock_response.status_code = 200
    mock_response.json.return_value = [{"id": "v1", "version_number": 1, "size": 512}]

    mock_client = AsyncMock(spec=httpx.AsyncClient)
    mock_client.get = AsyncMock(return_value=mock_response)

    service = SekuraService(base_url="https://sekura.test", client=mock_client)
    result = await service.list_versions("test-key", "file1")

    call_url = mock_client.get.call_args[0][0]
    assert "/files/file1/versions" in call_url
    assert len(result) == 1


@pytest.mark.asyncio
async def test_sekura_service_list_trash():
    mock_response = AsyncMock()
    mock_response.is_success = True
    mock_response.status_code = 200
    mock_response.json.return_value = [{"id": "t1", "name": "deleted.pdf", "type": "file"}]

    mock_client = AsyncMock(spec=httpx.AsyncClient)
    mock_client.get = AsyncMock(return_value=mock_response)

    service = SekuraService(base_url="https://sekura.test", client=mock_client)
    result = await service.list_trash("test-key")

    call_url = mock_client.get.call_args[0][0]
    assert "/trash" in call_url
    assert len(result) == 1


@pytest.mark.asyncio
async def test_sekura_service_create_share():
    mock_response = AsyncMock()
    mock_response.is_success = True
    mock_response.status_code = 201
    mock_response.json.return_value = {"id": "s1", "permission": "read"}

    mock_client = AsyncMock(spec=httpx.AsyncClient)
    mock_client.post = AsyncMock(return_value=mock_response)

    service = SekuraService(base_url="https://sekura.test", client=mock_client)
    result = await service.create_share("test-key", "file", "file1", "other@user.com", "read")

    call_kwargs = mock_client.post.call_args
    assert call_kwargs.kwargs["json"]["permission"] == "read"
    assert result["id"] == "s1"


# ---------------------------------------------------------------------------
# Task 13: Thumbnail generation
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_thumbnail_cache_miss_generates_and_caches():
    """On cache miss, fetches from Sekura, generates thumbnail, caches it."""
    import tempfile
    from PIL import Image
    import io

    # Create a small valid JPEG
    img = Image.new("RGB", (100, 100), color="red")
    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    jpeg_bytes = buf.getvalue()

    # Mock metadata response
    meta_response = AsyncMock()
    meta_response.is_success = True
    meta_response.status_code = 200
    meta_response.json.return_value = {
        "id": "file-123",
        "name": "photo.jpg",
        "mime_type": "image/jpeg",
        "size": len(jpeg_bytes),
        "updated_at": "2026-01-01T00:00:00Z",
    }

    # Mock download response
    download_response = AsyncMock()
    download_response.is_success = True
    download_response.status_code = 200
    download_response.content = jpeg_bytes

    mock_client = AsyncMock(spec=httpx.AsyncClient)
    # First call: metadata; second call: download
    mock_client.get = AsyncMock(side_effect=[meta_response, download_response])

    with tempfile.TemporaryDirectory() as cache_dir:
        service = SekuraService(base_url="https://sekura.test", client=mock_client)
        thumb_bytes = await service.get_thumbnail("test-key", "file-123", cache_dir=cache_dir)

        assert thumb_bytes is not None
        assert len(thumb_bytes) > 0
        cached_files = os.listdir(cache_dir)
        assert len(cached_files) == 1
        assert "file-123" in cached_files[0]


@pytest.mark.asyncio
async def test_thumbnail_cache_hit_skips_fetch():
    """On cache hit, returns cached bytes without contacting Sekura."""
    import tempfile

    mock_client = AsyncMock(spec=httpx.AsyncClient)
    mock_client.get = AsyncMock()

    with tempfile.TemporaryDirectory() as cache_dir:
        # Pre-populate cache
        cache_file = os.path.join(cache_dir, "file-456_etag.jpg")
        with open(cache_file, "wb") as f:
            f.write(b"fake-thumbnail-data")

        service = SekuraService(base_url="https://sekura.test", client=mock_client)
        thumb_bytes = await service.get_thumbnail("test-key", "file-456", cache_dir=cache_dir)

        assert thumb_bytes == b"fake-thumbnail-data"
        mock_client.get.assert_not_called()


@pytest.mark.asyncio
async def test_thumbnail_returns_none_for_non_image():
    """Returns None for non-image files without downloading."""
    import tempfile

    meta_response = AsyncMock()
    meta_response.is_success = True
    meta_response.status_code = 200
    meta_response.json.return_value = {
        "id": "doc-1",
        "name": "document.pdf",
        "mime_type": "application/pdf",
        "size": 1024,
        "updated_at": "2026-01-01T00:00:00Z",
    }

    mock_client = AsyncMock(spec=httpx.AsyncClient)
    mock_client.get = AsyncMock(return_value=meta_response)

    with tempfile.TemporaryDirectory() as cache_dir:
        service = SekuraService(base_url="https://sekura.test", client=mock_client)
        thumb_bytes = await service.get_thumbnail("test-key", "doc-1", cache_dir=cache_dir)
        assert thumb_bytes is None
        # Only one call (metadata), no download
        assert mock_client.get.call_count == 1


# ---------------------------------------------------------------------------
# Task 14: Document proxy router
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_list_root_folder_contents_no_sekura_key(client):
    """Returns 400 when no Sekura API key is configured for the user."""
    from app.main import app as nesto_app
    # Ensure sekura service is available on app state
    mock_sekura = AsyncMock()
    nesto_app.state.sekura = mock_sekura
    try:
        resp = await client.get(f"/api/households/{HOUSEHOLD_ID}/documents/folders")
        assert resp.status_code == 400
    finally:
        del nesto_app.state.sekura


@pytest.mark.asyncio
async def test_list_root_folder_contents_no_server(client, db_session):
    """Returns 503 when Sekura key is configured but server is not."""
    await save_sekura_connection(db_session, USER_ID, "sk_sekura_test", "readwrite")
    from app.main import app as nesto_app
    nesto_app.state.sekura = None  # server not configured
    resp = await client.get(f"/api/households/{HOUSEHOLD_ID}/documents/folders")
    assert resp.status_code == 503


@pytest.mark.asyncio
async def test_list_root_folder_contents_success(client, db_session):
    """Returns folder contents when key and server are both configured."""
    await save_sekura_connection(db_session, USER_ID, "sk_sekura_test", "readwrite")
    from app.main import app as nesto_app

    mock_sekura = AsyncMock()
    mock_sekura.get_folder_contents = AsyncMock(return_value={
        "folder": None,
        "ancestors": [],
        "folders": [{"id": "f1", "name": "Photos"}],
        "files": [],
    })
    nesto_app.state.sekura = mock_sekura

    try:
        resp = await client.get(f"/api/households/{HOUSEHOLD_ID}/documents/folders")
        assert resp.status_code == 200
        data = resp.json()
        assert data["folders"][0]["name"] == "Photos"
    finally:
        del nesto_app.state.sekura


@pytest.mark.asyncio
async def test_create_folder_proxy(client, db_session):
    """Create folder proxies to SekuraService.create_folder."""
    await save_sekura_connection(db_session, USER_ID, "sk_sekura_test", "readwrite")
    from app.main import app as nesto_app

    mock_sekura = AsyncMock()
    mock_sekura.create_folder = AsyncMock(return_value={"id": "f2", "name": "Work"})
    nesto_app.state.sekura = mock_sekura

    try:
        resp = await client.post(
            f"/api/households/{HOUSEHOLD_ID}/documents/folders",
            json={"name": "Work", "parent_id": None},
        )
        assert resp.status_code == 200
        assert resp.json()["name"] == "Work"
    finally:
        del nesto_app.state.sekura
