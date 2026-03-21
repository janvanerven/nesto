from datetime import date, datetime, time

from dateutil.rrule import rrulestr
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.calendar_sync import CalendarConnection, ExternalEvent


async def list_external_events(
    db: AsyncSession,
    household_id: str,
    user_id: str,
    start: date,
    end: date,
) -> list[dict]:
    """Return pre-expanded external event occurrences for a date range."""
    # Get connections for this user in this household
    conn_result = await db.execute(
        select(CalendarConnection).where(
            CalendarConnection.household_id == household_id,
            CalendarConnection.user_id == user_id,
            CalendarConnection.enabled == True,
        )
    )
    connections = {c.id: c for c in conn_result.scalars().all()}

    if not connections:
        return []

    # Get all external events for these connections
    event_result = await db.execute(
        select(ExternalEvent).where(
            ExternalEvent.connection_id.in_(list(connections.keys()))
        )
    )
    events = event_result.scalars().all()

    range_start = datetime.combine(start, time.min)
    range_end = datetime.combine(end, time.max)

    occurrences = []

    for event in events:
        conn = connections.get(event.connection_id)
        if not conn:
            continue

        source_info = {
            "source_calendar_name": conn.name,
            "source_calendar_color": conn.color,
            "provider": conn.provider,
        }

        if not event.recurrence_rule:
            # Non-recurring: include if overlaps range
            if event.end_time >= range_start and event.start_time <= range_end:
                occurrences.append(_event_to_dict(event, event.start_time, event.end_time, source_info))
        else:
            # Recurring: expand using dateutil
            expanded = _expand_rrule(event, range_start, range_end)
            for occ_start, occ_end in expanded:
                occurrences.append(_event_to_dict(event, occ_start, occ_end, source_info))

    occurrences.sort(key=lambda o: o["start_time"])
    return occurrences


def _event_to_dict(event: ExternalEvent, start: datetime, end: datetime, source_info: dict) -> dict:
    return {
        "id": f"{event.id}-{start.isoformat()}",
        "connection_id": event.connection_id,
        "title": event.title,
        "description": event.description,
        "start_time": start,
        "end_time": end,
        "all_day": event.all_day,
        "location": event.location,
        **source_info,
    }


def _expand_rrule(event: ExternalEvent, range_start: datetime, range_end: datetime) -> list[tuple[datetime, datetime]]:
    """Expand an RRULE string into concrete occurrences within a date range."""
    try:
        duration = event.end_time - event.start_time
        rule = rrulestr(event.recurrence_rule, dtstart=event.start_time)

        occurrences = []
        for dt in rule.between(range_start, range_end, inc=True):
            # Cap at 200 occurrences per event per query
            if len(occurrences) >= 200:
                break
            occurrences.append((dt, dt + duration))

        return occurrences
    except Exception:
        # If RRULE parsing fails, just return the base event if in range
        if event.end_time >= range_start and event.start_time <= range_end:
            return [(event.start_time, event.end_time)]
        return []
