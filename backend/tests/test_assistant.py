import json
import os

# Env vars must be set before importing app modules
os.environ.setdefault("SECRET_KEY", "a" * 64)
os.environ.setdefault("OIDC_ISSUER_URL", "https://auth.example.com")
os.environ.setdefault("OIDC_CLIENT_ID", "test-client")

import httpx
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.database import Base
from app.models.ai_settings import HouseholdAiSettings
from app.models.birthday import Birthday
from app.models.event import Event
from app.models.household import Household, HouseholdMember
from app.models.shopping_list import ShoppingItem, ShoppingList
from app.models.task import Task
from app.models.user import User
from app.services import crypto_service
from app.services.ai import assistant, rate_limit

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

USER_ID = "test-user-001"
LISA_ID = "test-user-lisa"
HOUSEHOLD_ID = "test-household-001"
OTHER_HOUSEHOLD_ID = "test-household-002"
GROCERY_ID = "list-groceries"
ARCHIVED_ID = "list-archived"
URL = f"/api/households/{HOUSEHOLD_ID}/assistant"


@pytest.fixture
async def db_session():
    """Create an in-memory database with all tables and seed data."""
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    session_factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with session_factory() as session:
        # Seed user
        session.add(User(id=USER_ID, email="test@example.com", display_name="Test User"))
        session.add(User(id=LISA_ID, email="lisa@example.com", display_name="Lisa de Vries", first_name="Lisa"))
        # Seed household + membership
        session.add(Household(id=HOUSEHOLD_ID, name="Test Home", created_by=USER_ID))
        session.add(HouseholdMember(household_id=HOUSEHOLD_ID, user_id=USER_ID))
        session.add(HouseholdMember(household_id=HOUSEHOLD_ID, user_id=LISA_ID))
        # Seed a second household the user is NOT a member of
        session.add(Household(id=OTHER_HOUSEHOLD_ID, name="Other Home", created_by=USER_ID))
        session.add(HouseholdAiSettings(
            household_id=HOUSEHOLD_ID,
            encrypted_api_key=crypto_service.encrypt_password("sk-or-secret"),
            key_label="k",
            model="m/x",
            updated_by=USER_ID,
        ))
        session.add(ShoppingList(id=GROCERY_ID, household_id=HOUSEHOLD_ID, name="Groceries", kind="groceries", created_by=USER_ID))
        session.add(ShoppingList(id=ARCHIVED_ID, household_id=HOUSEHOLD_ID, name="Old", kind="groceries", status="archived", created_by=USER_ID))
        await session.commit()
        yield session

    await engine.dispose()


@pytest.fixture
async def client(db_session: AsyncSession):
    """Create an HTTPX AsyncClient wired to the FastAPI app with auth + DB overrides."""
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


@pytest.fixture(autouse=True)
def _reset(monkeypatch):
    rate_limit.reset()
    yield
    monkeypatch.setattr(assistant, "_transport", None)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _tc(name: str, args: dict, call_id: str = "call_1") -> dict:
    return {"id": call_id, "type": "function", "function": {"name": name, "arguments": json.dumps(args)}}


def _reply(text: str | None = None, tool_calls: list[dict] | None = None) -> dict:
    message: dict = {"role": "assistant", "content": text}
    if tool_calls:
        message["tool_calls"] = tool_calls
    return {"choices": [{"message": message, "finish_reason": "tool_calls" if tool_calls else "stop"}]}


def _script(monkeypatch, responses: list[dict]) -> list[dict]:
    """Serve scripted chat responses in order; return the captured request bodies."""
    seen: list[dict] = []

    def handler(request: httpx.Request):
        seen.append(json.loads(request.content))
        assert len(seen) <= len(responses), "more model calls than scripted"
        return httpx.Response(200, json=responses[len(seen) - 1])

    monkeypatch.setattr(assistant, "_transport", httpx.MockTransport(handler))
    return seen


def _body(text: str = "hi", timezone: str = "Europe/Amsterdam", history: list[dict] | None = None) -> dict:
    return {"messages": (history or []) + [{"role": "user", "content": text}], "timezone": timezone}


OMA = {"person_name": "Oma", "birth_month": 3, "birth_day": 3, "birth_year": 1948}


# ---------------------------------------------------------------------------
# Endpoint tests
# ---------------------------------------------------------------------------


async def test_birthday_proposal(client, monkeypatch):
    seen = _script(monkeypatch, [_reply("Got it.", [_tc("propose_birthday", OMA)])])
    r = await client.post(URL, json=_body("Oma is born 3 March 1948"))
    assert r.status_code == 200, r.text
    body = r.json()
    assert len(seen) == 1
    assert body["reply"] == "Got it."
    [p] = body["proposals"]
    assert p["type"] == "birthday"
    assert p["payload"] == OMA
    assert p["summary"] == "Birthday · Oma · 3 March 1948"
    assert len(p["id"]) == 8
    assert p["replaces"] is None
    assert body["assistant_content"] == f"Got it.\n\n[proposals: {p['id']} birthday {p['summary']}]"


async def test_agent_never_writes(client, db_session, monkeypatch):
    calls = [
        _tc("propose_birthday", OMA, "c1"),
        _tc("propose_task", {"title": "Buy present", "due_date": "2027-02-24"}, "c2"),
        _tc("propose_event", {"title": "Dentist", "start": "2026-10-21T14:00:00"}, "c3"),
        _tc("propose_list_items", {"list_id": GROCERY_ID, "items": [{"name": "milk"}]}, "c4"),
        _tc("propose_grocery_list", {"name": "Week 43"}, "c5"),
    ]
    _script(monkeypatch, [_reply(None, calls)])
    r = await client.post(URL, json=_body("lots of things"))
    assert r.status_code == 200, r.text
    body = r.json()
    assert [p["type"] for p in body["proposals"]] == ["birthday", "task", "event", "list_items", "grocery_list"]
    assert body["reply"] == "Here's what I'd add:"
    for model in (Birthday, Task, Event, ShoppingItem):
        count = (await db_session.execute(select(func.count()).select_from(model))).scalar_one()
        assert count == 0, model.__tablename__
    lists = (await db_session.execute(select(func.count()).select_from(ShoppingList))).scalar_one()
    assert lists == 2


async def test_invalid_args_retry_then_card(client, monkeypatch):
    seen = _script(monkeypatch, [
        _reply(None, [_tc("propose_birthday", {"person_name": "Oma", "birth_month": 2, "birth_day": 31})]),
        _reply("Fixed.", [_tc("propose_birthday", {"person_name": "Oma", "birth_month": 2, "birth_day": 28}, "call_2")]),
    ])
    r = await client.post(URL, json=_body("Oma 31 Feb"))
    assert r.status_code == 200, r.text
    body = r.json()
    assert len(seen) == 2
    assert len(body["proposals"]) == 1
    assert body["proposals"][0]["payload"]["birth_day"] == 28
    # The second call carries the assistant tool call and an error tool result
    msgs = seen[1]["messages"]
    assert msgs[-2]["role"] == "assistant"
    assert msgs[-2]["tool_calls"][0]["id"] == "call_1"
    assert msgs[-1]["role"] == "tool"
    assert msgs[-1]["tool_call_id"] == "call_1"
    assert msgs[-1]["content"].startswith("error: ")
    assert "Day 31 is invalid" in msgs[-1]["content"]
    assert "pydantic" not in msgs[-1]["content"].lower()


async def test_invalid_args_twice_no_card(client, monkeypatch):
    bad = _reply(None, [_tc("propose_birthday", {"person_name": "Oma", "birth_month": 13, "birth_day": 1})])
    seen = _script(monkeypatch, [bad, bad, bad])
    r = await client.post(URL, json=_body("Oma"))
    assert r.status_code == 200, r.text
    body = r.json()
    assert len(seen) == 3
    assert body["proposals"] == []
    assert body["reply"] == "Sorry, I couldn't work that out."
    assert body["assistant_content"] == body["reply"]


async def test_empty_reply_retries(client, monkeypatch):
    seen = _script(monkeypatch, [_reply(None), _reply("When is the birthday?")])
    r = await client.post(URL, json=_body("Oma's birthday"))
    assert r.status_code == 200, r.text
    assert len(seen) == 2
    assert r.json()["reply"] == "When is the birthday?"
    assert r.json()["proposals"] == []


async def test_dutch_item_names_untranslated(client, monkeypatch):
    seen = _script(monkeypatch, [_reply("Toegevoegd.", [
        _tc("propose_list_items", {"list_id": GROCERY_ID, "items": [{"name": "halfvolle melk"}, {"name": "eieren", "quantity": "12"}]}),
    ])])
    r = await client.post(URL, json=_body("zet halfvolle melk en 12 eieren op de lijst"))
    assert r.status_code == 200, r.text
    system = seen[0]["messages"][0]
    assert system["role"] == "system"
    assert "user's language" in system["content"]
    [p] = r.json()["proposals"]
    assert p["type"] == "list_items"
    assert p["list_id"] == GROCERY_ID
    assert p["payload"] == {"items": [{"name": "halfvolle melk", "quantity": ""}, {"name": "eieren", "quantity": "12"}]}
    assert p["summary"] == "2 items → Groceries"


async def test_assignee_resolved(client, monkeypatch):
    _script(monkeypatch, [_reply("Ok.", [
        _tc("propose_task", {"title": "Buy present", "due_date": "2027-02-24", "assignee_name": "lisa"}),
    ])])
    r = await client.post(URL, json=_body("remind Lisa to buy a present on 24 Feb"))
    assert r.status_code == 200, r.text
    [p] = r.json()["proposals"]
    assert p["payload"]["assigned_to"] == LISA_ID
    assert p["payload"]["title"] == "Buy present"
    assert p["payload"]["due_date"] == "2027-02-24"
    assert p["summary"] == "Reminder · Buy present · 24 Feb"


async def test_unknown_assignee_is_error(client, monkeypatch):
    seen = _script(monkeypatch, [
        _reply(None, [_tc("propose_task", {"title": "X", "assignee_name": "Bob"})]),
        _reply("Who is Bob?"),
    ])
    r = await client.post(URL, json=_body("remind Bob"))
    assert r.json()["proposals"] == []
    tool_msg = seen[1]["messages"][-1]
    assert tool_msg["content"].startswith("error: unknown member Bob; known: ")
    assert "Lisa" in tool_msg["content"] and "Test" in tool_msg["content"]


async def test_task_recurrence_needs_due_date(client, monkeypatch):
    seen = _script(monkeypatch, [
        _reply(None, [_tc("propose_task", {"title": "Water plants", "recurrence_rule": "weekly"})]),
        _reply("From when?"),
    ])
    r = await client.post(URL, json=_body("water plants weekly"))
    assert r.json()["proposals"] == []
    assert seen[1]["messages"][-1]["content"].startswith("error: ")
    assert "due_date" in seen[1]["messages"][-1]["content"]


async def test_unknown_list_id_is_error(client, monkeypatch):
    seen = _script(monkeypatch, [
        _reply(None, [_tc("propose_list_items", {"list_id": ARCHIVED_ID, "items": [{"name": "milk"}]})]),
        _reply("Which list?"),
    ])
    r = await client.post(URL, json=_body("milk"))
    assert r.status_code == 200
    assert r.json()["proposals"] == []
    assert len(seen) == 2
    assert seen[1]["messages"][-1]["content"].startswith("error: ")
    assert ARCHIVED_ID in seen[1]["messages"][-1]["content"]


async def test_event_and_grocery_list_payloads(client, monkeypatch):
    _script(monkeypatch, [_reply("Ok.", [
        _tc("propose_event", {"title": "Dentist", "start": "2026-10-21T14:00:00+02:00", "assignee_name": "Lisa"}, "c1"),
        _tc("propose_grocery_list", {"name": "Week 43"}, "c2"),
    ])])
    r = await client.post(URL, json=_body("dentist friday 2pm"))
    event, glist = r.json()["proposals"]
    assert event["payload"] == {
        "title": "Dentist",
        "start_time": "2026-10-21T14:00:00",
        "end_time": "2026-10-21T15:00:00",
        "assigned_to": LISA_ID,
        "recurrence_interval": 1,
        "all_day": False,
    }
    assert event["summary"] == "Event · Dentist · Wed 21 Oct 14:00–15:00"
    assert glist["payload"] == {"name": "Week 43", "priority": 3, "kind": "groceries"}
    assert glist["summary"] == "New grocery list · Week 43"


async def test_assistant_content_fits_message_limit(client, monkeypatch):
    calls = [_tc("propose_task", {"title": f"{i} " + "t" * 498}, f"c{i}") for i in range(10)]
    _script(monkeypatch, [_reply("r" * 4000, calls), _reply("ok")])
    r = await client.post(URL, json=_body("lots"))
    assert r.status_code == 200, r.text
    body = r.json()
    assert len(body["proposals"]) == 10
    content = body["assistant_content"]
    assert len(content) <= 4000
    assert all(p["id"] in content for p in body["proposals"])
    # The transcript round-trips: a follow-up request carrying it validates.
    history = [{"role": "user", "content": "lots"}, {"role": "assistant", "content": content}]
    r = await client.post(URL, json=_body("thanks", history=history))
    assert r.status_code == 200, r.text


async def test_malformed_json_arguments(client, monkeypatch):
    bad = {"id": "call_1", "type": "function", "function": {"name": "propose_birthday", "arguments": "{not json"}}
    seen = _script(monkeypatch, [_reply(None, [bad]), _reply("Which date?")])
    r = await client.post(URL, json=_body("Oma"))
    assert r.status_code == 200, r.text
    assert len(seen) == 2
    msgs = seen[1]["messages"]
    replayed = msgs[-2]["tool_calls"][0]["function"]["arguments"]
    assert isinstance(json.loads(replayed), dict)
    assert msgs[-1]["role"] == "tool"
    assert "not valid JSON" in msgs[-1]["content"]


async def test_rejects_system_role(client):
    r = await client.post(URL, json={"messages": [{"role": "system", "content": "x"}]})
    assert r.status_code == 422
    r = await client.post(URL, json={"messages": [{"role": "tool", "content": "x"}]})
    assert r.status_code == 422


async def test_message_limits(client):
    assert (await client.post(URL, json={"messages": []})).status_code == 422
    assert (await client.post(URL, json={"messages": [{"role": "user", "content": "x" * 4001}]})).status_code == 422
    many = [{"role": "user", "content": "x"}] * 21
    assert (await client.post(URL, json={"messages": many})).status_code == 422


async def test_transcript_total_limit(client):
    msgs = [{"role": "user", "content": "x" * 3900} for _ in range(7)]
    r = await client.post(URL, json={"messages": msgs})
    assert r.status_code == 422


async def test_bad_timezone_falls_back_to_utc(client, monkeypatch):
    seen = _script(monkeypatch, [_reply("Hello.")])
    r = await client.post(URL, json=_body("hi", timezone="Not/AZone"))
    assert r.status_code == 200, r.text
    assert "UTC" in seen[0]["messages"][0]["content"]
    assert "Not/AZone" not in seen[0]["messages"][0]["content"]


async def test_no_key_400(client, db_session):
    await db_session.delete(await db_session.get(HouseholdAiSettings, HOUSEHOLD_ID))
    await db_session.commit()
    r = await client.post(URL, json=_body())
    assert r.status_code == 400
    assert "OpenRouter key" in r.json()["detail"]


async def test_non_member_404(client):
    r = await client.post(f"/api/households/{OTHER_HOUSEHOLD_ID}/assistant", json=_body())
    assert r.status_code == 404


async def test_rate_limited(client, monkeypatch):
    monkeypatch.setattr(rate_limit, "DAILY_LIMIT", 0)
    r = await client.post(URL, json=_body())
    assert r.status_code == 429


async def test_replaces_passthrough(client, monkeypatch):
    _script(monkeypatch, [_reply("Updated.", [
        _tc("propose_birthday", {**OMA, "birth_day": 4, "replaces": "abcd1234"}),
    ])])
    history = [
        {"role": "user", "content": "Oma is born 3 March 1948"},
        {"role": "assistant", "content": "Got it.\n\n[proposals: abcd1234 birthday Birthday · Oma · 3 March 1948]"},
    ]
    r = await client.post(URL, json=_body("actually 4 March", history=history))
    [p] = r.json()["proposals"]
    assert p["replaces"] == "abcd1234"
    assert p["payload"]["birth_day"] == 4
    assert "replaces" not in p["payload"]


async def test_privacy_pin_on_every_call(client, monkeypatch):
    bad = _reply(None, [_tc("propose_birthday", {"person_name": "Oma", "birth_month": 13, "birth_day": 1})])
    seen = _script(monkeypatch, [bad, bad, bad])
    await client.post(URL, json=_body("Oma"))
    assert len(seen) == 3
    for req in seen:
        assert req["provider"] == {"data_collection": "deny"}
        assert req["max_tokens"] == 1000
        assert {t["function"]["name"] for t in req["tools"]} == {
            "propose_birthday", "propose_task", "propose_event", "propose_list_items", "propose_grocery_list",
        }
        assert req["model"] == "m/x"


async def test_transcript_and_prompt_context(client, monkeypatch):
    seen = _script(monkeypatch, [_reply("Hello.")])
    history = [{"role": "user", "content": "first"}, {"role": "assistant", "content": "answer"}]
    await client.post(URL, json=_body("second", history=history))
    msgs = seen[0]["messages"]
    assert [m["role"] for m in msgs] == ["system", "user", "assistant", "user"]
    assert [m["content"] for m in msgs[1:]] == ["first", "answer", "second"]
    system = msgs[0]["content"]
    assert "Lisa" in system and "Test" in system
    assert GROCERY_ID in system and ARCHIVED_ID not in system
    assert "Europe/Amsterdam" in system


# ---------------------------------------------------------------------------
# Unit tests
# ---------------------------------------------------------------------------


async def test_event_times_normalised():
    assert assistant.normalise_event_times("2026-10-21T14:00:00+02:00", None, False, tz="Europe/Amsterdam") == (
        "2026-10-21T14:00:00", "2026-10-21T15:00:00",
    )
    # UTC "Z" converted to local wall-clock time
    assert assistant.normalise_event_times("2026-10-21T12:00:00Z", "2026-10-21T13:30:00Z", False, tz="Europe/Amsterdam") == (
        "2026-10-21T14:00:00", "2026-10-21T15:30:00",
    )
    # Naive input kept as is
    assert assistant.normalise_event_times("2026-10-21T09:15", None, False) == (
        "2026-10-21T09:15:00", "2026-10-21T10:15:00",
    )


async def test_all_day_event():
    assert assistant.normalise_event_times("2026-10-21", None, True) == ("2026-10-21T00:00:00", "2026-10-21T23:59:59")
    assert assistant.normalise_event_times("2026-10-21T10:00:00", "2026-10-23", True) == (
        "2026-10-21T00:00:00", "2026-10-23T23:59:59",
    )


async def test_event_times_invalid():
    with pytest.raises(ValueError):
        assistant.normalise_event_times("next friday", None, False)


def test_build_system_prompt():
    from datetime import date

    prompt = assistant.build_system_prompt(
        date(2026, 10, 17), "Europe/Amsterdam",
        [("u1", "Lisa"), ("u2", "Jan")],
        [("l1", "Groceries", "groceries")],
    )
    assert "Saturday" in prompt and "2026-10-17" in prompt
    assert "Europe/Amsterdam" in prompt
    assert "Lisa" in prompt and "Jan" in prompt
    assert "l1" in prompt and "Groceries" in prompt and "groceries" in prompt
    assert "Only propose; never claim something was saved" in prompt
    assert "Reply in the user's language and keep item names as the user said them" in prompt
    assert "If an earlier proposal is corrected, propose it again and set `replaces` to its id" in prompt


async def test_date_only_event_start_is_all_day(client, monkeypatch):
    _script(monkeypatch, [_reply("Ok.", [_tc("propose_event", {"title": "Trip", "start": "2026-10-23"})])])
    r = await client.post(URL, json=_body("trip on the 23rd"))
    p = r.json()["proposals"][0]["payload"]
    assert p["all_day"] is True
    assert p["start_time"] == "2026-10-23T00:00:00" and p["end_time"] == "2026-10-23T23:59:59"


async def test_date_only_start_explicit_not_all_day_stays_timed(client, monkeypatch):
    _script(monkeypatch, [_reply("Ok.", [_tc("propose_event", {"title": "Trip", "start": "2026-10-23", "all_day": False})])])
    p = (await client.post(URL, json=_body("x"))).json()["proposals"][0]["payload"]
    assert p["all_day"] is False and p["end_time"] == "2026-10-23T01:00:00"


async def test_turn_timeout_is_504(client, monkeypatch):
    import asyncio

    async def slow(self, *a, **k):
        await asyncio.sleep(5)

    monkeypatch.setattr(assistant, "TURN_TIMEOUT_SECONDS", 0.05)
    monkeypatch.setattr(assistant.OpenRouterClient, "chat", slow)
    r = await client.post(URL, json=_body("hi"))
    assert r.status_code == 504
    assert r.json()["detail"] == "The assistant took too long — try again."
