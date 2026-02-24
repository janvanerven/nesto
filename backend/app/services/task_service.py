import uuid
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.task import Task
from app.schemas.task import TaskCreate, TaskUpdate

_UPDATABLE_FIELDS = {"title", "description", "status", "priority", "assigned_to", "due_date", "category"}


async def list_tasks(
    db: AsyncSession,
    household_id: str,
    status: str | None = None,
    priority: int | None = None,
    assigned_to: str | None = None,
    limit: int = 100,
    offset: int = 0,
) -> list[Task]:
    query = select(Task).where(Task.household_id == household_id)
    if status:
        query = query.where(Task.status == status)
    if priority:
        query = query.where(Task.priority == priority)
    if assigned_to:
        query = query.where(Task.assigned_to == assigned_to)
    query = query.order_by(Task.priority.asc(), Task.created_at.desc())
    query = query.limit(limit).offset(offset)
    result = await db.execute(query)
    return list(result.scalars().all())


async def create_task(db: AsyncSession, household_id: str, user_id: str, data: TaskCreate) -> Task:
    task = Task(
        id=str(uuid.uuid4()),
        household_id=household_id,
        created_by=user_id,
        **data.model_dump(),
    )
    db.add(task)
    await db.commit()
    await db.refresh(task)
    return task


async def update_task(db: AsyncSession, task_id: str, household_id: str, data: TaskUpdate) -> Task:
    result = await db.execute(
        select(Task).where(Task.id == task_id, Task.household_id == household_id)
    )
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    updates = data.model_dump(exclude_unset=True)
    for key, value in updates.items():
        if key in _UPDATABLE_FIELDS:
            setattr(task, key, value)

    # Auto-set completed_at
    if updates.get("status") == "done" and not task.completed_at:
        task.completed_at = datetime.now(timezone.utc)
    elif updates.get("status") and updates["status"] != "done":
        task.completed_at = None

    await db.commit()
    await db.refresh(task)
    return task


async def delete_task(db: AsyncSession, task_id: str, household_id: str) -> None:
    result = await db.execute(
        select(Task).where(Task.id == task_id, Task.household_id == household_id)
    )
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    await db.delete(task)
    await db.commit()
