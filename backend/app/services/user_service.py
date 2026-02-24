from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User


async def upsert_user(db: AsyncSession, sub: str, email: str, name: str, avatar: str | None = None) -> User:
    result = await db.execute(select(User).where(User.id == sub))
    user = result.scalar_one_or_none()

    if user:
        user.email = email
        user.display_name = name
        user.avatar_url = avatar
        user.last_login = datetime.now(timezone.utc)
    else:
        user = User(
            id=sub,
            email=email,
            display_name=name,
            avatar_url=avatar,
        )
        db.add(user)

    await db.commit()
    await db.refresh(user)
    return user


async def get_user(db: AsyncSession, user_id: str) -> User | None:
    result = await db.execute(select(User).where(User.id == user_id))
    return result.scalar_one_or_none()
