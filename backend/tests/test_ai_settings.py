import os

os.environ.setdefault("SECRET_KEY", "a" * 64)
os.environ.setdefault("OIDC_ISSUER_URL", "https://auth.example.com")
os.environ.setdefault("OIDC_CLIENT_ID", "test-client")

import pytest
from fastapi import HTTPException
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.database import Base
from app.models.ai_settings import HouseholdAiSettings
from app.models.household import Household, HouseholdMember
from app.models.user import User
from app.services.ai import openrouter, rate_limit, settings_service
from app.services.ai.models import CURATED_MODELS, DEFAULT_MODEL_ID

USER_ID = "test-user-001"
HOUSEHOLD_ID = "test-household-001"
OTHER_HOUSEHOLD_ID = "test-household-002"
URL = f"/api/households/{HOUSEHOLD_ID}/assistant/settings"


@pytest.fixture
async def db_session():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    session_factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with session_factory() as session:
        session.add(User(id=USER_ID, email="test@example.com", display_name="Test User"))
        session.add(Household(id=HOUSEHOLD_ID, name="Test Home", created_by=USER_ID))
        session.add(HouseholdMember(household_id=HOUSEHOLD_ID, user_id=USER_ID))
        session.add(Household(id=OTHER_HOUSEHOLD_ID, name="Other Home", created_by=USER_ID))
        await session.commit()
        yield session
    await engine.dispose()


@pytest.fixture
async def client(db_session: AsyncSession):
    from app.auth import get_current_user_id
    from app.database import get_db
    from app.main import app

    async def override_get_db():
        yield db_session

    async def override_get_current_user_id():
        return USER_ID

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_current_user_id] = override_get_current_user_id
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as ac:
        yield ac
    app.dependency_overrides.clear()


@pytest.fixture(autouse=True)
def _reset_and_patch(monkeypatch):
    rate_limit.reset()

    async def fake_check_key(api_key, *, transport=None):
        return {"label": "my-key", "limit_remaining": None, "usage": None}

    monkeypatch.setattr(openrouter, "check_key", fake_check_key)


async def test_put_then_get_never_returns_key(client):
    r = await client.put(URL, json={"api_key": "sk-or-secret", "model": DEFAULT_MODEL_ID})
    assert r.status_code == 200
    assert "sk-or-secret" not in r.text and r.json()["has_key"] is True
    assert r.json()["label"] == "my-key"
    g = await client.get(URL)
    assert "sk-or-secret" not in g.text
    assert g.json()["models"] == [{"id": m.id, "label": m.label} for m in CURATED_MODELS]


async def test_get_without_settings(client):
    body = (await client.get(URL)).json()
    assert body["has_key"] is False and body["model"] == DEFAULT_MODEL_ID


async def test_key_stored_encrypted(db_session, client):
    await client.put(URL, json={"api_key": "sk-or-secret"})
    row = (await db_session.execute(select(HouseholdAiSettings))).scalar_one()
    assert row.encrypted_api_key != "sk-or-secret"
    assert row.model == DEFAULT_MODEL_ID


async def test_invalid_model_rejected(client):
    r = await client.put(URL, json={"api_key": "sk-or-secret", "model": "nope/nothing"})
    assert r.status_code in (400, 422)


async def test_model_only_without_row_rejected(client):
    r = await client.put(URL, json={"model": DEFAULT_MODEL_ID})
    assert r.status_code == 400 and "Add an API key first" in r.text


async def test_model_only_updates_existing(client):
    await client.put(URL, json={"api_key": "sk-or-secret"})
    other = CURATED_MODELS[1].id
    r = await client.put(URL, json={"model": other})
    assert r.json()["model"] == other and r.json()["has_key"] is True


async def test_bad_key_rejected(client, db_session, monkeypatch):
    async def bad(api_key, *, transport=None):
        raise HTTPException(400, "OpenRouter rejected the API key")

    monkeypatch.setattr(openrouter, "check_key", bad)
    r = await client.put(URL, json={"api_key": "sk-or-bad"})
    assert r.status_code == 400
    assert (await db_session.execute(select(HouseholdAiSettings))).first() is None


async def test_delete_and_test_routes(client):
    r = await client.post(f"{URL}/test")
    assert r.status_code == 400 and "isn't set up" in r.text
    await client.put(URL, json={"api_key": "sk-or-secret"})
    r = await client.post(f"{URL}/test")
    assert r.json() == {"ok": True, "label": "my-key"}
    assert (await client.delete(URL)).status_code == 204
    assert (await client.get(URL)).json()["has_key"] is False


async def test_invalid_token_reads_as_no_key(client, db_session):
    db_session.add(HouseholdAiSettings(
        household_id=HOUSEHOLD_ID, encrypted_api_key="garbage", model=DEFAULT_MODEL_ID, updated_by=USER_ID,
    ))
    await db_session.commit()
    assert (await client.get(URL)).json()["has_key"] is False
    with pytest.raises(HTTPException) as exc:
        await settings_service.get_key_and_model(db_session, HOUSEHOLD_ID)
    assert exc.value.status_code == 400 and "re-entered" in exc.value.detail


async def test_other_household_forbidden(client):
    other = f"/api/households/{OTHER_HOUSEHOLD_ID}/assistant/settings"
    assert (await client.get(other)).status_code in (403, 404)
    assert (await client.put(other, json={"api_key": "k"})).status_code in (403, 404)
    assert (await client.delete(other)).status_code in (403, 404)
    assert (await client.post(f"{other}/test")).status_code in (403, 404)


def test_daily_cap():
    for i in range(200):
        # distinct users so the burst limit is not hit
        rate_limit.check_and_count("h1", f"u{i}")
    with pytest.raises(HTTPException) as exc:
        rate_limit.check_and_count("h1", "u-extra")
    assert exc.value.status_code == 429 and "today's limit" in exc.value.detail
    rate_limit.check_and_count("h2", "u-extra")


def test_burst_cap():
    for _ in range(10):
        rate_limit.check_and_count("h1", "u1")
    with pytest.raises(HTTPException) as exc:
        rate_limit.check_and_count("h1", "u1")
    assert exc.value.status_code == 429 and "Slow down" in exc.value.detail
