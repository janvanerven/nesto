# backend/app/schemas/shopping_list.py
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


# --- Shopping List schemas ---

class ShoppingListCreate(BaseModel):
    name: str = Field(default="", max_length=200)
    priority: int = Field(default=3, ge=1, le=4)


class ShoppingListUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=200)
    priority: int | None = Field(default=None, ge=1, le=4)
    status: Literal["active", "archived"] | None = None


class ShoppingListResponse(BaseModel):
    id: str
    household_id: str
    name: str
    priority: int
    status: str
    created_by: str
    created_at: datetime
    updated_at: datetime
    item_count: int = 0
    checked_count: int = 0

    model_config = {"from_attributes": True}


# --- Shopping Item schemas ---

class ShoppingItemCreate(BaseModel):
    name: str = Field(min_length=1, max_length=500)
    quantity: str = Field(default="", max_length=100)


class ShoppingItemUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=500)
    quantity: str | None = Field(default=None, max_length=100)
    checked: bool | None = None


class ShoppingItemResponse(BaseModel):
    id: str
    list_id: str
    name: str
    quantity: str
    checked: bool
    position: int
    created_at: datetime

    model_config = {"from_attributes": True}
