from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.shopping_list import ShoppingItem, ShoppingList
from app.schemas.shopping_list import SuggestedItem, SuggestionResponse

HISTORY_LISTS = 8
MIN_LISTS = 3


def _normalise(name: str) -> str:
    return " ".join(name.split()).lower()


async def suggest_items(
    db: AsyncSession, household_id: str, exclude_list_id: str | None
) -> SuggestionResponse:
    """Suggest items that appear on at least 3 of the last 8 archived grocery lists."""
    stmt = (
        select(ShoppingList.id)
        .where(
            ShoppingList.household_id == household_id,
            ShoppingList.kind == "groceries",
            ShoppingList.status == "archived",
        )
        .order_by(ShoppingList.updated_at.desc(), ShoppingList.id)
        .limit(HISTORY_LISTS)
    )
    if exclude_list_id:
        stmt = stmt.where(ShoppingList.id != exclude_list_id)
    list_ids = list((await db.execute(stmt)).scalars().all())
    if len(list_ids) < MIN_LISTS:
        return SuggestionResponse(enough_history=False, items=[])

    # list_ids is ordered most recent first; rank gives "most recent list" precedence.
    rank = {lid: i for i, lid in enumerate(list_ids)}
    rows = (
        await db.execute(
            select(ShoppingItem.list_id, ShoppingItem.name, ShoppingItem.quantity).where(
                ShoppingItem.list_id.in_(list_ids),
                ShoppingItem.recipe_id.is_(None),
            )
        )
    ).all()

    # key -> {list_id: (name, quantity)}; the first item per list wins
    seen: dict[str, dict[str, tuple[str, str]]] = {}
    for list_id, name, quantity in rows:
        key = _normalise(name)
        if key:
            seen.setdefault(key, {}).setdefault(list_id, (name, quantity))

    if exclude_list_id:
        on_target = (
            await db.execute(select(ShoppingItem.name).where(ShoppingItem.list_id == exclude_list_id))
        ).scalars().all()
        for name in on_target:
            seen.pop(_normalise(name), None)

    items = []
    for per_list in seen.values():
        if len(per_list) < MIN_LISTS:
            continue
        latest = min(per_list, key=rank.__getitem__)
        name, quantity = per_list[latest]
        name = " ".join(name.split())
        items.append(SuggestedItem(name=name, quantity=quantity, count=len(per_list)))
    items.sort(key=lambda i: (-i.count, i.name.lower()))
    return SuggestionResponse(enough_history=True, items=items)
