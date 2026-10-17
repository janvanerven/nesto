from tests.conftest import HOUSEHOLD_ID


async def test_create_list_with_kind_returns_kind(client):
    r = await client.post(f"/api/households/{HOUSEHOLD_ID}/lists", json={"name": "Weekly", "kind": "groceries"})
    assert r.status_code == 201 and r.json()["kind"] == "groceries"


async def test_list_endpoint_includes_kind(client):
    await client.post(f"/api/households/{HOUSEHOLD_ID}/lists", json={"name": "Trip", "kind": "packing"})
    r = await client.get(f"/api/households/{HOUSEHOLD_ID}/lists")
    assert [item["kind"] for item in r.json()] == ["packing"]


async def test_kind_defaults_to_other(client):
    r = await client.post(f"/api/households/{HOUSEHOLD_ID}/lists", json={"name": "Misc"})
    assert r.status_code == 201 and r.json()["kind"] == "other"


async def test_invalid_kind_rejected(client):
    r = await client.post(f"/api/households/{HOUSEHOLD_ID}/lists", json={"name": "X", "kind": "food"})
    assert r.status_code == 422


async def test_patch_kind(client):
    created = await client.post(f"/api/households/{HOUSEHOLD_ID}/lists", json={"name": "Gifts"})
    list_id = created.json()["id"]
    r = await client.patch(f"/api/households/{HOUSEHOLD_ID}/lists/{list_id}", json={"kind": "wishlist"})
    assert r.status_code == 200 and r.json()["kind"] == "wishlist"
