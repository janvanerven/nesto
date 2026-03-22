from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user_id
from app.database import get_db
from app.schemas.birthday import BirthdayCreate, BirthdayResponse, BirthdayUpdate
from app.services.household_service import get_household
from app.services import birthday_service as svc

router = APIRouter(prefix="/api/households/{household_id}/birthdays", tags=["birthdays"])


@router.get("", response_model=list[BirthdayResponse])
async def get_birthdays(
    household_id: str,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    await get_household(db, household_id, user_id)
    return await svc.list_birthdays(db, household_id)


@router.post("", response_model=BirthdayResponse, status_code=201)
async def create_birthday(
    household_id: str,
    body: BirthdayCreate,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    await get_household(db, household_id, user_id)
    return await svc.create_birthday(db, household_id, user_id, body)


@router.patch("/{birthday_id}", response_model=BirthdayResponse)
async def update_birthday(
    household_id: str,
    birthday_id: str,
    body: BirthdayUpdate,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    await get_household(db, household_id, user_id)
    return await svc.update_birthday(db, birthday_id, household_id, body)


@router.delete("/{birthday_id}", status_code=204)
async def delete_birthday(
    household_id: str,
    birthday_id: str,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    await get_household(db, household_id, user_id)
    await svc.delete_birthday(db, birthday_id, household_id)
