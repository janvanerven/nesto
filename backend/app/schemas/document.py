from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class DocumentTagCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100, pattern=r"^[^\x00-\x1f\x7f]+$")
    category: Literal["type", "subject"]


class DocumentTagResponse(BaseModel):
    id: str
    household_id: str
    name: str
    category: str

    model_config = {"from_attributes": True}


class DocumentResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: str
    household_id: str
    uploaded_by: str
    filename: str
    mime_type: str
    size_bytes: int
    has_thumbnail: bool
    created_at: datetime
    tags: list[DocumentTagResponse] = []


class DocumentUpdate(BaseModel):
    filename: str | None = Field(default=None, min_length=1, max_length=500)
    tag_ids: list[str] | None = None
