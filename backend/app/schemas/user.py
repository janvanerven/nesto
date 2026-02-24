from datetime import datetime

from pydantic import BaseModel


class UserResponse(BaseModel):
    id: str
    email: str
    display_name: str
    avatar_url: str | None
    created_at: datetime
    last_login: datetime

    model_config = {"from_attributes": True}
