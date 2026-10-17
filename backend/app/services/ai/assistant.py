"""Home-page assistant: turns a chat transcript into proposal cards.

Design: docs/superpowers/specs/2026-10-17-ai-assistant-design.md §6.

The assistant never writes to the database. Every write tool only validates
its arguments against the matching create schema and returns a ``Proposal``;
the frontend saves a proposal through the normal create endpoints.
"""

from __future__ import annotations

import asyncio
import json
import uuid
from datetime import date, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

import httpx
from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.contact import ContactAddress, Person
from app.models.user import User
from app.schemas.assistant import MAX_MESSAGE_CHARS, AssistantRequest, AssistantResponse, Proposal
from app.schemas.birthday import BirthdayCreate, validate_birth_date
from app.schemas.contact import AddressCreate, AddressUpdate, PersonCreate, PersonUpdate
from app.schemas.event import EventCreate
from app.schemas.shopping_list import BulkItemsCreate, ShoppingListCreate
from app.schemas.task import TaskCreate
from app.services.ai.openrouter import ChatResult, OpenRouterClient, ToolCall
from app.services.ai.settings_service import get_key_and_model
from app.services.household_service import list_household_members
from app.services.shopping_list_service import list_shopping_lists

# Test seam: tests set this to an httpx.MockTransport.
_transport: httpx.AsyncBaseTransport | None = None

MAX_CALLS = 3
TURN_TIMEOUT_SECONDS = 110.0  # stay under nginx's 120s proxy timeout
MAX_TOKENS = 1000
MAX_REPLACES = 64
NOTE_SUMMARY_CHARS = 60
MAX_NOTE_CHARS = 3000
MAX_CONTACTS = 300  # people (and, separately, addresses) listed in the prompt

FALLBACK_WITH_PROPOSALS = "Here's what I'd add:"
FALLBACK_EMPTY = "Sorry, I couldn't work that out."

_WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
_MONTHS = ["January", "February", "March", "April", "May", "June", "July",
           "August", "September", "October", "November", "December"]
_RECURRENCE = ["daily", "weekly", "monthly", "yearly"]

# --------------------------------------------------------------------------
# Tools
# --------------------------------------------------------------------------

_BIRTH_PROPS = {
    "birth_month": {"type": "integer", "minimum": 1, "maximum": 12},
    "birth_day": {"type": "integer", "minimum": 1, "maximum": 31},
    "birth_year": {"type": "integer", "description": "Only if known."},
}
_PERSON_PROPS = {
    "name": {"type": "string"},
    **_BIRTH_PROPS,
    "phone": {"type": "string"},
    "email": {"type": "string"},
    "notes": {"type": "string"},
}
_ADDRESS_PROPS = {
    "label": {"type": "string", "description": "Who lives there, e.g. \"Mark & Lisa\"."},
    "street": {"type": "string", "description": "Street and house number."},
    "postcode": {"type": "string"},
    "city": {"type": "string"},
    "country": {"type": "string", "description": "Only if abroad."},
    "notes": {"type": "string"},
}
_ADDRESS_ID = {"type": "string", "description": "Id of an address from the contacts list."}
_PERSON_ID = {"type": "string", "description": "Id of a person from the contacts list."}
_PERSON_KEYS = tuple(_PERSON_PROPS)
_ADDRESS_KEYS = tuple(_ADDRESS_PROPS)
_BIRTH_KEYS = tuple(_BIRTH_PROPS)
_LOCATION_KEYS = ("street", "postcode", "city", "country")

_REPLACES = {
    "type": "string",
    "description": "Card id of an earlier unsaved proposal that this one corrects.",
}


def _tool(name: str, description: str, properties: dict, required: list[str]) -> dict:
    return {
        "type": "function",
        "function": {
            "name": name,
            "description": description,
            "parameters": {
                "type": "object",
                "properties": {**properties, "replaces": _REPLACES},
                "required": required,
            },
        },
    }


TOOLS: list[dict] = [
    _tool(
        "propose_birthday",
        "Propose adding a birthday.",
        {"person_name": {"type": "string"}, **_BIRTH_PROPS},
        ["person_name", "birth_month", "birth_day"],
    ),
    _tool(
        "propose_task",
        "Propose a reminder (a to-do, optionally due on a date and/or recurring).",
        {
            "title": {"type": "string"},
            "description": {"type": "string"},
            "due_date": {"type": "string", "description": "YYYY-MM-DD. Required when recurring."},
            "priority": {"type": "integer", "minimum": 1, "maximum": 4, "description": "1 urgent … 4 low; default 3."},
            "assignee_name": {"type": "string", "description": "A household member's name."},
            "recurrence_rule": {"type": "string", "enum": _RECURRENCE},
            "recurrence_interval": {"type": "integer", "minimum": 1, "maximum": 99},
        },
        ["title"],
    ),
    _tool(
        "propose_event",
        "Propose a calendar event.",
        {
            "title": {"type": "string"},
            "start": {"type": "string", "description": "Local time YYYY-MM-DDTHH:MM:SS (or YYYY-MM-DD when all day)."},
            "end": {"type": "string", "description": "Local time; defaults to start + 1 hour."},
            "all_day": {"type": "boolean"},
            "description": {"type": "string"},
            "assignee_name": {"type": "string", "description": "A household member's name."},
            "recurrence_rule": {"type": "string", "enum": _RECURRENCE},
        },
        ["title", "start"],
    ),
    _tool(
        "propose_list_items",
        "Propose adding items to one of the active lists.",
        {
            "list_id": {"type": "string", "description": "Id of an active list from the context."},
            "items": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {"name": {"type": "string"}, "quantity": {"type": "string"}},
                    "required": ["name"],
                },
            },
        },
        ["list_id", "items"],
    ),
    _tool(
        "propose_grocery_list",
        "Propose creating a new grocery list.",
        {"name": {"type": "string"}},
        ["name"],
    ),
    _tool(
        "propose_address",
        "Propose a new address, with new people living there and/or known people moving in.",
        {
            **_ADDRESS_PROPS,
            "people": {
                "type": "array",
                "description": "New people (not yet in the contacts) living at this address.",
                "items": {"type": "object", "properties": _PERSON_PROPS, "required": ["name"]},
            },
            "move_person_ids": {
                "type": "array",
                "description": "Ids of known people moving to this address.",
                "items": {"type": "string"},
            },
        },
        ["label", "street", "postcode", "city"],
    ),
    _tool(
        "propose_person",
        "Propose a new contact person, optionally at a known address.",
        {**_PERSON_PROPS, "address_id": _ADDRESS_ID},
        ["name"],
    ),
    _tool(
        "propose_person_update",
        "Propose changes to a known person. Give only the fields that change.",
        {
            "person_id": _PERSON_ID,
            **_PERSON_PROPS,
            "address_id": {**_ADDRESS_ID, "description": _ADDRESS_ID["description"]
                           + " An empty string means they no longer live at an address."},
        },
        ["person_id"],
    ),
    _tool(
        "propose_address_update",
        "Propose changes to a known address (e.g. the household moved). Give only the fields that change.",
        {"address_id": _ADDRESS_ID, **_ADDRESS_PROPS},
        ["address_id"],
    ),
]


# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------


class ToolError(Exception):
    """A tool call the model should fix; the message is returned to the model."""


def _zone(tz: str | ZoneInfo) -> ZoneInfo:
    if isinstance(tz, ZoneInfo):
        return tz
    try:
        return ZoneInfo(tz)
    except Exception:  # ZoneInfoNotFoundError, ValueError for malformed keys, ...
        return ZoneInfo("UTC")


def resolve_timezone(tz: str) -> str:
    """Return ``tz`` if it is a valid IANA zone, else ``"UTC"``."""
    return _zone(tz).key


def member_name(user: User) -> str:
    first = (user.first_name or "").strip()
    if first:
        return first
    words = (user.display_name or "").split()
    return words[0] if words else "Member"


def _format_errors(exc: ValidationError) -> str:
    parts = []
    for err in exc.errors(include_url=False):
        loc = ".".join(str(p) for p in err["loc"])
        msg = str(err["msg"]).removeprefix("Value error, ")
        parts.append(f"{loc}: {msg}" if loc else msg)
    return "; ".join(parts)


def _pick(args: dict, *keys: str) -> dict:
    """Arguments the model actually supplied (``None`` means "not given")."""
    return {k: args[k] for k in keys if args.get(k) is not None}


def _parse_dt(value: Any, zone: ZoneInfo) -> datetime:
    if not isinstance(value, str):
        raise ValueError("expected an ISO date/time string")
    try:
        dt = datetime.fromisoformat(value.strip())
    except ValueError:
        raise ValueError(f"invalid date/time {value[:40]!r}, use YYYY-MM-DDTHH:MM:SS") from None
    if dt.tzinfo is not None:
        dt = dt.astimezone(zone).replace(tzinfo=None)
    return dt.replace(microsecond=0)


def normalise_event_times(
    start: str, end: str | None, all_day: bool, *, tz: str | ZoneInfo = "UTC"
) -> tuple[str, str]:
    """Return naive local ``YYYY-MM-DDTHH:MM:SS`` start/end strings.

    Offsets are converted to ``tz`` and then dropped. All-day events span
    ``T00:00:00``–``T23:59:59``; a missing end is start + 1 hour (timed) or
    the same day (all day). Raises ``ValueError`` on unparseable input.
    """
    zone = _zone(tz)
    s = _parse_dt(start, zone)
    e = _parse_dt(end, zone) if end else None
    if all_day:
        end_day = e.date() if e else s.date()
        return f"{s.date().isoformat()}T00:00:00", f"{end_day.isoformat()}T23:59:59"
    if e is None:
        e = s + timedelta(hours=1)
    return s.strftime("%Y-%m-%dT%H:%M:%S"), e.strftime("%Y-%m-%dT%H:%M:%S")


def _birth_text(month: int, day: int, year: int | None) -> str:
    text = f"{day} {_MONTHS[month - 1][:3]}"
    return f"{text} {year}" if year else text


# (id, name, address_id, (birth_month, birth_day, birth_year))
PersonRow = tuple[str, str, str | None, tuple[int | None, int | None, int | None]]
# (id, label, street, city)
AddressRow = tuple[str, str, str, str]


def _one_line(text: str) -> str:
    """Contact text for a ``|``-separated prompt line: no pipes, no line breaks."""
    return " ".join(text.replace("|", " ").split())


def build_contacts_section(people: list[PersonRow], addresses: list[AddressRow], truncated: bool = False) -> str:
    person_lines = [
        f"{pid} | {_one_line(name)} | {aid or '-'} | {_birth_text(*birth) if birth[0] and birth[1] else '-'}"
        for pid, name, aid, birth in people
    ]
    if truncated:
        person_lines.append(f"(only the first {MAX_CONTACTS} people are listed)")
    address_lines = [f"{aid} | {_one_line(label)} | {_one_line(city)}" for aid, label, _, city in addresses]
    return (
        "Contacts, people (id | name | address_id | birthday):\n"
        + ("\n".join(person_lines) or "none")
        + "\nContacts, addresses (id | label | city):\n"
        + ("\n".join(address_lines) or "none")
        + "\n"
    )


def build_system_prompt(
    today: date,
    tz: str,
    members: list[tuple[str, str]],
    lists: list[tuple[str, str, str]],
    contacts: str = "",
) -> str:
    member_names = ", ".join(name for _, name in members) or "none"
    if lists:
        list_lines = "\n".join(f"- {name or '(unnamed)'} (id: {lid}, kind: {kind})" for lid, name, kind in lists)
    else:
        list_lines = "- none"
    today_text = f"{_WEEKDAYS[today.weekday()]} {today.day} {_MONTHS[today.month - 1]} {today.year}"
    return (
        "You are the assistant in Nesto, a household app. You help the user add birthdays, "
        "reminders, calendar events, items on shopping lists, new grocery lists and contacts "
        "(people and their addresses) by calling "
        "the propose_* tools. Each tool call shows the user a card they can save, edit or cancel.\n"
        f"\nToday is {today_text} ({today.isoformat()}). The user's timezone is {tz}.\n"
        f"Household members: {member_names}.\n"
        f"Active lists:\n{list_lines}\n"
        f"{contacts}"
        "\nRules:\n"
        "- Only propose; never claim something was saved. The user saves each card themselves.\n"
        "- Reply in the user's language and keep item names as the user said them.\n"
        "- If an earlier proposal is corrected, propose it again and set `replaces` to its id. "
        "Your earlier replies end with a note like \"[proposals: <id> <type> <summary>; ...]\" "
        "listing the cards you proposed.\n"
        "- If something needed is missing or ambiguous, ask a short question in plain text instead of guessing.\n"
        "- Make one tool call per thing to add; a single message may need several.\n"
        "- Dates are YYYY-MM-DD. Event times are local wall-clock times in the user's timezone, "
        "YYYY-MM-DDTHH:MM:SS without an offset.\n"
        "- Assign people only by the member names above. Use only list ids from the active lists above.\n"
        "- Use only person and address ids from the contacts above. Prefer updating a known person or "
        "address over creating a new one; use propose_birthday only for people not in the contacts list.\n"
        "- Keep replies to one or two short sentences."
    )


# --------------------------------------------------------------------------
# Summaries
# --------------------------------------------------------------------------


def _short_day(d: date) -> str:
    return f"{_WEEKDAYS[d.weekday()][:3]} {d.day} {_MONTHS[d.month - 1][:3]}"


def _event_when(start: datetime, end: datetime, all_day: bool) -> str:
    if all_day:
        if start.date() == end.date():
            return f"{_short_day(start)} (all day)"
        return f"{_short_day(start)} – {_short_day(end)} (all day)"
    if start.date() == end.date():
        return f"{_short_day(start)} {start:%H:%M}–{end:%H:%M}"
    return f"{_short_day(start)} {start:%H:%M} – {_short_day(end)} {end:%H:%M}"


def _with_recurrence(text: str, rule: str | None) -> str:
    return f"{text} · {rule}" if rule else text


# --------------------------------------------------------------------------
# Tool handlers
# --------------------------------------------------------------------------


class _Context:
    def __init__(
        self,
        members: list[tuple[str, str]],
        lists: list[tuple[str, str, str]],
        tz: str,
        people: list[PersonRow],
        addresses: list[AddressRow],
    ) -> None:
        self.members = members
        self.lists = {lid: name for lid, name, _ in lists}
        self.tz = tz
        self.people = {pid: (name, aid, birth) for pid, name, aid, birth in people}
        self.addresses = {aid: (label, street, city) for aid, label, street, city in addresses}

    def person(self, person_id: Any) -> tuple[str, str | None, tuple[int | None, int | None, int | None]]:
        if not isinstance(person_id, str) or person_id not in self.people:
            raise ToolError(f"unknown person_id {person_id}")
        return self.people[person_id]

    def address(self, address_id: Any) -> tuple[str, str, str]:
        if not isinstance(address_id, str) or address_id not in self.addresses:
            raise ToolError(f"unknown address_id {address_id}")
        return self.addresses[address_id]

    def reject_known_name(self, name: str) -> None:
        """Refuse to create a person whose name matches exactly one known person."""
        wanted = name.strip().casefold()
        matches = [pid for pid, (pname, _, _) in self.people.items() if pname.strip().casefold() == wanted]
        if len(matches) == 1:
            raise ToolError(
                f"{name.strip()} is already in contacts (person_id {matches[0]}); use propose_person_update, "
                "or ask the user if this is a different person"
            )

    def resolve_member(self, name: Any) -> str | None:
        if name is None or (isinstance(name, str) and not name.strip()):
            return None
        wanted = str(name).strip()
        matches = [mid for mid, mname in self.members if mname.casefold() == wanted.casefold()]
        if len(matches) != 1:
            known = ", ".join(mname for _, mname in self.members)
            raise ToolError(f"unknown member {wanted}; known: {known}")
        return matches[0]


def _birthday(args: dict, ctx: _Context) -> tuple[dict, str, str | None]:
    b = BirthdayCreate(**_pick(args, "person_name", "birth_month", "birth_day", "birth_year"))
    ctx.reject_known_name(b.person_name)
    summary = f"Birthday · {b.person_name} · {b.birth_day} {_MONTHS[b.birth_month - 1]}"
    if b.birth_year:
        summary += f" {b.birth_year}"
    return b.model_dump(mode="json", exclude_none=True), summary, None


def _task(args: dict, ctx: _Context) -> tuple[dict, str, str | None]:
    data = _pick(args, "title", "description", "due_date", "priority", "recurrence_rule", "recurrence_interval")
    data["assigned_to"] = ctx.resolve_member(args.get("assignee_name"))
    t = TaskCreate(**data)
    if t.recurrence_rule and t.due_date is None:
        raise ToolError("due_date: required when recurrence_rule is set")
    summary = f"Reminder · {t.title}"
    if t.due_date:
        summary += f" · {t.due_date.day} {_MONTHS[t.due_date.month - 1][:3]}"
    return t.model_dump(mode="json", exclude_none=True), _with_recurrence(summary, t.recurrence_rule), None


def _event(args: dict, ctx: _Context) -> tuple[dict, str, str | None]:
    if args.get("start") is None:
        raise ToolError("start: field required")
    flag = str(args.get("all_day")).lower()
    if flag == "false":
        all_day = False
    else:
        # A date-only start ("2026-10-23") is an all-day event unless explicitly timed.
        all_day = flag == "true" or (isinstance(args["start"], str) and len(args["start"].strip()) <= 10)
    try:
        start, end = normalise_event_times(args["start"], args.get("end"), all_day, tz=ctx.tz)
    except ValueError as exc:
        raise ToolError(str(exc)) from None
    data = _pick(args, "title", "description", "recurrence_rule")
    data.update(start_time=start, end_time=end, all_day=all_day)
    data["assigned_to"] = ctx.resolve_member(args.get("assignee_name"))
    e = EventCreate(**data)
    summary = f"Event · {e.title} · {_event_when(e.start_time, e.end_time, e.all_day)}"
    return e.model_dump(mode="json", exclude_none=True), _with_recurrence(summary, e.recurrence_rule), None


def _list_items(args: dict, ctx: _Context) -> tuple[dict, str, str | None]:
    list_id = args.get("list_id")
    if not isinstance(list_id, str) or list_id not in ctx.lists:
        known = ", ".join(ctx.lists) or "none"
        raise ToolError(f"unknown list_id {list_id}; active list ids: {known}")
    raw_items = args.get("items")
    if isinstance(raw_items, list):
        raw_items = [_pick(i, "name", "quantity") if isinstance(i, dict) else i for i in raw_items]
    bulk = BulkItemsCreate(items=raw_items)
    n = len(bulk.items)
    summary = f"{n} item{'s' if n != 1 else ''} → {ctx.lists[list_id] or 'list'}"
    return bulk.model_dump(mode="json", exclude_none=True), summary, list_id


def _grocery_list(args: dict, ctx: _Context) -> tuple[dict, str, str | None]:
    sl = ShoppingListCreate(**_pick(args, "name"), kind="groceries")
    summary = f"New grocery list · {sl.name}" if sl.name.strip() else "New grocery list"
    return sl.model_dump(mode="json", exclude_none=True), summary, None


def _moves_to(street: str, city: str) -> str:
    return "moves to " + ", ".join(part for part in (street, city) if part)


def _changes(parts: list[str], payload: dict, shown: set[str]) -> str:
    others = [k for k in payload if k not in shown]
    if others:
        parts.append("updates " + ", ".join(others))
    if not parts:
        raise ToolError("nothing to change")
    return " · ".join(parts)


def _address(args: dict, ctx: _Context) -> tuple[dict, str, str | None]:
    move = args.get("move_person_ids") or []
    if not isinstance(move, list):
        raise ToolError("move_person_ids: expected a list of person ids")
    for person_id in move:
        ctx.person(person_id)
    people = args.get("people") or []
    if isinstance(people, list):
        people = [_pick(p, *_PERSON_KEYS) if isinstance(p, dict) else p for p in people]
    a = AddressCreate(**_pick(args, *_ADDRESS_KEYS), people=people, move_people=move)
    for person in a.people:
        ctx.reject_known_name(person.name)
    parts = [part for part in ("New address", a.label, a.city) if part]
    if a.people:
        parts.append("with " + ", ".join(person.name for person in a.people))
    if a.move_people:
        movers = [ctx.person(person_id)[0] for person_id in a.move_people]
        parts.append(", ".join(movers) + (" moves in" if len(movers) == 1 else " move in"))
    return a.model_dump(mode="json", exclude_none=True), " · ".join(parts), None


def _person(args: dict, ctx: _Context) -> tuple[dict, str, str | None]:
    data = _pick(args, *_PERSON_KEYS, "address_id")
    if data.get("address_id"):
        ctx.address(data["address_id"])
    p = PersonCreate(**data)
    ctx.reject_known_name(p.name)
    birthday = f"🎂 {_birth_text(p.birth_month, p.birth_day, p.birth_year)}" if p.birth_month and p.birth_day else ""
    if p.address_id:
        label = ctx.address(p.address_id)[0]
        summary = f"Add {p.name}{f' ({birthday})' if birthday else ''} to {label}"
    else:
        summary = " · ".join(part for part in ("New contact", p.name, birthday) if part)
    return p.model_dump(mode="json", exclude_none=True), summary, None


def _person_update(args: dict, ctx: _Context) -> tuple[dict, str, str | None]:
    person_id = args.get("person_id")
    name, _, birth = ctx.person(person_id)
    data = _pick(args, *_PERSON_KEYS)
    if "address_id" in args:
        data["address_id"] = args["address_id"]  # "" (or null) unlinks; PersonUpdate stores it as None
    payload = PersonUpdate(**data).model_dump(mode="json", exclude_unset=True)

    parts: list[str] = []
    if "address_id" in payload:
        if payload["address_id"] is None:
            parts.append("no longer at an address")
        else:
            label, street, city = ctx.address(payload["address_id"])
            parts.append(_moves_to(street or label, city))
    if any(k in payload for k in _BIRTH_KEYS):
        month, day, year = (payload.get(k, current) for k, current in zip(_BIRTH_KEYS, birth))
        if month is None or day is None:
            raise ToolError("birth_month and birth_day must be set together")
        try:
            validate_birth_date(month, day, year)
        except ValueError as exc:
            raise ToolError(str(exc)) from None
        parts.append(f"🎂 {_birth_text(month, day, year)}")
    changes = _changes(parts, payload, {"address_id", *_BIRTH_KEYS})
    return payload, f"{name}: {changes}", person_id


def _address_update(args: dict, ctx: _Context) -> tuple[dict, str, str | None]:
    address_id = args.get("address_id")
    label, street, city = ctx.address(address_id)
    payload = AddressUpdate(**_pick(args, *_ADDRESS_KEYS)).model_dump(mode="json", exclude_unset=True)
    parts: list[str] = []
    if any(k in payload for k in _LOCATION_KEYS):
        parts.append(_moves_to(payload.get("street", street), payload.get("city", city)))
    return payload, f"{label}: {_changes(parts, payload, set(_LOCATION_KEYS))}", address_id


_HANDLERS = {
    "propose_birthday": ("birthday", _birthday),
    "propose_task": ("task", _task),
    "propose_event": ("event", _event),
    "propose_list_items": ("list_items", _list_items),
    "propose_grocery_list": ("grocery_list", _grocery_list),
    "propose_address": ("address", _address),
    "propose_person": ("person", _person),
    "propose_person_update": ("person_update", _person_update),
    "propose_address_update": ("address_update", _address_update),
}
# The third value a handler returns: the list id for list_items, the target id for updates.
_TARGET_TYPES = {"person_update", "address_update"}


def _make_proposal(tc: ToolCall, ctx: _Context) -> Proposal:
    entry = _HANDLERS.get(tc.name)
    if entry is None:
        raise ToolError(f"unknown tool {tc.name}")
    ptype, handler = entry
    try:
        payload, summary, ref_id = handler(tc.arguments, ctx)
    except ValidationError as exc:
        raise ToolError(_format_errors(exc)) from None
    replaces = tc.arguments.get("replaces")
    replaces = replaces.strip()[:MAX_REPLACES] or None if isinstance(replaces, str) else None
    return Proposal(
        id=uuid.uuid4().hex[:8],
        type=ptype,
        summary=summary,
        payload=payload,
        list_id=None if ptype in _TARGET_TYPES else ref_id,
        target_id=ref_id if ptype in _TARGET_TYPES else None,
        replaces=replaces,
    )


def _has_valid_json_args(tc: ToolCall) -> bool:
    """True when the raw arguments are empty or parse to a JSON object."""
    raw = tc.raw_arguments
    if not raw.strip():
        return True
    try:
        return isinstance(json.loads(raw), dict)
    except ValueError:
        return False


def _replay_arguments(tc: ToolCall) -> str:
    # Replay only valid JSON: some providers reject the whole request otherwise.
    if tc.raw_arguments.strip() and _has_valid_json_args(tc):
        return tc.raw_arguments
    return json.dumps(tc.arguments)


def _assistant_message(result: ChatResult) -> dict:
    return {
        "role": "assistant",
        "content": result.text or None,
        "tool_calls": [
            {
                "id": tc.id,
                "type": "function",
                "function": {"name": tc.name, "arguments": _replay_arguments(tc)},
            }
            for tc in result.tool_calls
        ],
    }


# --------------------------------------------------------------------------
# Entry point
# --------------------------------------------------------------------------


async def _load_contacts(db: AsyncSession, household_id: str) -> tuple[list[PersonRow], list[AddressRow], bool]:
    """People (first ``MAX_CONTACTS`` by name) and addresses, referenced ones first."""
    rows = (await db.execute(
        select(Person.id, Person.name, Person.address_id, Person.birth_month, Person.birth_day, Person.birth_year)
        .where(Person.household_id == household_id)
        .order_by(func.lower(Person.name), Person.id)
        .limit(MAX_CONTACTS + 1)
    )).all()
    truncated = len(rows) > MAX_CONTACTS
    people: list[PersonRow] = [(r.id, r.name, r.address_id, (r.birth_month, r.birth_day, r.birth_year))
                               for r in rows[:MAX_CONTACTS]]
    referenced = {aid for _, _, aid, _ in people if aid}
    address_rows = (await db.execute(
        select(ContactAddress.id, ContactAddress.label, ContactAddress.street, ContactAddress.city)
        .where(ContactAddress.household_id == household_id)
        .order_by(ContactAddress.id.in_(referenced).desc(), func.lower(ContactAddress.label), ContactAddress.id)
        .limit(MAX_CONTACTS)
    )).all()
    addresses: list[AddressRow] = [(r.id, r.label, r.street, r.city) for r in address_rows]
    return people, addresses, truncated


async def run_assistant(
    db: AsyncSession,
    household_id: str,
    user_id: str,
    req: AssistantRequest,
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> AssistantResponse:
    api_key, model = await get_key_and_model(db, household_id)
    tz = resolve_timezone(req.timezone)
    users = await list_household_members(db, household_id, user_id)
    members = [(u.id, member_name(u)) for u in users]
    active = await list_shopping_lists(db, household_id, status="active")
    lists = [(sl["id"], sl["name"], sl["kind"]) for sl in active]
    people, addresses, truncated = await _load_contacts(db, household_id)
    ctx = _Context(members, lists, tz, people, addresses)

    today = datetime.now(_zone(tz)).date()
    contacts = build_contacts_section(people, addresses, truncated)
    messages: list[dict] = [
        {"role": "system", "content": build_system_prompt(today, tz, members, lists, contacts)}
    ]
    messages += [{"role": m.role, "content": m.content} for m in req.messages]

    proposals: list[Proposal] = []
    text = ""
    async with OpenRouterClient(api_key, transport=transport or _transport) as client:
        try:
            async with asyncio.timeout(TURN_TIMEOUT_SECONDS):
                for call_no in range(MAX_CALLS):
                    result = await client.chat(messages, model=model, tools=TOOLS, max_tokens=MAX_TOKENS)
                    text = (result.text or "").strip()
                    if not result.tool_calls:
                        if text or proposals:
                            break
                        continue
                    for i, tc in enumerate(result.tool_calls):
                        if not tc.id:
                            tc.id = f"call_{call_no}_{i}"
                    messages.append(_assistant_message(result))
                    had_error = False
                    for tc in result.tool_calls:
                        try:
                            if not _has_valid_json_args(tc):
                                raise ToolError("arguments were not valid JSON")
                            proposal = _make_proposal(tc, ctx)
                        except ToolError as exc:
                            had_error = True
                            content = f"error: {exc}"
                        else:
                            proposals.append(proposal)
                            content = f"ok: card {proposal.id} shown"
                        messages.append({"role": "tool", "tool_call_id": tc.id, "content": content})
                    if not had_error:
                        break
        except TimeoutError:
            raise HTTPException(504, "The assistant took too long — try again.") from None

    reply = text or (FALLBACK_WITH_PROPOSALS if proposals else FALLBACK_EMPTY)
    return AssistantResponse(
        reply=reply, assistant_content=build_assistant_content(reply, proposals), proposals=proposals
    )


def _clip(text: str, limit: int) -> str:
    return text if len(text) <= limit else text[: limit - 1] + "…"


def build_assistant_content(reply: str, proposals: list[Proposal]) -> str:
    """Reply plus a compact proposals note, always within the per-message limit.

    The client sends this back as an assistant message, so it must pass
    ``ChatMessage`` validation on the next turn.
    """
    if not proposals:
        return _clip(reply, MAX_MESSAGE_CHARS)
    note = "; ".join(f"{p.id} {p.type} {_clip(p.summary, NOTE_SUMMARY_CHARS)}" for p in proposals)
    suffix = f"\n\n[proposals: {_clip(note, MAX_NOTE_CHARS)}]"
    return _clip(reply, MAX_MESSAGE_CHARS - len(suffix)) + suffix
