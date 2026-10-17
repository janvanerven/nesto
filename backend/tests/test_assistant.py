import json

import httpx
import pytest
from sqlalchemy import func, select

from app.models.ai_settings import HouseholdAiSettings
from app.models.contact import ContactAddress, Person
from app.models.event import Event
from app.models.household import HouseholdMember
from app.models.shopping_list import ShoppingItem, ShoppingList
from app.models.task import Task
from app.models.user import User
from app.services.ai import assistant, rate_limit
from tests.conftest import HOUSEHOLD_ID, OTHER_HOUSEHOLD_ID, USER_ID, add_ai_settings

LISA_ID = "test-user-lisa"
GROCERY_ID = "list-groceries"
ARCHIVED_ID = "list-archived"
HOME_ID = "addr-home"
OMA_HOME_ID = "addr-oma"
MARK_ID = "person-mark"
NOOR_ID = "person-noor"
OTHER_PERSON_ID = "person-other"
URL = f"/api/households/{HOUSEHOLD_ID}/assistant"


@pytest.fixture
def extra_seed():
    def seed(session):
        session.add(User(id=LISA_ID, email="lisa@example.com", display_name="Lisa de Vries", first_name="Lisa"))
        session.add(HouseholdMember(household_id=HOUSEHOLD_ID, user_id=LISA_ID))
        add_ai_settings(session)
        session.add(ShoppingList(id=GROCERY_ID, household_id=HOUSEHOLD_ID, name="Groceries", kind="groceries", created_by=USER_ID))
        session.add(ShoppingList(id=ARCHIVED_ID, household_id=HOUSEHOLD_ID, name="Old", kind="groceries", status="archived", created_by=USER_ID))
        session.add(ContactAddress(id=HOME_ID, household_id=HOUSEHOLD_ID, label="Mark & Lisa", street="Dorpsstraat 1", postcode="1234 AB", city="Utrecht", created_by=USER_ID))
        session.add(ContactAddress(id=OMA_HOME_ID, household_id=HOUSEHOLD_ID, label="Oma", street="Kerkstraat 5", city="Utrecht", created_by=USER_ID))
        session.add(Person(id=MARK_ID, household_id=HOUSEHOLD_ID, address_id=HOME_ID, name="Mark", birth_month=10, birth_day=12, created_by=USER_ID))
        session.add(Person(id=NOOR_ID, household_id=HOUSEHOLD_ID, name="Noor", created_by=USER_ID))
        session.add(Person(id=OTHER_PERSON_ID, household_id=OTHER_HOUSEHOLD_ID, name="Stranger", created_by=USER_ID))
    return seed


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
    for model in (Task, Event, ShoppingItem):
        count = (await db_session.execute(select(func.count()).select_from(model))).scalar_one()
        assert count == 0, model.__tablename__
    people = (await db_session.execute(select(func.count()).select_from(Person))).scalar_one()
    assert people == 3
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
            "propose_address", "propose_person", "propose_person_update", "propose_address_update",
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


# ---------------------------------------------------------------------------
# Contact tools
# ---------------------------------------------------------------------------


async def _one_proposal(client, monkeypatch, name: str, args: dict) -> dict:
    _script(monkeypatch, [_reply("Ok.", [_tc(name, args)])])
    r = await client.post(URL, json=_body("contacts"))
    assert r.status_code == 200, r.text
    [p] = r.json()["proposals"]
    return p


async def _tool_error(client, monkeypatch, name: str, args: dict) -> str:
    seen = _script(monkeypatch, [_reply(None, [_tc(name, args)]), _reply("Who?")])
    r = await client.post(URL, json=_body("contacts"))
    assert r.status_code == 200, r.text
    assert r.json()["proposals"] == []
    return seen[1]["messages"][-1]["content"]


async def test_propose_address_with_new_and_moved_people(client, monkeypatch):
    p = await _one_proposal(client, monkeypatch, "propose_address", {
        "label": "Mark & Lisa", "street": "Kerkstraat 9", "postcode": "3511 AB", "city": "Utrecht",
        "people": [{"name": "Lisa", "birth_month": 3, "birth_day": 4}],
        "move_person_ids": [NOOR_ID],
    })
    assert p["type"] == "address"
    assert p["summary"] == "New address · Mark & Lisa · Utrecht"
    assert p["target_id"] is None
    assert p["payload"]["move_people"] == [NOOR_ID]
    assert p["payload"]["street"] == "Kerkstraat 9"
    [lisa] = p["payload"]["people"]
    assert lisa["name"] == "Lisa" and lisa["birth_month"] == 3 and lisa["birth_day"] == 4


async def test_propose_address_unknown_move_person_is_error(client, monkeypatch):
    content = await _tool_error(client, monkeypatch, "propose_address", {
        "label": "X", "street": "", "postcode": "", "city": "", "move_person_ids": [OTHER_PERSON_ID],
    })
    assert content.startswith(f"error: unknown person_id {OTHER_PERSON_ID}")


async def test_propose_person(client, monkeypatch):
    p = await _one_proposal(client, monkeypatch, "propose_person", {
        "name": "Sam", "address_id": OMA_HOME_ID, "phone": "06 1234",
    })
    assert p["type"] == "person"
    assert p["summary"] == "New contact · Sam"
    assert p["target_id"] is None
    assert p["payload"]["address_id"] == OMA_HOME_ID and p["payload"]["phone"] == "06 1234"


async def test_propose_person_unknown_address_is_error(client, monkeypatch):
    content = await _tool_error(client, monkeypatch, "propose_person", {"name": "Sam", "address_id": "nope"})
    assert content.startswith("error: unknown address_id nope")


async def test_person_update_unknown_id_is_tool_error(client, monkeypatch):
    content = await _tool_error(client, monkeypatch, "propose_person_update", {"person_id": "nope", "phone": "1"})
    assert content.startswith("error: unknown person_id")


async def test_person_update_other_household_is_tool_error(client, monkeypatch):
    content = await _tool_error(client, monkeypatch, "propose_person_update", {"person_id": OTHER_PERSON_ID, "phone": "1"})
    assert content.startswith(f"error: unknown person_id {OTHER_PERSON_ID}")


async def test_person_update_move_summary(client, monkeypatch):
    p = await _one_proposal(client, monkeypatch, "propose_person_update", {"person_id": MARK_ID, "address_id": OMA_HOME_ID})
    assert p["type"] == "person_update"
    assert p["target_id"] == MARK_ID
    assert p["payload"] == {"address_id": OMA_HOME_ID}
    assert p["summary"] == "Mark: moves to Kerkstraat 5, Utrecht"


async def test_person_update_birthday_and_fields_summary(client, monkeypatch):
    p = await _one_proposal(client, monkeypatch, "propose_person_update", {
        "person_id": MARK_ID, "birth_year": 1990, "phone": "06 1", "email": "mark@example.com",
    })
    assert p["payload"] == {"birth_year": 1990, "phone": "06 1", "email": "mark@example.com"}
    assert p["summary"] == "Mark: 🎂 12 Oct 1990 · updates phone, email"


async def test_person_update_invalid_merged_birthday_is_error(client, monkeypatch):
    content = await _tool_error(client, monkeypatch, "propose_person_update", {"person_id": NOOR_ID, "birth_month": 5})
    assert content.startswith("error: birth_month and birth_day must be set together")


async def test_person_update_unlink_address(client, monkeypatch):
    p = await _one_proposal(client, monkeypatch, "propose_person_update", {"person_id": MARK_ID, "address_id": None})
    assert p["payload"] == {"address_id": None}
    assert p["summary"] == "Mark: no longer at an address"


async def test_person_update_without_changes_is_error(client, monkeypatch):
    content = await _tool_error(client, monkeypatch, "propose_person_update", {"person_id": MARK_ID})
    assert content.startswith("error: nothing to change")


async def test_address_update_payload_exclude_unset(client, monkeypatch):
    p = await _one_proposal(client, monkeypatch, "propose_address_update", {
        "address_id": HOME_ID, "street": "Kerkstraat 7", "notes": None,
    })
    assert p["type"] == "address_update"
    assert p["target_id"] == HOME_ID
    assert p["payload"] == {"street": "Kerkstraat 7"}
    assert p["summary"] == "Mark & Lisa: moves to Kerkstraat 7, Utrecht"


async def test_address_update_unknown_id_is_error(client, monkeypatch):
    content = await _tool_error(client, monkeypatch, "propose_address_update", {"address_id": "nope", "city": "X"})
    assert content.startswith("error: unknown address_id nope")


async def test_contacts_in_prompt_and_capped(client, db_session, monkeypatch):
    for i in range(305):
        db_session.add(Person(id=f"bulk-{i:03}", household_id=HOUSEHOLD_ID, name=f"Zz {i:03}", created_by=USER_ID))
    await db_session.commit()
    seen = _script(monkeypatch, [_reply("Hello.")])
    r = await client.post(URL, json=_body("hi"))
    assert r.status_code == 200, r.text
    system = seen[0]["messages"][0]["content"]
    assert f"{MARK_ID} | Mark | {HOME_ID} | 12 Oct" in system
    assert f"{NOOR_ID} | Noor | - | -" in system
    assert f"{HOME_ID} | Mark & Lisa | Utrecht" in system
    assert f"{OMA_HOME_ID} | Oma | Utrecht" in system
    assert OTHER_PERSON_ID not in system
    assert system.count("bulk-") == 298
    assert "bulk-297" in system and "bulk-298" not in system
    assert "only the first 300 people are listed" in system
    assert "Prefer updating a known person or address over creating a new one" in system
