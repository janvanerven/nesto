import uuid

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.event import Event
from app.models.household import HouseholdMember
from app.schemas.event import EventCreate, EventUpdate


async def _verify_household_member(db: AsyncSession, household_id: str, user_id: str) -> None:
    result = await db.execute(
        select(HouseholdMember).where(
            HouseholdMember.household_id == household_id,
            HouseholdMember.user_id == user_id,
        )
    )
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Assigned user is not a member of this household")

_UPDATABLE_FIELDS = {
    "title", "description", "start_time", "end_time", "all_day",
    "assigned_to", "recurrence_rule", "recurrence_interval", "recurrence_end",
}


async def list_events(
    db: AsyncSession,
    household_id: str,
    start: "date | None" = None,
    end: "date | None" = None,
) -> list[Event]:
    from datetime import datetime, time
    query = select(Event).where(
        Event.household_id == household_id,
    )
    if start and end:
        range_start = datetime.combine(start, time.min)
        range_end = datetime.combine(end, time.max)
        # Include events that overlap the range OR have recurrence (need client expansion)
        query = query.where(
            (Event.recurrence_rule.isnot(None)) | (
                (Event.end_time >= range_start) & (Event.start_time <= range_end)
            )
        )
    query = query.order_by(Event.start_time.asc())
    result = await db.execute(query)
    return list(result.scalars().all())


async def create_event(db: AsyncSession, household_id: str, user_id: str, data: EventCreate) -> Event:
    if data.assigned_to:
        await _verify_household_member(db, household_id, data.assigned_to)

    event = Event(
        id=str(uuid.uuid4()),
        household_id=household_id,
        created_by=user_id,
        **data.model_dump(),
    )
    db.add(event)
    await db.commit()
    await db.refresh(event)
    return event


async def update_event(db: AsyncSession, event_id: str, household_id: str, data: EventUpdate) -> Event:
    result = await db.execute(
        select(Event).where(Event.id == event_id, Event.household_id == household_id)
    )
    event = result.scalar_one_or_none()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    updates = data.model_dump(exclude_unset=True)

    if updates.get("assigned_to") is not None:
        await _verify_household_member(db, household_id, updates["assigned_to"])

    for key, value in updates.items():
        if key in _UPDATABLE_FIELDS:
            setattr(event, key, value)

    await db.commit()
    await db.refresh(event)
    return event


async def delete_event(db: AsyncSession, event_id: str, household_id: str) -> None:
    result = await db.execute(
        select(Event).where(Event.id == event_id, Event.household_id == household_id)
    )
    event = result.scalar_one_or_none()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    await db.delete(event)
    await db.commit()
