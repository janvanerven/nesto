import uuid

from sqlalchemy import delete as sa_delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.sekura import SekuraConnection
from app.services.crypto_service import decrypt_password, encrypt_password


async def get_sekura_connection(
    db: AsyncSession, user_id: str
) -> SekuraConnection | None:
    result = await db.execute(
        select(SekuraConnection).where(SekuraConnection.user_id == user_id)
    )
    return result.scalar_one_or_none()


async def save_sekura_connection(
    db: AsyncSession, user_id: str, api_key: str, key_scope: str
) -> SekuraConnection:
    """Create or update the Sekura connection for a user."""
    encrypted = encrypt_password(api_key)
    existing = await get_sekura_connection(db, user_id)
    if existing:
        existing.encrypted_api_key = encrypted
        existing.key_scope = key_scope
    else:
        existing = SekuraConnection(
            id=str(uuid.uuid4()),
            user_id=user_id,
            encrypted_api_key=encrypted,
            key_scope=key_scope,
        )
        db.add(existing)
    await db.commit()
    await db.refresh(existing)
    return existing


async def delete_sekura_connection(db: AsyncSession, user_id: str) -> None:
    await db.execute(
        sa_delete(SekuraConnection).where(SekuraConnection.user_id == user_id)
    )
    await db.commit()


async def get_decrypted_api_key(
    db: AsyncSession, user_id: str
) -> str | None:
    conn = await get_sekura_connection(db, user_id)
    if conn is None:
        return None
    return decrypt_password(conn.encrypted_api_key)
