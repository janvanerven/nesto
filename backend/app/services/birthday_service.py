import calendar as cal_mod
import uuid
from datetime import date

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.birthday import Birthday
from app.schemas.birthday import BirthdayCreate, BirthdayResponse, BirthdayUpdate

_UPDATABLE_FIELDS = {"person_name", "birth_month", "birth_day", "birth_year"}


def _compute_age(birth_year: int | None, birth_month: int, birth_day: int) -> int | None:
    """Compute current age. Returns None if birth_year is unknown or in the future."""
    if birth_year is None:
        return None
    today = date.today()
    age = today.year - birth_year
    if (today.month, today.day) < (birth_month, birth_day):
        age -= 1
    # Guard against future birth years (should be rejected by schema, but be safe)
    if age < 0:
        return None
    return age


def _birthday_to_response(birthday: Birthday) -> BirthdayResponse:
    return BirthdayResponse(
        id=birthday.id,
        household_id=birthday.household_id,
        person_name=birthday.person_name,
        birth_month=birthday.birth_month,
        birth_day=birthday.birth_day,
        birth_year=birthday.birth_year,
        age=_compute_age(birthday.birth_year, birthday.birth_month, birthday.birth_day),
        created_by=birthday.created_by,
        created_at=birthday.created_at,
        updated_at=birthday.updated_at,
    )


def _validate_month_day(month: int, day: int, year: int | None = None) -> None:
    """Validate that the day is valid for the given month (and year if known).
    Raises HTTPException 422 on invalid combinations like Feb 31."""
    if year is not None:
        max_day = cal_mod.monthrange(year, month)[1]
        if day > max_day:
            raise HTTPException(
                status_code=422,
                detail=f"Day {day} is invalid for {cal_mod.month_name[month]} {year}",
            )
    else:
        max_days = {1: 31, 2: 29, 3: 31, 4: 30, 5: 31, 6: 30,
                    7: 31, 8: 31, 9: 30, 10: 31, 11: 30, 12: 31}
        if day > max_days.get(month, 31):
            raise HTTPException(
                status_code=422,
                detail=f"Day {day} is invalid for month {month}",
            )


async def list_birthdays(
    db: AsyncSession, household_id: str
) -> list[BirthdayResponse]:
    result = await db.execute(
        select(Birthday)
        .where(Birthday.household_id == household_id)
        .order_by(Birthday.birth_month.asc(), Birthday.birth_day.asc())
    )
    return [_birthday_to_response(b) for b in result.scalars().all()]


async def create_birthday(
    db: AsyncSession, household_id: str, user_id: str, data: BirthdayCreate
) -> BirthdayResponse:
    birthday = Birthday(
        id=str(uuid.uuid4()),
        household_id=household_id,
        created_by=user_id,
        **data.model_dump(),
    )
    db.add(birthday)
    await db.commit()
    await db.refresh(birthday)
    return _birthday_to_response(birthday)


async def update_birthday(
    db: AsyncSession, birthday_id: str, household_id: str, data: BirthdayUpdate
) -> BirthdayResponse:
    birthday = await _get_birthday_or_404(db, birthday_id, household_id)
    updates = data.model_dump(exclude_unset=True)

    # Compute effective month/day/year after merging patch with existing values
    effective_month = updates.get("birth_month", birthday.birth_month)
    effective_day = updates.get("birth_day", birthday.birth_day)
    effective_year = updates.get("birth_year", birthday.birth_year)

    # Reject future birth years (parity with BirthdayCreate validator)
    if effective_year is not None and effective_year > date.today().year:
        raise HTTPException(status_code=422, detail="Birth year cannot be in the future")

    # Validate the resulting combination (catches Feb 31, Apr 31, etc.)
    _validate_month_day(effective_month, effective_day, effective_year)

    for key, value in updates.items():
        if key in _UPDATABLE_FIELDS:
            setattr(birthday, key, value)
    await db.commit()
    await db.refresh(birthday)
    return _birthday_to_response(birthday)


async def delete_birthday(
    db: AsyncSession, birthday_id: str, household_id: str
) -> None:
    birthday = await _get_birthday_or_404(db, birthday_id, household_id)
    await db.delete(birthday)
    await db.commit()


async def get_birthdays_for_feed(
    db: AsyncSession, household_id: str
) -> list[Birthday]:
    """Raw Birthday objects for ICS feed generation."""
    result = await db.execute(
        select(Birthday).where(Birthday.household_id == household_id)
    )
    return list(result.scalars().all())


async def _get_birthday_or_404(
    db: AsyncSession, birthday_id: str, household_id: str
) -> Birthday:
    result = await db.execute(
        select(Birthday).where(
            Birthday.id == birthday_id,
            Birthday.household_id == household_id,
        )
    )
    birthday = result.scalar_one_or_none()
    if not birthday:
        raise HTTPException(status_code=404, detail="Birthday not found")
    return birthday
