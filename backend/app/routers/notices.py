from fastapi import APIRouter, BackgroundTasks, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user_id
from app.database import get_db
from app.schemas.notice import NoticeCreate, NoticePatch, NoticeResponse
from app.services.household_service import get_household
from app.services import notice_service as svc
from app.services.push_service import notify_household_new_notice

router = APIRouter(prefix="/api/households/{household_id}/notices", tags=["notices"])


@router.get("", response_model=list[NoticeResponse])
async def list_notices(
    household_id: str,
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    await get_household(db, household_id, user_id)
    return await svc.list_notices(db, household_id, limit=limit, offset=offset)


@router.post("", response_model=NoticeResponse, status_code=201)
async def create_notice(
    household_id: str,
    body: NoticeCreate,
    background_tasks: BackgroundTasks,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    await get_household(db, household_id, user_id)
    notice = await svc.create_notice(db, household_id, user_id, body)
    background_tasks.add_task(notify_household_new_notice, household_id, user_id, notice.content)
    return notice


@router.patch("/{notice_id}", response_model=NoticeResponse)
async def patch_notice(
    household_id: str,
    notice_id: str,
    body: NoticePatch,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    await get_household(db, household_id, user_id)
    return await svc.patch_notice(db, notice_id, household_id, user_id, body)


@router.delete("/{notice_id}", status_code=204)
async def delete_notice(
    household_id: str,
    notice_id: str,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    await get_household(db, household_id, user_id)
    await svc.delete_notice(db, notice_id, household_id, user_id)
