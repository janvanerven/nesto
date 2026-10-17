from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user_id
from app.database import get_db
from app.schemas.contact import (
    AddressCreate,
    AddressResponse,
    AddressUpdate,
    ContactsResponse,
    PersonCreate,
    PersonResponse,
    PersonUpdate,
)
from app.services import contact_service as svc
from app.services.household_service import get_household

router = APIRouter(prefix="/api/households/{household_id}/contacts", tags=["contacts"])


@router.get("", response_model=ContactsResponse)
async def get_contacts(
    household_id: str,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    await get_household(db, household_id, user_id)
    return await svc.list_contacts(db, household_id)


@router.post("/addresses", response_model=AddressResponse, status_code=201)
async def create_address(
    household_id: str,
    body: AddressCreate,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    await get_household(db, household_id, user_id)
    return await svc.create_address(db, household_id, user_id, body)


@router.patch("/addresses/{address_id}", response_model=AddressResponse)
async def update_address(
    household_id: str,
    address_id: str,
    body: AddressUpdate,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    await get_household(db, household_id, user_id)
    return await svc.update_address(db, household_id, address_id, body)


@router.delete("/addresses/{address_id}", status_code=204)
async def delete_address(
    household_id: str,
    address_id: str,
    delete_people: bool = False,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    await get_household(db, household_id, user_id)
    await svc.delete_address(db, household_id, address_id, delete_people)


@router.post("/people", response_model=PersonResponse, status_code=201)
async def create_person(
    household_id: str,
    body: PersonCreate,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    await get_household(db, household_id, user_id)
    return await svc.create_person(db, household_id, user_id, body)


@router.patch("/people/{person_id}", response_model=PersonResponse)
async def update_person(
    household_id: str,
    person_id: str,
    body: PersonUpdate,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    await get_household(db, household_id, user_id)
    return await svc.update_person(db, household_id, person_id, body)


@router.delete("/people/{person_id}", status_code=204)
async def delete_person(
    household_id: str,
    person_id: str,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    await get_household(db, household_id, user_id)
    await svc.delete_person(db, household_id, person_id)
