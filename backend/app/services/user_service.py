from datetime import datetime

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User
from app.schemas.user import UserUpdate

_UPDATABLE_FIELDS = {"first_name", "avatar_url", "email_digest_daily", "email_digest_weekly"}


async def upsert_user(db: AsyncSession, sub: str, email: str, name: str, avatar: str | None = None) -> User:
    result = await db.execute(select(User).where(User.id == sub))
    user = result.scalar_one_or_none()

    if user:
        user.email = email
        user.display_name = name
        if not user.avatar_url:
            user.avatar_url = avatar
        user.last_login = datetime.utcnow()
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


async def update_user(db: AsyncSession, user_id: str, data: UserUpdate) -> User:
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    for field, value in data.model_dump(exclude_unset=True).items():
        if field in _UPDATABLE_FIELDS:
            setattr(user, field, value)
    await db.commit()
    await db.refresh(user)
    return user
