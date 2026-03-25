import os
import uuid

os.environ.setdefault("SECRET_KEY", "a" * 64)
os.environ.setdefault("OIDC_ISSUER_URL", "https://auth.example.com")
os.environ.setdefault("OIDC_CLIENT_ID", "test-client")

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.database import Base
from app.models.comment import Comment  # noqa: F401 — register with Base.metadata
from app.models.household import Household, HouseholdMember
from app.models.notice import HouseholdNotice  # noqa: F401
from app.models.push_subscription import PushSubscription  # noqa: F401
from app.models.reminder_sent import ReminderSent  # noqa: F401
from app.models.task import Task
from app.models.user import User

USER_ID = "user-comments-001"
OTHER_USER_ID = "user-comments-002"
HOUSEHOLD_ID = "hh-comments-001"


@pytest.fixture
async def db_session():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with factory() as session:
        session.add(User(id=USER_ID, email="jan@example.com", display_name="Jan"))
        session.add(User(id=OTHER_USER_ID, email="other@example.com", display_name="Other"))
        session.add(Household(id=HOUSEHOLD_ID, name="Home", created_by=USER_ID))
        session.add(HouseholdMember(household_id=HOUSEHOLD_ID, user_id=USER_ID))
        session.add(HouseholdMember(household_id=HOUSEHOLD_ID, user_id=OTHER_USER_ID))
        await session.commit()
        yield session
    await engine.dispose()


@pytest.fixture
async def client(db_session):
    from app.auth import get_current_user_id
    from app.database import get_db
    from app.main import app

    async def override_db():
        yield db_session

    async def override_auth():
        return USER_ID

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_current_user_id] = override_auth
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture
async def task_id(db_session):
    """Creates a task in the household and returns its id."""
    tid = str(uuid.uuid4())
    db_session.add(Task(
        id=tid,
        household_id=HOUSEHOLD_ID,
        title="Test task for comments",
        status="pending",
        priority=3,
        created_by=USER_ID,
    ))
    await db_session.commit()
    return tid


def _comments_url(entity_type: str, entity_id: str) -> str:
    return f"/api/households/{HOUSEHOLD_ID}/comments/{entity_type}/{entity_id}"


# ---------------------------------------------------------------------------
# 1. GET returns empty list when no comments
# ---------------------------------------------------------------------------
async def test_list_comments_empty(client, task_id):
    r = await client.get(_comments_url("task", task_id))
    assert r.status_code == 200
    assert r.json() == []


# ---------------------------------------------------------------------------
# 2. POST creates a comment, returns 201 with correct fields
# ---------------------------------------------------------------------------
async def test_create_comment(client, task_id):
    r = await client.post(_comments_url("task", task_id), json={"content": "Hello world"})
    assert r.status_code == 201
    data = r.json()
    assert data["content"] == "Hello world"
    assert data["author_id"] == USER_ID
    assert data["entity_type"] == "task"
    assert data["entity_id"] == task_id
    assert "id" in data
    assert "created_at" in data
    assert "author_name" in data


# ---------------------------------------------------------------------------
# 3. Content with surrounding whitespace is stripped
# ---------------------------------------------------------------------------
async def test_create_comment_strips_whitespace(client, task_id):
    r = await client.post(_comments_url("task", task_id), json={"content": "  trimmed  "})
    assert r.status_code == 201
    assert r.json()["content"] == "trimmed"


# ---------------------------------------------------------------------------
# 4. POST with blank content returns 422
# ---------------------------------------------------------------------------
async def test_create_comment_empty_content(client, task_id):
    r = await client.post(_comments_url("task", task_id), json={"content": "   "})
    assert r.status_code == 422


# ---------------------------------------------------------------------------
# 5. List returns the created comment with author_name populated
# ---------------------------------------------------------------------------
async def test_list_comments_after_create(client, task_id):
    await client.post(_comments_url("task", task_id), json={"content": "First comment"})
    r = await client.get(_comments_url("task", task_id))
    assert r.status_code == 200
    comments = r.json()
    assert len(comments) == 1
    assert comments[0]["content"] == "First comment"
    assert comments[0]["author_name"] == "Jan"
    assert comments[0]["author_id"] == USER_ID


# ---------------------------------------------------------------------------
# 6. Author can DELETE their own comment → 204
# ---------------------------------------------------------------------------
async def test_delete_comment_by_author(client, task_id):
    r = await client.post(_comments_url("task", task_id), json={"content": "Delete me"})
    comment_id = r.json()["id"]
    r2 = await client.delete(f"{_comments_url('task', task_id)}/{comment_id}")
    assert r2.status_code == 204
    # Confirm it's gone
    r3 = await client.get(_comments_url("task", task_id))
    assert r3.json() == []


# ---------------------------------------------------------------------------
# 7. Non-author gets 403 when trying to delete
# ---------------------------------------------------------------------------
async def test_delete_comment_by_non_author(client, task_id):
    r = await client.post(_comments_url("task", task_id), json={"content": "Mine"})
    comment_id = r.json()["id"]

    from app.auth import get_current_user_id
    from app.main import app
    app.dependency_overrides[get_current_user_id] = lambda: OTHER_USER_ID
    r2 = await client.delete(f"{_comments_url('task', task_id)}/{comment_id}")
    app.dependency_overrides[get_current_user_id] = lambda: USER_ID

    assert r2.status_code == 403


# ---------------------------------------------------------------------------
# 8. DELETE non-existent comment returns 404
# ---------------------------------------------------------------------------
async def test_delete_comment_not_found(client, task_id):
    r = await client.delete(f"{_comments_url('task', task_id)}/nonexistent-id")
    assert r.status_code == 404


# ---------------------------------------------------------------------------
# 9. GET/POST with entity_type "invalid" returns 400
# ---------------------------------------------------------------------------
async def test_invalid_entity_type_get(client, task_id):
    r = await client.get(_comments_url("invalid", task_id))
    assert r.status_code == 400


async def test_invalid_entity_type_post(client, task_id):
    r = await client.post(_comments_url("invalid", task_id), json={"content": "hello"})
    assert r.status_code == 400


# ---------------------------------------------------------------------------
# 10. Mention of a non-member user_id returns 400
# ---------------------------------------------------------------------------
async def test_create_comment_with_invalid_mention(client, task_id):
    r = await client.post(
        _comments_url("task", task_id),
        json={"content": "Hey @ghost", "mentions": ["non-member-user-id"]},
    )
    assert r.status_code == 400


# ---------------------------------------------------------------------------
# 11. GET /tasks returns comment_count field
# ---------------------------------------------------------------------------
async def test_task_list_includes_comment_count(client, task_id):
    # No comments yet — count should be 0
    r = await client.get(f"/api/households/{HOUSEHOLD_ID}/tasks")
    assert r.status_code == 200
    tasks = r.json()
    the_task = next(t for t in tasks if t["id"] == task_id)
    assert the_task["comment_count"] == 0

    # Add a comment and re-check
    await client.post(_comments_url("task", task_id), json={"content": "One comment"})
    r2 = await client.get(f"/api/households/{HOUSEHOLD_ID}/tasks")
    tasks2 = r2.json()
    the_task2 = next(t for t in tasks2 if t["id"] == task_id)
    assert the_task2["comment_count"] == 1
