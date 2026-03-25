from datetime import datetime

from pydantic import BaseModel, field_validator


class CommentCreate(BaseModel):
    content: str
    mentions: list[str] = []

    @field_validator("content")
    @classmethod
    def content_not_empty(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("content cannot be empty")
        return v


class CommentResponse(BaseModel):
    id: str
    entity_type: str
    entity_id: str
    author_id: str
    author_name: str
    content: str
    created_at: datetime

    model_config = {"from_attributes": True}
