import uuid

from fastapi import HTTPException
from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.shopping_list import ShoppingItem, ShoppingList, ShoppingListRecipe
from app.schemas.shopping_list import (
    BulkItemsCreate,
    ShoppingItemCreate,
    ShoppingItemUpdate,
    ShoppingListCreate,
    ShoppingListUpdate,
)

_LIST_UPDATABLE_FIELDS = {"name", "priority", "status", "kind"}
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
            "kind": sl.kind,
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
    # Bulk update instead of row-by-row to avoid N+1 writes
    await db.execute(
        update(ShoppingItem)
        .where(ShoppingItem.list_id == sl.id, ShoppingItem.checked == False)  # noqa: E712
        .values(checked=True)
    )
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


async def create_items_bulk(
    db: AsyncSession, list_id: str, household_id: str, user_id: str, data: BulkItemsCreate
) -> list[ShoppingItem]:
    sl = await _get_list_or_404(db, list_id, household_id)
    if sl.status != "active":
        raise HTTPException(status_code=409, detail="List is archived")

    recipe_id = None
    if data.recipe:
        recipe_id = str(uuid.uuid4())
        db.add(ShoppingListRecipe(
            id=recipe_id,
            list_id=list_id,
            url=data.recipe.url,
            title=data.recipe.title,
            created_by=user_id,
        ))

    max_pos = await db.execute(
        select(func.coalesce(func.max(ShoppingItem.position), -1)).where(ShoppingItem.list_id == list_id)
    )
    start = max_pos.scalar() + 1
    items = [
        ShoppingItem(
            id=str(uuid.uuid4()),
            list_id=list_id,
            added_by=user_id,
            position=start + i,
            recipe_id=recipe_id,
            **item.model_dump(),
        )
        for i, item in enumerate(data.items)
    ]
    db.add_all(items)
    await db.commit()
    for item in items:
        await db.refresh(item)
    return items


async def list_recipes(db: AsyncSession, list_id: str, household_id: str) -> list[ShoppingListRecipe]:
    await _get_list_or_404(db, list_id, household_id)
    result = await db.execute(
        select(ShoppingListRecipe)
        .where(ShoppingListRecipe.list_id == list_id)
        .order_by(ShoppingListRecipe.created_at.asc(), ShoppingListRecipe.id.asc())
    )
    return list(result.scalars().all())


async def delete_recipe(
    db: AsyncSession, list_id: str, household_id: str, recipe_id: str, remove_items: bool
) -> None:
    await _get_list_or_404(db, list_id, household_id)
    result = await db.execute(
        select(ShoppingListRecipe).where(
            ShoppingListRecipe.id == recipe_id, ShoppingListRecipe.list_id == list_id
        )
    )
    recipe = result.scalar_one_or_none()
    if not recipe:
        raise HTTPException(status_code=404, detail="Recipe not found")

    if remove_items:
        await db.execute(
            delete(ShoppingItem).where(
                ShoppingItem.recipe_id == recipe_id, ShoppingItem.checked == False  # noqa: E712
            )
        )
    # Detach remaining items explicitly (does not rely on SQLite FK enforcement)
    await db.execute(
        update(ShoppingItem).where(ShoppingItem.recipe_id == recipe_id).values(recipe_id=None)
    )
    await db.delete(recipe)
    await db.commit()


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
