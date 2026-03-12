import uuid

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.loyalty_card import LoyaltyCard
from app.schemas.loyalty_card import LoyaltyCardCreate, LoyaltyCardUpdate

_UPDATABLE_FIELDS = {"store_name", "barcode_number", "barcode_format", "color"}


async def list_loyalty_cards(
    db: AsyncSession, household_id: str
) -> list[LoyaltyCard]:
    result = await db.execute(
        select(LoyaltyCard)
        .where(LoyaltyCard.household_id == household_id)
        .order_by(LoyaltyCard.store_name.asc())
    )
    return list(result.scalars().all())


async def create_loyalty_card(
    db: AsyncSession, household_id: str, user_id: str, data: LoyaltyCardCreate
) -> LoyaltyCard:
    card = LoyaltyCard(
        id=str(uuid.uuid4()),
        household_id=household_id,
        created_by=user_id,
        **data.model_dump(),
    )
    db.add(card)
    await db.commit()
    await db.refresh(card)
    return card


async def update_loyalty_card(
    db: AsyncSession, card_id: str, household_id: str, data: LoyaltyCardUpdate
) -> LoyaltyCard:
    card = await _get_card_or_404(db, card_id, household_id)
    updates = data.model_dump(exclude_unset=True)
    for key, value in updates.items():
        if key in _UPDATABLE_FIELDS:
            setattr(card, key, value)
    await db.commit()
    await db.refresh(card)
    return card


async def delete_loyalty_card(
    db: AsyncSession, card_id: str, household_id: str
) -> None:
    card = await _get_card_or_404(db, card_id, household_id)
    await db.delete(card)
    await db.commit()


async def _get_card_or_404(
    db: AsyncSession, card_id: str, household_id: str
) -> LoyaltyCard:
    result = await db.execute(
        select(LoyaltyCard).where(
            LoyaltyCard.id == card_id,
            LoyaltyCard.household_id == household_id,
        )
    )
    card = result.scalar_one_or_none()
    if not card:
        raise HTTPException(status_code=404, detail="Loyalty card not found")
    return card
