import uuid

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.event import Event
from app.schemas.event import EventCreate, EventUpdate

_UPDATABLE_FIELDS = {
    "title", "description", "start_time", "end_time",
    "assigned_to", "recurrence_rule", "recurrence_interval", "recurrence_end",
}


async def list_events(
    db: AsyncSession,
    household_id: str,
) -> list[Event]:
    query = select(Event).where(
        Event.household_id == household_id,
    ).order_by(Event.start_time.asc())
    result = await db.execute(query)
    return list(result.scalars().all())


async def create_event(db: AsyncSession, household_id: str, user_id: str, data: EventCreate) -> Event:
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
