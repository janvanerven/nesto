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
    recurrence_rule: Literal["daily", "weekly", "monthly", "yearly"] | None = None
    recurrence_interval: int = Field(default=1, ge=1, le=99)
    recurrence_end: date | None = None


class TaskUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=500)
    description: str | None = Field(default=None, max_length=5000)
    status: Literal["pending", "in_progress", "done"] | None = None
    priority: int | None = Field(default=None, ge=1, le=4)
    assigned_to: str | None = None
    due_date: date | None = None
    category: str | None = Field(default=None, max_length=100)
    recurrence_rule: Literal["daily", "weekly", "monthly", "yearly"] | None = None
    recurrence_interval: int | None = Field(default=None, ge=1, le=99)
    recurrence_end: date | None = None


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
    recurrence_rule: str | None
    recurrence_interval: int
    recurrence_end: date | None
    last_completed_at: datetime | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
