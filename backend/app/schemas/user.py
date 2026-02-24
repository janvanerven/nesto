from datetime import datetime

from pydantic import BaseModel, Field


class UserResponse(BaseModel):
    id: str
    email: str
    display_name: str
    first_name: str | None
    avatar_url: str | None
    created_at: datetime
    last_login: datetime

    model_config = {"from_attributes": True}


class UserUpdate(BaseModel):
    first_name: str = Field(min_length=1, max_length=50)
