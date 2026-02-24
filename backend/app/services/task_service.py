import uuid
from datetime import date, datetime, timezone
from dateutil.relativedelta import relativedelta

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.task import Task
from app.schemas.task import TaskCreate, TaskUpdate

_UPDATABLE_FIELDS = {
    "title", "description", "status", "priority", "assigned_to", "due_date",
    "category", "recurrence_rule", "recurrence_interval", "recurrence_end",
}


def _advance_due_date(current_due: date, rule: str, interval: int) -> date:
    if rule == "daily":
        return current_due + relativedelta(days=interval)
    if rule == "weekly":
        return current_due + relativedelta(weeks=interval)
    if rule == "monthly":
        return current_due + relativedelta(months=interval)
    if rule == "yearly":
        return current_due + relativedelta(years=interval)
    return current_due


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

    # Handle completion with recurrence auto-regeneration
    if updates.get("status") == "done":
        if task.recurrence_rule and task.due_date:
            next_due = _advance_due_date(task.due_date, task.recurrence_rule, task.recurrence_interval)
            # If recurrence_end is set and next date exceeds it, complete normally
            if task.recurrence_end and next_due > task.recurrence_end:
                task.completed_at = datetime.now(timezone.utc)
            else:
                # Advance due date and reset to pending
                task.due_date = next_due
                task.last_completed_at = datetime.now(timezone.utc)
                task.status = "pending"
                task.completed_at = None
        elif not task.completed_at:
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
