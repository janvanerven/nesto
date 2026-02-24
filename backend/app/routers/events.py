from datetime import date

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user_id
from app.database import get_db
from app.schemas.event import EventCreate, EventResponse, EventUpdate
from app.services.event_service import create_event, delete_event, list_events, update_event
from app.services.household_service import get_household

router = APIRouter(prefix="/api/households/{household_id}/events", tags=["events"])


@router.get("", response_model=list[EventResponse])
async def get_events(
    household_id: str,
    start: date = Query(...),
    end: date = Query(...),
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    await get_household(db, household_id, user_id)
    return await list_events(db, household_id, start=start, end=end)


@router.post("", response_model=EventResponse, status_code=201)
async def create(
    household_id: str,
    body: EventCreate,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    await get_household(db, household_id, user_id)
    return await create_event(db, household_id, user_id, body)


@router.patch("/{event_id}", response_model=EventResponse)
async def update(
    household_id: str,
    event_id: str,
    body: EventUpdate,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    await get_household(db, household_id, user_id)
    return await update_event(db, event_id, household_id, body)


@router.delete("/{event_id}", status_code=204)
async def delete(
    household_id: str,
    event_id: str,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    await get_household(db, household_id, user_id)
    await delete_event(db, event_id, household_id)
