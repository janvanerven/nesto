from datetime import datetime, timedelta, timezone

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User
from app.schemas.user import UserUpdate

_UPDATABLE_FIELDS = {"first_name", "avatar_url", "email_digest_daily", "email_digest_weekly"}

# Cap last_login writes to once per hour to avoid a DB write on every request.
_LAST_LOGIN_THROTTLE = timedelta(hours=1)


async def upsert_user(db: AsyncSession, sub: str, email: str, name: str, avatar: str | None = None) -> User:
    result = await db.execute(select(User).where(User.id == sub))
    user = result.scalar_one_or_none()

    if user:
        now = datetime.now(timezone.utc)
        dirty = False

        if user.email != email:
            user.email = email
            dirty = True
        if user.display_name != name:
            user.display_name = name
            dirty = True
        if avatar and not user.avatar_url:
            user.avatar_url = avatar
            dirty = True

        # Throttle last_login to at most once per hour
        last_login_naive = user.last_login
        if last_login_naive is not None:
            # DB stores naive UTC; make it timezone-aware for comparison
            last_login_aware = last_login_naive.replace(tzinfo=timezone.utc)
        else:
            last_login_aware = None

        if last_login_aware is None or (now - last_login_aware) >= _LAST_LOGIN_THROTTLE:
            user.last_login = now
            dirty = True

        if not dirty:
            return user
    else:
        user = User(
            id=sub,
            email=email,
            display_name=name,
            avatar_url=avatar,
        )
        db.add(user)

    try:
        await db.commit()
        await db.refresh(user)
    except IntegrityError:
        await db.rollback()
        # Another request created the user first — re-query and return it
        result = await db.execute(select(User).where(User.id == sub))
        user = result.scalar_one()
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
