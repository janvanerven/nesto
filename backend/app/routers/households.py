from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user_id
from app.database import get_db
from app.schemas.household import HouseholdCreate, HouseholdUpdate, HouseholdResponse, InviteResponse, JoinRequest, MemberResponse
from app.services.household_service import create_household, update_household, create_invite, join_household, list_user_households, list_household_members

router = APIRouter(prefix="/api/households", tags=["households"])


@router.get("", response_model=list[HouseholdResponse])
async def list_households(
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    return await list_user_households(db, user_id)


@router.post("", response_model=HouseholdResponse, status_code=201)
async def create(
    body: HouseholdCreate,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    return await create_household(db, name=body.name, user_id=user_id)


@router.patch("/{household_id}", response_model=HouseholdResponse)
async def update(
    household_id: str,
    body: HouseholdUpdate,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    return await update_household(db, household_id, user_id, body.name)


@router.post("/{household_id}/invite", response_model=InviteResponse)
async def invite(
    household_id: str,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    inv = await create_invite(db, household_id, user_id)
    return InviteResponse(code=inv.id, expires_at=inv.expires_at)


@router.post("/join", response_model=HouseholdResponse)
async def join(
    body: JoinRequest,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    return await join_household(db, code=body.code, user_id=user_id)


@router.get("/{household_id}/members", response_model=list[MemberResponse])
async def members(
    household_id: str,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    return await list_household_members(db, household_id, user_id)
