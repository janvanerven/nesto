import pytest
from sqlalchemy import func, select

from app.models.contact import ContactAddress, Person
from tests.conftest import HOUSEHOLD_ID, OTHER_HOUSEHOLD_ID, USER_ID

BASE = f"/api/households/{HOUSEHOLD_ID}/contacts"
OTHER = f"/api/households/{OTHER_HOUSEHOLD_ID}/contacts"


@pytest.fixture
def extra_seed():
    def seed(session):
        session.add(Person(id="p-foreign", household_id=OTHER_HOUSEHOLD_ID, created_by=USER_ID, name="Foreign"))
        session.add(ContactAddress(id="a-foreign", household_id=OTHER_HOUSEHOLD_ID, label="Far", created_by=USER_ID))
    return seed


async def _address(client, **kw):
    r = await client.post(f"{BASE}/addresses", json={"label": "Home", **kw})
    assert r.status_code == 201, r.text
    return r.json()


async def _person(client, **kw):
    r = await client.post(f"{BASE}/people", json={"name": "Bare", **kw})
    assert r.status_code == 201, r.text
    return r.json()


async def test_create_address_with_people(client):
    a = await _address(client, people=[{"name": "Charlie"}, {"name": "alice"}, {"name": "Bob"}])
    assert [p["name"] for p in a["people"]] == ["alice", "Bob", "Charlie"]
    assert all(p["address_id"] == a["id"] for p in a["people"])


async def test_create_address_moves_existing_people(client):
    p = await _person(client, name="Mover", phone="123")
    a = await _address(client, move_people=[p["id"]])
    assert a["people"][0]["id"] == p["id"]
    assert a["people"][0]["address_id"] == a["id"]
    assert a["people"][0]["phone"] == "123"


@pytest.mark.parametrize("bad_id", ["p-foreign", "does-not-exist"])
async def test_move_people_invalid_writes_nothing(client, db_session, bad_id):
    good = await _person(client)
    r = await client.post(
        f"{BASE}/addresses",
        json={"label": "X", "people": [{"name": "New"}], "move_people": [good["id"], bad_id]},
    )
    assert r.status_code == 404
    assert await db_session.scalar(
        select(func.count()).select_from(ContactAddress).where(ContactAddress.household_id == HOUSEHOLD_ID)
    ) == 0
    people = (await client.get(BASE)).json()["people_without_address"]
    assert [p["name"] for p in people] == ["Bare"]


async def test_get_contacts_groups_and_sorts(client):
    b = await _address(client, label="beta", people=[{"name": "zed"}, {"name": "Amy"}])
    a = await _address(client, label="Alpha")
    await _person(client, name="yan")
    await _person(client, name="Xavi")
    r = (await client.get(BASE)).json()
    assert [x["id"] for x in r["addresses"]] == [a["id"], b["id"]]
    assert [p["name"] for p in r["addresses"][1]["people"]] == ["Amy", "zed"]
    assert [p["name"] for p in r["people_without_address"]] == ["Xavi", "yan"]


async def test_patch_person_unlink_and_relink(client):
    a = await _address(client, people=[{"name": "Pat"}])
    pid = a["people"][0]["id"]
    r = await client.patch(f"{BASE}/people/{pid}", json={"address_id": None})
    assert r.status_code == 200 and r.json()["address_id"] is None
    assert [p["id"] for p in (await client.get(BASE)).json()["people_without_address"]] == [pid]
    r = await client.patch(f"{BASE}/people/{pid}", json={"address_id": a["id"]})
    assert r.json()["address_id"] == a["id"]


async def test_patch_person_address_other_household_404(client):
    p = await _person(client)
    r = await client.patch(f"{BASE}/people/{p['id']}", json={"address_id": "a-foreign"})
    assert r.status_code == 404
    r = await client.post(f"{BASE}/people", json={"name": "N", "address_id": "a-foreign"})
    assert r.status_code == 404


async def test_delete_address_keeps_people_by_default(client, db_session):
    a = await _address(client, people=[{"name": "Pat"}])
    assert (await client.delete(f"{BASE}/addresses/{a['id']}")).status_code == 204
    r = (await client.get(BASE)).json()
    assert r["addresses"] == []
    assert [p["name"] for p in r["people_without_address"]] == ["Pat"]
    assert r["people_without_address"][0]["address_id"] is None


async def test_delete_address_with_people(client):
    a = await _address(client, people=[{"name": "Pat"}])
    assert (await client.delete(f"{BASE}/addresses/{a['id']}?delete_people=true")).status_code == 204
    r = (await client.get(BASE)).json()
    assert r == {"addresses": [], "people_without_address": []}


async def test_patch_address_and_person_fields(client):
    a = await _address(client, people=[{"name": "Pat", "birth_month": 2, "birth_day": 29}])
    r = await client.patch(f"{BASE}/addresses/{a['id']}", json={"city": "Utrecht"})
    assert r.status_code == 200 and r.json()["city"] == "Utrecht" and r.json()["label"] == "Home"
    assert len(r.json()["people"]) == 1
    pid = a["people"][0]["id"]
    r = await client.patch(f"{BASE}/people/{pid}", json={"birth_year": 2023})
    assert r.status_code == 422  # 2023 is not a leap year
    r = await client.patch(f"{BASE}/people/{pid}", json={"birth_month": None})
    assert r.status_code == 422
    r = await client.patch(f"{BASE}/people/{pid}", json={"birth_month": None, "birth_day": None})
    assert r.status_code == 200 and r.json()["birth_month"] is None
    assert (await client.delete(f"{BASE}/people/{pid}")).status_code == 204


async def test_person_birthday_month_without_day_422(client):
    r = await client.post(f"{BASE}/people", json={"name": "X", "birth_month": 3})
    assert r.status_code == 422


async def test_invalid_email_422(client):
    r = await client.post(f"{BASE}/people", json={"name": "X", "email": "nope"})
    assert r.status_code == 422
    r = await client.post(f"{BASE}/people", json={"name": "X", "email": "a@b.nl"})
    assert r.status_code == 201


async def test_person_with_birthday_shows_on_birthdays(client):
    p = await _person(client, name="Born", birth_month=5, birth_day=6, birth_year=2000)
    assert p["age"] is not None
    r = await client.get(f"/api/households/{HOUSEHOLD_ID}/birthdays")
    assert p["id"] in [b["id"] for b in r.json()]


@pytest.mark.parametrize("method,path", [
    ("GET", ""),
    ("POST", "/addresses"),
    ("PATCH", "/addresses/a-foreign"),
    ("DELETE", "/addresses/a-foreign"),
    ("POST", "/people"),
    ("PATCH", "/people/p-foreign"),
    ("DELETE", "/people/p-foreign"),
])
async def test_other_household_404(client, method, path):
    body = {"label": "L", "name": "N"} if method in ("POST", "PATCH") else None
    r = await client.request(method, OTHER + path, json=body)
    assert r.status_code == 404
    assert r.json()["detail"] == "Household not found"


async def test_cross_household_ids_in_own_household_404(client):
    for path, detail in (("/people/p-foreign", "Person not found"), ("/addresses/a-foreign", "Address not found")):
        for r in (await client.delete(BASE + path), await client.patch(BASE + path, json={})):
            assert r.status_code == 404
            assert r.json()["detail"] == detail


async def test_empty_address_id_normalised_to_none(client, db_session):
    r = await client.post(f"{BASE}/people", json={"name": "E", "address_id": ""})
    assert r.status_code == 201 and r.json()["address_id"] is None
    a = await _address(client, people=[{"name": "P"}])
    pid = a["people"][0]["id"]
    r = await client.patch(f"{BASE}/people/{pid}", json={"address_id": ""})
    assert r.status_code == 200 and r.json()["address_id"] is None
    ids = [p["id"] for p in (await client.get(BASE)).json()["people_without_address"]]
    assert pid in ids


async def test_delete_address_leaves_other_household_people(client, db_session):
    db_session.add(Person(id="p-stray", household_id=OTHER_HOUSEHOLD_ID, created_by=USER_ID,
                          name="Stray", address_id="a-mine"))
    a = await _address(client)
    await db_session.execute(
        Person.__table__.update().where(Person.id == "p-stray").values(address_id=a["id"]))
    await db_session.commit()
    assert (await client.delete(f"{BASE}/addresses/{a['id']}?delete_people=true")).status_code == 204
    assert (await db_session.get(Person, "p-stray")) is not None
