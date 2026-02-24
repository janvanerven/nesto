import uuid

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.shopping_list import ShoppingItem, ShoppingList
from app.schemas.shopping_list import (
    ShoppingItemCreate,
    ShoppingItemUpdate,
    ShoppingListCreate,
    ShoppingListUpdate,
)

_LIST_UPDATABLE_FIELDS = {"name", "priority", "status"}
_ITEM_UPDATABLE_FIELDS = {"name", "quantity", "checked"}


async def list_shopping_lists(
    db: AsyncSession,
    household_id: str,
    status: str | None = None,
) -> list[dict]:
    # Count items per list in a single subquery to avoid N+1
    item_counts = (
        select(
            ShoppingItem.list_id,
            func.count(ShoppingItem.id).label("item_count"),
            func.count(ShoppingItem.id).filter(ShoppingItem.checked == True).label("checked_count"),  # noqa: E712
        )
        .group_by(ShoppingItem.list_id)
        .subquery()
    )

    query = (
        select(
            ShoppingList,
            func.coalesce(item_counts.c.item_count, 0).label("item_count"),
            func.coalesce(item_counts.c.checked_count, 0).label("checked_count"),
        )
        .outerjoin(item_counts, ShoppingList.id == item_counts.c.list_id)
        .where(ShoppingList.household_id == household_id)
    )
    if status:
        query = query.where(ShoppingList.status == status)
    query = query.order_by(ShoppingList.priority.asc(), ShoppingList.created_at.desc())
    result = await db.execute(query)

    out = []
    for sl, total, checked in result.all():
        out.append({
            "id": sl.id,
            "household_id": sl.household_id,
            "name": sl.name,
            "priority": sl.priority,
            "status": sl.status,
            "created_by": sl.created_by,
            "created_at": sl.created_at,
            "updated_at": sl.updated_at,
            "item_count": total,
            "checked_count": checked,
        })
    return out


async def create_shopping_list(
    db: AsyncSession, household_id: str, user_id: str, data: ShoppingListCreate
) -> dict:
    sl = ShoppingList(
        id=str(uuid.uuid4()),
        household_id=household_id,
        created_by=user_id,
        **data.model_dump(),
    )
    db.add(sl)
    await db.commit()
    await db.refresh(sl)
    return {
        **{c.key: getattr(sl, c.key) for c in sl.__table__.columns},
        "item_count": 0,
        "checked_count": 0,
    }


async def update_shopping_list(
    db: AsyncSession, list_id: str, household_id: str, data: ShoppingListUpdate
) -> dict:
    sl = await _get_list_or_404(db, list_id, household_id)
    updates = data.model_dump(exclude_unset=True)
    for key, value in updates.items():
        if key in _LIST_UPDATABLE_FIELDS:
            setattr(sl, key, value)
    await db.commit()
    await db.refresh(sl)

    counts = await db.execute(
        select(
            func.count(ShoppingItem.id),
            func.count(ShoppingItem.id).filter(ShoppingItem.checked == True),
        ).where(ShoppingItem.list_id == sl.id)
    )
    total, checked = counts.one()
    return {
        **{c.key: getattr(sl, c.key) for c in sl.__table__.columns},
        "item_count": total,
        "checked_count": checked,
    }


async def delete_shopping_list(db: AsyncSession, list_id: str, household_id: str) -> None:
    sl = await _get_list_or_404(db, list_id, household_id)
    await db.delete(sl)
    await db.commit()


async def complete_shopping_list(
    db: AsyncSession, list_id: str, household_id: str
) -> dict:
    sl = await _get_list_or_404(db, list_id, household_id)
    sl.status = "archived"
    items_result = await db.execute(
        select(ShoppingItem).where(ShoppingItem.list_id == sl.id, ShoppingItem.checked == False)
    )
    for item in items_result.scalars().all():
        item.checked = True
    await db.commit()
    await db.refresh(sl)

    counts = await db.execute(
        select(
            func.count(ShoppingItem.id),
            func.count(ShoppingItem.id).filter(ShoppingItem.checked == True),
        ).where(ShoppingItem.list_id == sl.id)
    )
    total, checked = counts.one()
    return {
        **{c.key: getattr(sl, c.key) for c in sl.__table__.columns},
        "item_count": total,
        "checked_count": checked,
    }


async def list_items(db: AsyncSession, list_id: str, household_id: str) -> list[ShoppingItem]:
    await _get_list_or_404(db, list_id, household_id)
    result = await db.execute(
        select(ShoppingItem)
        .where(ShoppingItem.list_id == list_id)
        .order_by(ShoppingItem.checked.asc(), ShoppingItem.position.asc(), ShoppingItem.created_at.asc())
    )
    return list(result.scalars().all())


async def create_item(
    db: AsyncSession, list_id: str, household_id: str, data: ShoppingItemCreate, user_id: str | None = None
) -> ShoppingItem:
    await _get_list_or_404(db, list_id, household_id)
    max_pos = await db.execute(
        select(func.coalesce(func.max(ShoppingItem.position), -1)).where(ShoppingItem.list_id == list_id)
    )
    position = max_pos.scalar() + 1

    item = ShoppingItem(
        id=str(uuid.uuid4()),
        list_id=list_id,
        added_by=user_id,
        position=position,
        **data.model_dump(),
    )
    db.add(item)
    await db.commit()
    await db.refresh(item)
    return item


async def update_item(
    db: AsyncSession, item_id: str, list_id: str, household_id: str, data: ShoppingItemUpdate
) -> ShoppingItem:
    await _get_list_or_404(db, list_id, household_id)
    result = await db.execute(
        select(ShoppingItem).where(ShoppingItem.id == item_id, ShoppingItem.list_id == list_id)
    )
    item = result.scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")

    updates = data.model_dump(exclude_unset=True)
    for key, value in updates.items():
        if key in _ITEM_UPDATABLE_FIELDS:
            setattr(item, key, value)
    await db.commit()
    await db.refresh(item)
    return item


async def delete_item(db: AsyncSession, item_id: str, list_id: str, household_id: str) -> None:
    await _get_list_or_404(db, list_id, household_id)
    result = await db.execute(
        select(ShoppingItem).where(ShoppingItem.id == item_id, ShoppingItem.list_id == list_id)
    )
    item = result.scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    await db.delete(item)
    await db.commit()


async def _get_list_or_404(db: AsyncSession, list_id: str, household_id: str) -> ShoppingList:
    result = await db.execute(
        select(ShoppingList).where(ShoppingList.id == list_id, ShoppingList.household_id == household_id)
    )
    sl = result.scalar_one_or_none()
    if not sl:
        raise HTTPException(status_code=404, detail="Shopping list not found")
    return sl
