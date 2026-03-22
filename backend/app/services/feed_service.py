import secrets
from datetime import date, datetime, timedelta

from fastapi import HTTPException
from icalendar import Calendar, Event as ICalEvent
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.birthday import Birthday
from app.models.event import Event
from app.models.household import HouseholdMember


RRULE_FREQ_MAP = {
    "daily": "DAILY",
    "weekly": "WEEKLY",
    "monthly": "MONTHLY",
    "yearly": "YEARLY",
}


def _event_to_vevent(event: Event) -> ICalEvent:
    vevent = ICalEvent()
    vevent.add("uid", f"{event.id}@nesto")
    vevent.add("summary", event.title)
    if event.description:
        vevent.add("description", event.description)

    if event.all_day:
        vevent.add("dtstart", event.start_time.date())
        # For all-day events, DTEND is exclusive (day after)
        end_date = event.end_time.date()
        vevent.add("dtend", end_date + timedelta(days=1))
    else:
        vevent.add("dtstart", event.start_time)
        vevent.add("dtend", event.end_time)

    if event.recurrence_rule and event.recurrence_rule in RRULE_FREQ_MAP:
        rrule: dict = {"freq": RRULE_FREQ_MAP[event.recurrence_rule]}
        if event.recurrence_interval > 1:
            rrule["interval"] = event.recurrence_interval
        if event.recurrence_end:
            end = event.recurrence_end
            if isinstance(end, date) and not isinstance(end, datetime):
                rrule["until"] = datetime(end.year, end.month, end.day, 23, 59, 59)
            else:
                rrule["until"] = end
        vevent.add("rrule", rrule)

    return vevent


def _birthday_to_vevent(birthday: Birthday) -> ICalEvent:
    vevent = ICalEvent()
    vevent.add("uid", f"birthday-{birthday.id}@nesto")

    # Summary: include birth year if known (static, doesn't go stale in cached feeds)
    # Don't embed "turns N" — it bakes a specific age into the RRULE'd event summary
    # that becomes wrong in subsequent years when the calendar app caches the feed.
    if birthday.birth_year:
        vevent.add("summary", f"\U0001f382 {birthday.person_name}'s Birthday (born {birthday.birth_year})")
    else:
        vevent.add("summary", f"\U0001f382 {birthday.person_name}'s Birthday")

    # Use 2000 as reference year when birth_year is unknown.
    # MUST be a leap year so Feb 29 birthdays don't raise ValueError.
    # (1900 is NOT a leap year — date(1900, 2, 29) crashes.)
    ref_year = birthday.birth_year or 2000
    start = date(ref_year, birthday.birth_month, birthday.birth_day)
    vevent.add("dtstart", start)
    # DTEND is required by RFC 5545; exclusive, so day after for all-day events
    vevent.add("dtend", start + timedelta(days=1))
    vevent.add("rrule", {"freq": "YEARLY"})

    return vevent


async def generate_feed(db: AsyncSession, user_id: str, household_id: str) -> str:
    result = await db.execute(
        select(Event).where(
            Event.household_id == household_id,
            (Event.assigned_to == user_id) | (Event.assigned_to.is_(None)),
        )
    )
    events = result.scalars().all()

    from app.services.birthday_service import get_birthdays_for_feed
    birthdays = await get_birthdays_for_feed(db, household_id)

    cal = Calendar()
    cal.add("prodid", "-//Nesto//Calendar//EN")
    cal.add("version", "2.0")
    cal.add("x-wr-calname", "Nesto")

    for event in events:
        cal.add_component(_event_to_vevent(event))

    for birthday in birthdays:
        cal.add_component(_birthday_to_vevent(birthday))

    return cal.to_ical().decode()


async def get_or_create_feed_token(db: AsyncSession, user_id: str, household_id: str) -> str:
    result = await db.execute(
        select(HouseholdMember).where(
            HouseholdMember.user_id == user_id,
            HouseholdMember.household_id == household_id,
        )
    )
    member = result.scalar_one_or_none()
    if not member:
        raise HTTPException(status_code=404, detail="Household membership not found")

    if not member.feed_token:
        member.feed_token = secrets.token_urlsafe(48)
        await db.commit()
        await db.refresh(member)

    return member.feed_token


async def regenerate_feed_token(db: AsyncSession, user_id: str, household_id: str) -> str:
    result = await db.execute(
        select(HouseholdMember).where(
            HouseholdMember.user_id == user_id,
            HouseholdMember.household_id == household_id,
        )
    )
    member = result.scalar_one_or_none()
    if not member:
        raise HTTPException(status_code=404, detail="Household membership not found")

    member.feed_token = secrets.token_urlsafe(48)
    await db.commit()
    await db.refresh(member)
    return member.feed_token


async def resolve_feed_token(db: AsyncSession, token: str) -> tuple[str, str] | None:
    """Returns (user_id, household_id) for the given feed token, or None."""
    result = await db.execute(
        select(HouseholdMember).where(HouseholdMember.feed_token == token)
    )
    member = result.scalar_one_or_none()
    if not member:
        return None
    return member.user_id, member.household_id
