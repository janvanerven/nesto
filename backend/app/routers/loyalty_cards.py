from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user_id
from app.database import get_db
from app.schemas.loyalty_card import (
    LoyaltyCardCreate,
    LoyaltyCardResponse,
    LoyaltyCardUpdate,
)
from app.services.household_service import get_household
from app.services import loyalty_card_service as svc

router = APIRouter(prefix="/api/households/{household_id}/cards", tags=["cards"])


@router.get("", response_model=list[LoyaltyCardResponse])
async def get_cards(
    household_id: str,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    await get_household(db, household_id, user_id)
    return await svc.list_loyalty_cards(db, household_id)


@router.post("", response_model=LoyaltyCardResponse, status_code=201)
async def create_card(
    household_id: str,
    body: LoyaltyCardCreate,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    await get_household(db, household_id, user_id)
    return await svc.create_loyalty_card(db, household_id, user_id, body)


@router.patch("/{card_id}", response_model=LoyaltyCardResponse)
async def update_card(
    household_id: str,
    card_id: str,
    body: LoyaltyCardUpdate,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    await get_household(db, household_id, user_id)
    return await svc.update_loyalty_card(db, card_id, household_id, body)


@router.delete("/{card_id}", status_code=204)
async def delete_card(
    household_id: str,
    card_id: str,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    await get_household(db, household_id, user_id)
    await svc.delete_loyalty_card(db, card_id, household_id)
