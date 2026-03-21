from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator


class CalendarConnectionCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    provider: Literal["icloud", "nextcloud", "caldav"] = "caldav"
    server_url: str = Field(min_length=1, max_length=2000)
    calendar_url: str = Field(min_length=1, max_length=2000)
    username: str = Field(min_length=1, max_length=500)
    password: str = Field(min_length=1, max_length=500)
    color: str = Field(default="#6C5CE7", max_length=7)

    @field_validator("server_url", "calendar_url")
    @classmethod
    def validate_https(cls, v: str) -> str:
        if not v.startswith("https://"):
            raise ValueError("URL must use HTTPS")
        return v

    @field_validator("color")
    @classmethod
    def validate_color(cls, v: str) -> str:
        if not v.startswith("#") or len(v) != 7:
            raise ValueError("Color must be a hex color like #6C5CE7")
        return v


class CalendarConnectionUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    color: str | None = Field(default=None, max_length=7)
    enabled: bool | None = None
    password: str | None = Field(default=None, min_length=1, max_length=500)

    @field_validator("color")
    @classmethod
    def validate_color(cls, v: str | None) -> str | None:
        if v is not None and (not v.startswith("#") or len(v) != 7):
            raise ValueError("Color must be a hex color like #6C5CE7")
        return v


class CalendarConnectionResponse(BaseModel):
    id: str
    user_id: str
    household_id: str
    name: str
    provider: str
    server_url: str
    calendar_url: str
    username: str
    color: str
    sync_token: str | None
    last_synced_at: datetime | None
    enabled: bool
    error_count: int
    last_error: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


class ExternalEventResponse(BaseModel):
    id: str
    connection_id: str
    title: str
    description: str | None
    start_time: datetime
    end_time: datetime
    all_day: bool
    location: str | None
    source_calendar_name: str
    source_calendar_color: str
    provider: str

    model_config = {"from_attributes": True}


class FeedTokenResponse(BaseModel):
    token: str
    url: str
