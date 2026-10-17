# backend/app/schemas/shopping_list.py
from datetime import datetime
from typing import Literal
from urllib.parse import urlsplit

from pydantic import BaseModel, Field, field_validator


ListKind = Literal["groceries", "wishlist", "packing", "other"]


# --- Shopping List schemas ---

class ShoppingListCreate(BaseModel):
    name: str = Field(default="", max_length=200)
    priority: int = Field(default=3, ge=1, le=4)
    kind: ListKind = "other"


class ShoppingListUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=200)
    priority: int | None = Field(default=None, ge=1, le=4)
    status: Literal["active", "archived"] | None = None
    kind: ListKind | None = None


class ShoppingListResponse(BaseModel):
    id: str
    household_id: str
    name: str
    priority: int
    status: str
    kind: str
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
    added_by: str | None
    position: int
    recipe_id: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


# --- Bulk items and recipes ---

class RecipeRef(BaseModel):
    url: str = Field(min_length=1, max_length=2000)
    title: str = Field(min_length=1, max_length=300)

    @field_validator("url")
    @classmethod
    def _http_url_only(cls, v: str) -> str:
        try:
            parts = urlsplit(v)
            host = parts.hostname
        except ValueError as exc:
            raise ValueError("Invalid URL") from exc
        if parts.scheme not in ("http", "https") or not host:
            raise ValueError("URL must be http or https with a host")
        return v


class BulkItemsCreate(BaseModel):
    items: list[ShoppingItemCreate] = Field(min_length=1, max_length=100)
    recipe: RecipeRef | None = None


class RecipeResponse(BaseModel):
    id: str
    list_id: str
    url: str
    title: str
    created_by: str
    created_at: datetime

    model_config = {"from_attributes": True}
