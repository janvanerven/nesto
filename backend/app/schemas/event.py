from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field, model_validator


class EventCreate(BaseModel):
    title: str = Field(min_length=1, max_length=500)
    description: str | None = Field(default=None, max_length=5000)
    start_time: datetime
    end_time: datetime
    assigned_to: str | None = None
    recurrence_rule: Literal["daily", "weekly", "monthly", "yearly"] | None = None
    recurrence_interval: int = Field(default=1, ge=1, le=365)
    recurrence_end: date | None = None

    @model_validator(mode="after")
    def validate_times(self):
        if self.end_time <= self.start_time:
            raise ValueError("end_time must be after start_time")
        return self


class EventUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=500)
    description: str | None = Field(default=None, max_length=5000)
    start_time: datetime | None = None
    end_time: datetime | None = None
    assigned_to: str | None = None
    recurrence_rule: Literal["daily", "weekly", "monthly", "yearly"] | None = None
    recurrence_interval: int | None = Field(default=None, ge=1, le=365)
    recurrence_end: date | None = None

    @model_validator(mode="after")
    def validate_times(self):
        if self.start_time and self.end_time and self.end_time <= self.start_time:
            raise ValueError("end_time must be after start_time")
        return self


class EventResponse(BaseModel):
    id: str
    household_id: str
    title: str
    description: str | None
    start_time: datetime
    end_time: datetime
    assigned_to: str | None
    created_by: str
    recurrence_rule: str | None
    recurrence_interval: int
    recurrence_end: date | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
