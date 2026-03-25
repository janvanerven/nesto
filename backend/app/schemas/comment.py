from datetime import datetime

from pydantic import BaseModel, Field


class CommentCreate(BaseModel):
    content: str = Field(min_length=1, max_length=2000)
    mentions: list[str] = Field(default_factory=list)


class CommentResponse(BaseModel):
    id: str
    entity_type: str
    entity_id: str
    author_id: str
    author_name: str
    content: str
    created_at: datetime

    model_config = {"from_attributes": True}
