from datetime import datetime

from pydantic import BaseModel, Field


class NoticeCreate(BaseModel):
    content: str = Field(min_length=1, max_length=500)


class NoticePatch(BaseModel):
    content: str | None = Field(default=None, min_length=1, max_length=500)
    pinned: bool | None = None


class NoticeResponse(BaseModel):
    id: str
    household_id: str
    author_id: str
    content: str
    pinned: bool
    created_at: datetime
    updated_at: datetime | None

    model_config = {"from_attributes": True}
