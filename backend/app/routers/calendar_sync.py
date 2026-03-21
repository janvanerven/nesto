from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user_id
from app.database import get_db
from app.schemas.calendar_sync import (
    CalendarConnectionCreate,
    CalendarConnectionResponse,
    CalendarConnectionUpdate,
    ExternalEventResponse,
    FeedTokenResponse,
)
from app.services.calendar_connection_service import (
    create_connection,
    delete_connection,
    get_connection,
    list_connections,
    update_connection,
)
from app.services.calendar_sync_service import sync_connection, validate_caldav_credentials
from app.services.external_event_service import list_external_events
from app.services.feed_service import (
    generate_feed,
    get_or_create_feed_token,
    regenerate_feed_token,
    resolve_feed_token,
)
from app.services.household_service import get_household, list_user_households

# --- Connection management (OIDC-authenticated) ---

connections_router = APIRouter(prefix="/api/calendar/connections", tags=["calendar-sync"])


@connections_router.get("", response_model=list[CalendarConnectionResponse])
async def get_connections(
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    households = await list_user_households(db, user_id)
    if not households:
        return []
    return await list_connections(db, households[0].id, user_id)


@connections_router.post("", response_model=CalendarConnectionResponse, status_code=201)
async def create(
    body: CalendarConnectionCreate,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    households = await list_user_households(db, user_id)
    if not households:
        raise HTTPException(status_code=400, detail="No household found")

    # Validate credentials first
    valid = await validate_caldav_credentials(
        body.server_url, body.calendar_url, body.username, body.password
    )
    if not valid:
        raise HTTPException(status_code=400, detail="Could not connect to CalDAV server — check URL and credentials")

    conn = await create_connection(db, households[0].id, user_id, body)

    # Trigger initial sync
    try:
        await sync_connection(db, conn)
    except Exception:
        pass  # Non-fatal — sync will retry in background

    return conn


@connections_router.patch("/{connection_id}", response_model=CalendarConnectionResponse)
async def update(
    connection_id: str,
    body: CalendarConnectionUpdate,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    return await update_connection(db, connection_id, user_id, body)


@connections_router.delete("/{connection_id}", status_code=204)
async def delete(
    connection_id: str,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    await delete_connection(db, connection_id, user_id)


@connections_router.post("/{connection_id}/sync", response_model=CalendarConnectionResponse)
async def trigger_sync(
    connection_id: str,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    conn = await get_connection(db, connection_id)
    if conn.user_id != user_id:
        raise HTTPException(status_code=404, detail="Calendar connection not found")
    await sync_connection(db, conn)
    await db.refresh(conn)
    return conn


# --- External events (OIDC-authenticated) ---

external_events_router = APIRouter(prefix="/api/households/{household_id}/external-events", tags=["calendar-sync"])


@external_events_router.get("", response_model=list[ExternalEventResponse])
async def get_external_events(
    household_id: str,
    start: date = Query(...),
    end: date = Query(...),
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    await get_household(db, household_id, user_id)
    return await list_external_events(db, household_id, user_id, start, end)


# --- Feed token management (OIDC-authenticated) ---

feed_token_router = APIRouter(prefix="/api/calendar/feed-token", tags=["calendar-sync"])


@feed_token_router.get("", response_model=FeedTokenResponse)
async def get_feed_token(
    request: Request,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    households = await list_user_households(db, user_id)
    if not households:
        raise HTTPException(status_code=400, detail="No household found")

    token = await get_or_create_feed_token(db, user_id, households[0].id)
    base_url = str(request.base_url).rstrip("/")
    return FeedTokenResponse(token=token, url=f"{base_url}/api/calendar/feed/{token}.ics")


@feed_token_router.post("/regenerate", response_model=FeedTokenResponse)
async def regenerate_token(
    request: Request,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    households = await list_user_households(db, user_id)
    if not households:
        raise HTTPException(status_code=400, detail="No household found")

    token = await regenerate_feed_token(db, user_id, households[0].id)
    base_url = str(request.base_url).rstrip("/")
    return FeedTokenResponse(token=token, url=f"{base_url}/api/calendar/feed/{token}.ics")


# --- .ics feed (token-authenticated, no OIDC) ---

feed_router = APIRouter(tags=["calendar-feed"])


@feed_router.get("/api/calendar/feed/{token}.ics")
async def get_feed(
    token: str,
    db: AsyncSession = Depends(get_db),
):
    result = await resolve_feed_token(db, token)
    if not result:
        raise HTTPException(status_code=404, detail="Feed not found")

    user_id, household_id = result
    ical_data = await generate_feed(db, user_id, household_id)

    return Response(
        content=ical_data,
        media_type="text/calendar",
        headers={
            "Content-Disposition": "attachment; filename=nesto.ics",
            "Cache-Control": "no-cache, no-store, must-revalidate",
        },
    )
