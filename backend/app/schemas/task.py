from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field


class TaskCreate(BaseModel):
    title: str = Field(min_length=1, max_length=500)
    description: str | None = Field(default=None, max_length=5000)
    priority: int = Field(default=3, ge=1, le=4)
    assigned_to: str | None = None
    due_date: date | None = None
    category: str | None = Field(default=None, max_length=100)


class TaskUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=500)
    description: str | None = Field(default=None, max_length=5000)
    status: Literal["pending", "in_progress", "done"] | None = None
    priority: int | None = Field(default=None, ge=1, le=4)
    assigned_to: str | None = None
    due_date: date | None = None
    category: str | None = Field(default=None, max_length=100)


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
