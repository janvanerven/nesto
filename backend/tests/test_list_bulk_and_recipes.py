import pytest
from httpx import AsyncClient

from tests.conftest import HOUSEHOLD_ID, OTHER_HOUSEHOLD_ID, USER_ID


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

LISTS = f"/api/households/{HOUSEHOLD_ID}/lists"


async def _make_list(client: AsyncClient) -> str:
    r = await client.post(LISTS, json={"name": "Groceries", "kind": "groceries"})
    assert r.status_code == 201
    return r.json()["id"]


def _bulk(names: list[str]) -> dict:
    return {"items": [{"name": n} for n in names]}


async def test_bulk_creates_items_with_sequential_positions(client):
    list_id = await _make_list(client)
    r = await client.post(f"{LISTS}/{list_id}/items", json={"name": "milk"})
    assert r.json()["position"] == 0
    r = await client.post(f"{LISTS}/{list_id}/items/bulk", json=_bulk(["a", "b", "c"]))
    assert r.status_code == 201
    body = r.json()
    assert [i["position"] for i in body] == [1, 2, 3]
    assert all(i["added_by"] == USER_ID for i in body)


async def test_bulk_with_recipe_links_items(client):
    list_id = await _make_list(client)
    r = await client.post(
        f"{LISTS}/{list_id}/items/bulk",
        json={
            "items": [{"name": "lasagnebladen", "quantity": "250 g"}],
            "recipe": {"url": "https://example.com/lasagne", "title": "Lasagne"},
        },
    )
    assert r.status_code == 201
    assert r.json()[0]["recipe_id"]
    recipes = (await client.get(f"{LISTS}/{list_id}/recipes")).json()
    assert recipes[0]["title"] == "Lasagne"
    assert recipes[0]["url"] == "https://example.com/lasagne"
    assert recipes[0]["created_by"] == USER_ID
    assert recipes[0]["id"] == r.json()[0]["recipe_id"]


async def test_bulk_rejects_archived_list_and_writes_nothing(client):
    list_id = await _make_list(client)
    await client.post(f"{LISTS}/{list_id}/items", json={"name": "milk"})
    assert (await client.post(f"{LISTS}/{list_id}/complete")).status_code == 200
    r = await client.post(
        f"{LISTS}/{list_id}/items/bulk",
        json={**_bulk(["a"]), "recipe": {"url": "https://example.com/x", "title": "X"}},
    )
    assert r.status_code == 409
    assert r.json()["detail"] == "List is archived"
    assert len((await client.get(f"{LISTS}/{list_id}/items")).json()) == 1
    assert (await client.get(f"{LISTS}/{list_id}/recipes")).json() == []


@pytest.mark.parametrize(
    "url",
    ["javascript:alert(1)", "ftp://example.com/x", "https://", "https://example.com/" + "a" * 2000],
    ids=["javascript", "ftp", "no-host", "too-long"],
)
async def test_bulk_rejects_bad_recipe_url(client, url):
    list_id = await _make_list(client)
    r = await client.post(
        f"{LISTS}/{list_id}/items/bulk",
        json={**_bulk(["a"]), "recipe": {"url": url, "title": "X"}},
    )
    assert r.status_code == 422


async def test_bulk_rejects_empty_and_oversized(client):
    list_id = await _make_list(client)
    assert (await client.post(f"{LISTS}/{list_id}/items/bulk", json={"items": []})).status_code == 422
    big = _bulk([f"i{n}" for n in range(101)])
    assert (await client.post(f"{LISTS}/{list_id}/items/bulk", json=big)).status_code == 422


async def test_bulk_other_household_404(client, db_session):
    from app.models.shopping_list import ShoppingList

    db_session.add(ShoppingList(id="other-list", household_id=OTHER_HOUSEHOLD_ID, name="x", created_by=USER_ID))
    await db_session.commit()
    other = f"/api/households/{OTHER_HOUSEHOLD_ID}/lists/other-list"
    for method, path in [("post", "/items/bulk"), ("get", "/recipes"), ("delete", "/recipes/nope")]:
        kwargs = {"json": _bulk(["a"])} if method == "post" else {}
        r = await getattr(client, method)(other + path, **kwargs)
        assert r.status_code == 404, (method, r.text)
    # own household path with another household's list id
    r = await client.post(f"{LISTS}/other-list/items/bulk", json=_bulk(["a"]))
    assert r.status_code == 404


async def _recipe_list(client):
    list_id = await _make_list(client)
    r = await client.post(
        f"{LISTS}/{list_id}/items/bulk",
        json={
            "items": [{"name": "a"}, {"name": "b"}],
            "recipe": {"url": "https://example.com/r", "title": "R"},
        },
    )
    items = r.json()
    await client.patch(f"{LISTS}/{list_id}/items/{items[0]['id']}", json={"checked": True})
    return list_id, items[0]["recipe_id"], items


async def test_delete_recipe_keep_items(client):
    list_id, recipe_id, _ = await _recipe_list(client)
    r = await client.delete(f"{LISTS}/{list_id}/recipes/{recipe_id}")
    assert r.status_code == 204
    items = (await client.get(f"{LISTS}/{list_id}/items")).json()
    assert len(items) == 2
    assert all(i["recipe_id"] is None for i in items)
    assert (await client.get(f"{LISTS}/{list_id}/recipes")).json() == []


async def test_delete_recipe_remove_unchecked(client):
    list_id, recipe_id, items = await _recipe_list(client)
    r = await client.delete(f"{LISTS}/{list_id}/recipes/{recipe_id}?remove_items=true")
    assert r.status_code == 204
    left = (await client.get(f"{LISTS}/{list_id}/items")).json()
    assert [i["id"] for i in left] == [items[0]["id"]]
    assert left[0]["checked"] is True and left[0]["recipe_id"] is None


async def test_delete_recipe_not_on_list_404(client):
    list_id, recipe_id, _ = await _recipe_list(client)
    other_list = await _make_list(client)
    assert (await client.delete(f"{LISTS}/{other_list}/recipes/{recipe_id}")).status_code == 404
    assert (await client.delete(f"{LISTS}/{list_id}/recipes/missing")).status_code == 404


async def test_item_create_ignores_recipe_id(client):
    list_id, recipe_id, _ = await _recipe_list(client)
    r = await client.post(f"{LISTS}/{list_id}/items", json={"name": "x", "recipe_id": recipe_id})
    assert r.status_code == 201
    assert r.json()["recipe_id"] is None
