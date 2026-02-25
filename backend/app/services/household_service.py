import uuid
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.household import Household, HouseholdInvite, HouseholdMember
from app.models.user import User


async def create_household(db: AsyncSession, name: str, user_id: str) -> Household:
    household = Household(id=str(uuid.uuid4()), name=name, created_by=user_id)
    db.add(household)
    member = HouseholdMember(household_id=household.id, user_id=user_id)
    db.add(member)
    await db.commit()
    await db.refresh(household)
    return household


async def list_user_households(db: AsyncSession, user_id: str) -> list[Household]:
    result = await db.execute(
        select(Household)
        .join(HouseholdMember, Household.id == HouseholdMember.household_id)
        .where(HouseholdMember.user_id == user_id)
    )
    return list(result.scalars().all())


async def get_household(db: AsyncSession, household_id: str, user_id: str) -> Household:
    # Verify membership
    result = await db.execute(
        select(HouseholdMember).where(
            HouseholdMember.household_id == household_id,
            HouseholdMember.user_id == user_id,
        )
    )
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=403, detail="Not a member of this household")

    result = await db.execute(select(Household).where(Household.id == household_id))
    household = result.scalar_one_or_none()
    if not household:
        raise HTTPException(status_code=404, detail="Household not found")
    return household


async def update_household(db: AsyncSession, household_id: str, user_id: str, name: str) -> Household:
    household = await get_household(db, household_id, user_id)
    household.name = name
    await db.commit()
    await db.refresh(household)
    return household


async def create_invite(db: AsyncSession, household_id: str, user_id: str) -> HouseholdInvite:
    # Verify membership
    await get_household(db, household_id, user_id)

    invite = HouseholdInvite(
        id=str(uuid.uuid4()),
        household_id=household_id,
        created_by=user_id,
        expires_at=datetime.now(timezone.utc) + timedelta(days=7),
    )
    db.add(invite)
    await db.commit()
    await db.refresh(invite)
    return invite


async def join_household(db: AsyncSession, code: str, user_id: str) -> Household:
    result = await db.execute(select(HouseholdInvite).where(HouseholdInvite.id == code))
    invite = result.scalar_one_or_none()

    if not invite:
        raise HTTPException(status_code=404, detail="Invalid invite code")

    if invite.expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=410, detail="Invite has expired")

    # Check if already a member
    result = await db.execute(
        select(HouseholdMember).where(
            HouseholdMember.household_id == invite.household_id,
            HouseholdMember.user_id == user_id,
        )
    )
    if result.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Already a member")

    member = HouseholdMember(household_id=invite.household_id, user_id=user_id)
    db.add(member)

    # Mark invite as consumed (single-use)
    await db.delete(invite)

    await db.commit()

    result = await db.execute(select(Household).where(Household.id == invite.household_id))
    return result.scalar_one()


async def list_household_members(db: AsyncSession, household_id: str, user_id: str) -> list[User]:
    await get_household(db, household_id, user_id)
    result = await db.execute(
        select(User)
        .join(HouseholdMember, User.id == HouseholdMember.user_id)
        .where(HouseholdMember.household_id == household_id)
    )
    return list(result.scalars().all())
