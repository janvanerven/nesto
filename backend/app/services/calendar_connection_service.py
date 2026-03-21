import uuid

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.calendar_sync import CalendarConnection, ExternalEvent
from app.schemas.calendar_sync import CalendarConnectionCreate, CalendarConnectionUpdate
from app.services.crypto_service import encrypt_password


_UPDATABLE_FIELDS = {"name", "color", "enabled"}


async def list_connections(
    db: AsyncSession, household_id: str, user_id: str
) -> list[CalendarConnection]:
    result = await db.execute(
        select(CalendarConnection)
        .where(
            CalendarConnection.household_id == household_id,
            CalendarConnection.user_id == user_id,
        )
        .order_by(CalendarConnection.created_at.asc())
    )
    return list(result.scalars().all())


async def create_connection(
    db: AsyncSession, household_id: str, user_id: str, data: CalendarConnectionCreate
) -> CalendarConnection:
    conn = CalendarConnection(
        id=str(uuid.uuid4()),
        household_id=household_id,
        user_id=user_id,
        name=data.name,
        provider=data.provider,
        server_url=data.server_url,
        calendar_url=data.calendar_url,
        username=data.username,
        encrypted_password=encrypt_password(data.password),
        color=data.color,
    )
    db.add(conn)
    await db.commit()
    await db.refresh(conn)
    return conn


async def update_connection(
    db: AsyncSession, connection_id: str, user_id: str, data: CalendarConnectionUpdate
) -> CalendarConnection:
    result = await db.execute(
        select(CalendarConnection).where(
            CalendarConnection.id == connection_id,
            CalendarConnection.user_id == user_id,
        )
    )
    conn = result.scalar_one_or_none()
    if not conn:
        raise HTTPException(status_code=404, detail="Calendar connection not found")

    updates = data.model_dump(exclude_unset=True)

    if "password" in updates:
        conn.encrypted_password = encrypt_password(updates.pop("password"))

    for key, value in updates.items():
        if key in _UPDATABLE_FIELDS:
            setattr(conn, key, value)

    await db.commit()
    await db.refresh(conn)
    return conn


async def delete_connection(db: AsyncSession, connection_id: str, user_id: str) -> None:
    result = await db.execute(
        select(CalendarConnection).where(
            CalendarConnection.id == connection_id,
            CalendarConnection.user_id == user_id,
        )
    )
    conn = result.scalar_one_or_none()
    if not conn:
        raise HTTPException(status_code=404, detail="Calendar connection not found")

    # Delete all external events for this connection
    events_result = await db.execute(
        select(ExternalEvent).where(ExternalEvent.connection_id == connection_id)
    )
    for event in events_result.scalars().all():
        await db.delete(event)

    await db.delete(conn)
    await db.commit()


async def get_connection(db: AsyncSession, connection_id: str) -> CalendarConnection:
    result = await db.execute(
        select(CalendarConnection).where(CalendarConnection.id == connection_id)
    )
    conn = result.scalar_one_or_none()
    if not conn:
        raise HTTPException(status_code=404, detail="Calendar connection not found")
    return conn
