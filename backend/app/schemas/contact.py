from datetime import datetime

from pydantic import BaseModel, Field, field_validator, model_validator

from app.schemas.birthday import validate_birth_date

_EMAIL_PATTERN = r"^[^@\s]+@[^@\s]+\.[^@\s]+$"


class PersonBase(BaseModel):
    birth_month: int | None = Field(default=None, ge=1, le=12)
    birth_day: int | None = Field(default=None, ge=1, le=31)
    birth_year: int | None = Field(default=None, ge=1900)


class PersonAddressBase(PersonBase):
    address_id: str | None = None

    @field_validator("address_id")
    @classmethod
    def blank_address_is_none(cls, v: str | None) -> str | None:
        return v or None


class PersonCreate(PersonAddressBase):
    name: str = Field(min_length=1, max_length=200)
    phone: str = Field(default="", max_length=50)
    email: str = Field(default="", max_length=254, pattern=f"^$|{_EMAIL_PATTERN}")
    notes: str = Field(default="", max_length=2000)

    @model_validator(mode="after")
    def validate_birthday(self) -> "PersonCreate":
        if (self.birth_month is None) != (self.birth_day is None):
            raise ValueError("birth_month and birth_day must be set together")
        if self.birth_month is None and self.birth_year is not None:
            raise ValueError("birth_year requires birth_month and birth_day")
        if self.birth_month is not None:
            validate_birth_date(self.birth_month, self.birth_day, self.birth_year)
        return self


class PersonUpdate(PersonAddressBase):
    # Cross-field birthday validation happens in the service after merging with the record.
    name: str | None = Field(default=None, min_length=1, max_length=200)
    phone: str | None = Field(default=None, max_length=50)
    email: str | None = Field(default=None, max_length=254, pattern=f"^$|{_EMAIL_PATTERN}")
    notes: str | None = Field(default=None, max_length=2000)


class PersonResponse(BaseModel):
    id: str
    household_id: str
    address_id: str | None
    name: str
    birth_month: int | None
    birth_day: int | None
    birth_year: int | None
    age: int | None
    phone: str
    email: str
    notes: str
    created_at: datetime
    updated_at: datetime


class AddressFields(BaseModel):
    street: str = Field(default="", max_length=200)
    postcode: str = Field(default="", max_length=20)
    city: str = Field(default="", max_length=100)
    country: str = Field(default="", max_length=100)
    notes: str = Field(default="", max_length=2000)


class AddressCreate(AddressFields):
    label: str = Field(min_length=1, max_length=200)
    people: list[PersonCreate] = Field(default_factory=list, max_length=20)
    move_people: list[str] = Field(default_factory=list, max_length=20)


class AddressUpdate(BaseModel):
    label: str | None = Field(default=None, min_length=1, max_length=200)
    street: str | None = Field(default=None, max_length=200)
    postcode: str | None = Field(default=None, max_length=20)
    city: str | None = Field(default=None, max_length=100)
    country: str | None = Field(default=None, max_length=100)
    notes: str | None = Field(default=None, max_length=2000)


class AddressResponse(AddressFields):
    id: str
    household_id: str
    label: str
    people: list[PersonResponse]
    created_at: datetime
    updated_at: datetime


class ContactsResponse(BaseModel):
    addresses: list[AddressResponse]
    people_without_address: list[PersonResponse]
