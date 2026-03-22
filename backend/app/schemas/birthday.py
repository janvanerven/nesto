import calendar as cal_mod
from datetime import datetime

from pydantic import BaseModel, Field, model_validator


class BirthdayCreate(BaseModel):
    person_name: str = Field(min_length=1, max_length=200)
    birth_month: int = Field(ge=1, le=12)
    birth_day: int = Field(ge=1, le=31)
    birth_year: int | None = Field(default=None, ge=1900)

    @model_validator(mode="after")
    def validate_date(self) -> "BirthdayCreate":
        # Cap birth_year at current year
        if self.birth_year is not None and self.birth_year > datetime.now().year:
            raise ValueError(f"Birth year cannot be in the future")
        # Validate day for month, accounting for leap year when birth_year is known
        if self.birth_year is not None:
            # Use real calendar validation
            max_day = cal_mod.monthrange(self.birth_year, self.birth_month)[1]
            if self.birth_day > max_day:
                raise ValueError(
                    f"Day {self.birth_day} is invalid for "
                    f"{cal_mod.month_name[self.birth_month]} {self.birth_year}"
                )
        else:
            # Year unknown — allow Feb 29 (leap day birthdays exist)
            max_days = {1: 31, 2: 29, 3: 31, 4: 30, 5: 31, 6: 30,
                        7: 31, 8: 31, 9: 30, 10: 31, 11: 30, 12: 31}
            if self.birth_day > max_days.get(self.birth_month, 31):
                raise ValueError(
                    f"Day {self.birth_day} is invalid for month {self.birth_month}"
                )
        return self


class BirthdayUpdate(BaseModel):
    person_name: str | None = Field(default=None, min_length=1, max_length=200)
    birth_month: int | None = Field(default=None, ge=1, le=12)
    birth_day: int | None = Field(default=None, ge=1, le=31)
    birth_year: int | None = Field(default=None, ge=1900)
    # Note: birth_year can be explicitly set to null to clear it.
    # Cross-field validation (month/day combo) is done in the service layer
    # after merging with the existing record, since this is a partial update.


class BirthdayResponse(BaseModel):
    id: str
    household_id: str
    person_name: str
    birth_month: int
    birth_day: int
    birth_year: int | None
    age: int | None
    created_by: str
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
