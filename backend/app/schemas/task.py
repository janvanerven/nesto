from datetime import date, datetime

from pydantic import BaseModel, Field


class TaskCreate(BaseModel):
    title: str
    description: str | None = None
    priority: int = Field(default=3, ge=1, le=4)
    assigned_to: str | None = None
    due_date: date | None = None
    category: str | None = None


class TaskUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    status: str | None = None
    priority: int | None = Field(default=None, ge=1, le=4)
    assigned_to: str | None = None
    due_date: date | None = None
    category: str | None = None


class TaskResponse(BaseModel):
    id: str
    household_id: str
    title: str
    description: str | None
    status: str
    priority: int
    assigned_to: str | None
    created_by: str
    due_date: date | None
    completed_at: datetime | None
    category: str | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
