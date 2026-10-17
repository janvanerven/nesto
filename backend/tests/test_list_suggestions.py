import uuid
from datetime import datetime, timedelta


from app.models.shopping_list import ShoppingItem, ShoppingList, ShoppingListRecipe
from tests.conftest import HOUSEHOLD_ID, OTHER_HOUSEHOLD_ID, USER_ID


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

LISTS = f"/api/households/{HOUSEHOLD_ID}/lists"
BASE = datetime(2026, 1, 1)


async def _seed_list(db, day: int, items, *, kind="groceries", status="archived", household=HOUSEHOLD_ID) -> str:
    """items: list of (name, quantity) or (name, quantity, recipe_id)."""
    list_id = str(uuid.uuid4())
    db.add(ShoppingList(id=list_id, household_id=household, name=f"L{day}", status=status, kind=kind, created_by=USER_ID))
    await db.commit()
    for pos, it in enumerate(items):
        db.add(ShoppingItem(
            id=str(uuid.uuid4()), list_id=list_id, name=it[0], quantity=it[1],
            recipe_id=it[2] if len(it) > 2 else None, position=pos,
        ))
    obj = await db.get(ShoppingList, list_id)
    obj.updated_at = BASE + timedelta(days=day)
    await db.commit()
    return list_id


async def _target(db) -> str:
    return await _seed_list(db, 100, [], status="active")


async def _suggest(client, list_id):
    r = await client.get(f"{LISTS}/{list_id}/suggestions")
    return r


async def test_item_on_3_of_8_recent_grocery_lists_is_suggested(client, db_session):
    await _seed_list(db_session, 1, [("Melk", "1 L"), ("Taart", "1")])
    await _seed_list(db_session, 2, [("Melk", "2 L"), ("Taart", "1")])
    await _seed_list(db_session, 3, [("Melk", "3 L")])
    t = await _target(db_session)
    r = await _suggest(client, t)
    assert r.status_code == 200
    assert r.json() == {"enough_history": True, "items": [{"name": "Melk", "quantity": "3 L", "count": 3}]}


async def test_name_normalisation_case_and_whitespace(client, db_session):
    await _seed_list(db_session, 1, [("melk", "a")])
    await _seed_list(db_session, 2, [("Melk ", "b")])
    await _seed_list(db_session, 3, [("  MELK", "c")])
    await _seed_list(db_session, 0, [("Brood", "")])
    t = await _target(db_session)
    r = await _suggest(client, t)
    assert r.json()["items"] == [{"name": "MELK", "quantity": "c", "count": 3}]


async def test_only_last_8_archived_grocery_lists_count(client, db_session):
    for d in range(1, 9):
        await _seed_list(db_session, d, [("Other", "")])
    # oldest three lists (days -3..-1) hold the item but fall outside the last 8
    for d in (-3, -2, -1):
        await _seed_list(db_session, d, [("Oud", "")])
    t = await _target(db_session)
    r = await _suggest(client, t)
    names = [i["name"] for i in r.json()["items"]]
    assert "Oud" not in names
    assert names == ["Other"]


async def test_non_grocery_and_active_lists_ignored(client, db_session):
    await _seed_list(db_session, 1, [("Melk", "")])
    await _seed_list(db_session, 2, [("Melk", "")])
    await _seed_list(db_session, 3, [("Melk", "")], kind="packing")
    await _seed_list(db_session, 4, [("Melk", "")], status="active")
    await _seed_list(db_session, 5, [("Melk", "")], household=OTHER_HOUSEHOLD_ID)
    t = await _target(db_session)
    r = await _suggest(client, t)
    assert r.json() == {"enough_history": False, "items": []}


async def test_recipe_items_excluded(client, db_session):
    recipe_id = str(uuid.uuid4())
    src = await _seed_list(db_session, 0, [])
    db_session.add(ShoppingListRecipe(id=recipe_id, list_id=src, url="https://x.test", title="R", created_by=USER_ID))
    await db_session.commit()
    for d in (1, 2, 3):
        await _seed_list(db_session, d, [("Ui", "", recipe_id), ("Melk", "")])
    t = await _target(db_session)
    r = await _suggest(client, t)
    assert [i["name"] for i in r.json()["items"]] == ["Melk"]


async def test_items_already_on_target_list_excluded(client, db_session):
    for d in (1, 2, 3):
        await _seed_list(db_session, d, [("Melk", ""), ("Brood", "")])
    t = await _seed_list(db_session, 100, [(" melk", "")], status="active")
    r = await _suggest(client, t)
    assert [i["name"] for i in r.json()["items"]] == ["Brood"]


async def test_ordering_count_desc_then_name(client, db_session):
    await _seed_list(db_session, 1, [("Brood", ""), ("Appel", ""), ("Kaas", "")])
    await _seed_list(db_session, 2, [("Brood", ""), ("Appel", ""), ("Kaas", "")])
    await _seed_list(db_session, 3, [("Brood", ""), ("Appel", ""), ("Kaas", "")])
    await _seed_list(db_session, 4, [("Kaas", "")])
    t = await _target(db_session)
    r = await _suggest(client, t)
    assert [i["name"] for i in r.json()["items"]] == ["Kaas", "Appel", "Brood"]


async def test_not_enough_history(client, db_session):
    await _seed_list(db_session, 1, [("Melk", "")])
    await _seed_list(db_session, 2, [("Melk", "")])
    t = await _target(db_session)
    r = await _suggest(client, t)
    assert r.json() == {"enough_history": False, "items": []}


async def test_suggestions_on_non_grocery_list_400(client, db_session):
    t = await _seed_list(db_session, 1, [], kind="packing", status="active")
    r = await _suggest(client, t)
    assert r.status_code == 400
    assert r.json()["detail"] == "Suggestions are only available for grocery lists"


async def test_suggestions_unknown_list_404(client, db_session):
    r = await _suggest(client, "nope")
    assert r.status_code == 404


async def test_suggestions_other_household_404(client, db_session):
    other = await _seed_list(db_session, 1, [], status="active", household=OTHER_HOUSEHOLD_ID)
    r = await client.get(f"/api/households/{OTHER_HOUSEHOLD_ID}/lists/{other}/suggestions")
    assert r.status_code in (403, 404)
