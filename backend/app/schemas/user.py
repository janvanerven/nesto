from datetime import datetime

from pydantic import BaseModel, Field, field_validator


class UserResponse(BaseModel):
    id: str
    email: str
    display_name: str
    first_name: str | None
    avatar_url: str | None
    email_digest_daily: bool
    email_digest_weekly: bool
    created_at: datetime
    last_login: datetime

    model_config = {"from_attributes": True}


class UserUpdate(BaseModel):
    first_name: str | None = Field(default=None, min_length=1, max_length=50)
    avatar_url: str | None = None
    email_digest_daily: bool | None = None
    email_digest_weekly: bool | None = None

    @field_validator("avatar_url")
    @classmethod
    def validate_avatar_size(cls, v: str | None) -> str | None:
        if v is not None and len(v) > 500_000:
            raise ValueError("avatar_url must be under 500KB")
        return v
