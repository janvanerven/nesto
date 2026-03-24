import uuid
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.household import Household
from app.models.notice import HouseholdNotice
from app.schemas.notice import NoticeCreate, NoticePatch, NoticeResponse


async def list_notices(
    db: AsyncSession, household_id: str, limit: int = 20, offset: int = 0
) -> list[NoticeResponse]:
    result = await db.execute(
        select(HouseholdNotice)
        .where(HouseholdNotice.household_id == household_id)
        .order_by(HouseholdNotice.pinned.desc(), HouseholdNotice.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    notices = result.scalars().all()
    return [NoticeResponse.model_validate(n) for n in notices]


async def create_notice(
    db: AsyncSession, household_id: str, author_id: str, body: NoticeCreate
) -> NoticeResponse:
    notice = HouseholdNotice(
        id=str(uuid.uuid4()),
        household_id=household_id,
        author_id=author_id,
        content=body.content.strip(),
    )
    db.add(notice)
    await db.commit()
    await db.refresh(notice)
    return NoticeResponse.model_validate(notice)


async def patch_notice(
    db: AsyncSession,
    notice_id: str,
    household_id: str,
    user_id: str,
    body: NoticePatch,
) -> NoticeResponse:
    result = await db.execute(
        select(HouseholdNotice).where(
            HouseholdNotice.id == notice_id,
            HouseholdNotice.household_id == household_id,
        )
    )
    notice = result.scalar_one_or_none()
    if not notice:
        raise HTTPException(status_code=404, detail="Notice not found")

    # Content edits are author-only
    if body.content is not None:
        if notice.author_id != user_id:
            raise HTTPException(status_code=403, detail="Only the author can edit content")
        notice.content = body.content.strip()
        notice.updated_at = datetime.now(timezone.utc).replace(tzinfo=None)

    # Any member can pin/unpin
    if body.pinned is not None:
        notice.pinned = body.pinned

    await db.commit()
    await db.refresh(notice)
    return NoticeResponse.model_validate(notice)


async def delete_notice(
    db: AsyncSession, notice_id: str, household_id: str, user_id: str
) -> None:
    result = await db.execute(
        select(HouseholdNotice).where(
            HouseholdNotice.id == notice_id,
            HouseholdNotice.household_id == household_id,
        )
    )
    notice = result.scalar_one_or_none()
    if not notice:
        raise HTTPException(status_code=404, detail="Notice not found")

    # Check if user is author or household admin (household.created_by)
    household_result = await db.execute(
        select(Household).where(Household.id == household_id)
    )
    household = household_result.scalar_one_or_none()
    is_admin = household and household.created_by == user_id

    if notice.author_id != user_id and not is_admin:
        raise HTTPException(status_code=403, detail="Only the author or household admin can delete this notice")

    await db.delete(notice)
    await db.commit()
