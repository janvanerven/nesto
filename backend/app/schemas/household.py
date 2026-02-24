from datetime import datetime

from pydantic import BaseModel, Field


class HouseholdCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)


class HouseholdResponse(BaseModel):
    id: str
    name: str
    created_at: datetime
    created_by: str

    model_config = {"from_attributes": True}


class InviteResponse(BaseModel):
    code: str
    expires_at: datetime


class JoinRequest(BaseModel):
    code: str = Field(min_length=1, max_length=100)
