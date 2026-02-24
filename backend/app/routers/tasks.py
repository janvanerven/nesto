from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user_id
from app.database import get_db
from app.schemas.task import TaskCreate, TaskResponse, TaskUpdate
from app.services.household_service import get_household
from app.services.task_service import create_task, delete_task, list_tasks, update_task

router = APIRouter(prefix="/api/households/{household_id}/tasks", tags=["tasks"])


@router.get("", response_model=list[TaskResponse])
async def get_tasks(
    household_id: str,
    status: str | None = Query(None),
    priority: int | None = Query(None),
    assigned_to: str | None = Query(None),
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    await get_household(db, household_id, user_id)
    return await list_tasks(db, household_id, status=status, priority=priority, assigned_to=assigned_to)


@router.post("", response_model=TaskResponse, status_code=201)
async def create(
    household_id: str,
    body: TaskCreate,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    await get_household(db, household_id, user_id)
    return await create_task(db, household_id, user_id, **body.model_dump())


@router.patch("/{task_id}", response_model=TaskResponse)
async def update(
    household_id: str,
    task_id: str,
    body: TaskUpdate,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    await get_household(db, household_id, user_id)
    return await update_task(db, task_id, household_id, **body.model_dump(exclude_unset=True))


@router.delete("/{task_id}", status_code=204)
async def delete(
    household_id: str,
    task_id: str,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    await get_household(db, household_id, user_id)
    await delete_task(db, task_id, household_id)
