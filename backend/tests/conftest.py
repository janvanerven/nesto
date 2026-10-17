import os

# Env vars must be set before importing app modules
os.environ.setdefault("SECRET_KEY", "a" * 64)
os.environ.setdefault("OIDC_ISSUER_URL", "https://auth.example.com")
os.environ.setdefault("OIDC_CLIENT_ID", "test-client")

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.database import Base
from app.models.household import Household, HouseholdMember
from app.models.user import User

# ---------------------------------------------------------------------------
# Shared fixtures. Older test modules still define their own db_session/client,
# which take precedence over these.
# ---------------------------------------------------------------------------

USER_ID = "test-user-001"
HOUSEHOLD_ID = "test-household-001"
OTHER_HOUSEHOLD_ID = "test-household-002"


@pytest.fixture
def extra_seed():
    """Override in a test module to add rows before the seed is committed."""
    return lambda session: None


@pytest.fixture
async def db_session(extra_seed):
    """In-memory database with a user, their household and a household they are not in."""
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    session_factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with session_factory() as session:
        session.add(User(id=USER_ID, email="test@example.com", display_name="Test User"))
        session.add(Household(id=HOUSEHOLD_ID, name="Test Home", created_by=USER_ID))
        session.add(HouseholdMember(household_id=HOUSEHOLD_ID, user_id=USER_ID))
        session.add(Household(id=OTHER_HOUSEHOLD_ID, name="Other Home", created_by=USER_ID))
        extra_seed(session)
        await session.commit()
        yield session

    await engine.dispose()


@pytest.fixture
async def client(db_session: AsyncSession):
    """HTTPX client wired to the app with auth + DB overrides."""
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


def add_ai_settings(session, household_id: str = HOUSEHOLD_ID) -> None:
    """Seed a stored (encrypted) OpenRouter key for a household."""
    from app.models.ai_settings import HouseholdAiSettings
    from app.services import crypto_service

    session.add(HouseholdAiSettings(
        household_id=household_id,
        encrypted_api_key=crypto_service.encrypt_password("sk-or-secret"),
        key_label="k",
        model="m/x",
        updated_by=USER_ID,
    ))
