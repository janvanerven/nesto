from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


BarcodeFormat = Literal["code128", "ean13", "qr", "code39"]


class LoyaltyCardCreate(BaseModel):
    store_name: str = Field(min_length=1, max_length=200)
    barcode_number: str = Field(min_length=1, max_length=500)
    barcode_format: BarcodeFormat
    color: str = Field(default="#6C5CE7", pattern=r"^#[0-9A-Fa-f]{6}$")


class LoyaltyCardUpdate(BaseModel):
    store_name: str | None = Field(default=None, min_length=1, max_length=200)
    barcode_number: str | None = Field(default=None, min_length=1, max_length=500)
    barcode_format: BarcodeFormat | None = None
    color: str | None = Field(default=None, pattern=r"^#[0-9A-Fa-f]{6}$")


class LoyaltyCardResponse(BaseModel):
    id: str
    household_id: str
    store_name: str
    barcode_number: str
    barcode_format: str
    color: str
    created_by: str
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
