from datetime import datetime

from pydantic import BaseModel


class HouseholdCreate(BaseModel):
    name: str


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
    code: str
