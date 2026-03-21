import secrets
from datetime import date, datetime, timedelta

from icalendar import Calendar, Event as ICalEvent

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.event import Event
from app.models.household import HouseholdMember


RRULE_FREQ_MAP = {
    "daily": "DAILY",
    "weekly": "WEEKLY",
    "monthly": "MONTHLY",
    "yearly": "YEARLY",
}


def _event_to_vevent(event) -> ICalEvent:
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


async def generate_feed(db: AsyncSession, user_id: str, household_id: str) -> str:
    result = await db.execute(
        select(Event).where(
            Event.household_id == household_id,
            (Event.assigned_to == user_id) | (Event.assigned_to.is_(None)),
        )
    )
    events = result.scalars().all()

    cal = Calendar()
    cal.add("prodid", "-//Nesto//Calendar//EN")
    cal.add("version", "2.0")
    cal.add("x-wr-calname", "Nesto")

    for event in events:
        cal.add_component(_event_to_vevent(event))

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
        from fastapi import HTTPException
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
        from fastapi import HTTPException
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
