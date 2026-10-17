import pytest

from app.models.contact import ContactAddress, Person
from app.services import feed_service
from tests.conftest import HOUSEHOLD_ID, USER_ID

BASE_URL = f"/api/households/{HOUSEHOLD_ID}/birthdays"


def _person(**kw) -> Person:
    return Person(id=kw.pop("id"), household_id=HOUSEHOLD_ID, created_by=USER_ID, **kw)


@pytest.fixture
def extra_seed():
    def seed(session):
        session.add(ContactAddress(id="addr-1", household_id=HOUSEHOLD_ID, label="Oma's house", created_by=USER_ID))
        session.add(_person(id="p-bare", name="Bare", birth_month=1, birth_day=2))
        session.add(_person(id="p-addr", name="Housed", birth_month=4, birth_day=5, birth_year=1990, address_id="addr-1"))
        session.add(_person(id="p-phone", name="Caller", birth_month=6, birth_day=7, phone="+31 6 1234"))
        session.add(_person(id="p-none", name="No Birthday"))
    return seed


async def test_post_birthday_creates_person_without_address(client, db_session):
    r = await client.post(BASE_URL, json={"person_name": "Oma", "birth_month": 3, "birth_day": 3, "birth_year": 1948})
    assert r.status_code == 201
    p = await db_session.get(Person, r.json()["id"])
    assert (p.name, p.address_id, p.birth_year) == ("Oma", None, 1948)


async def test_person_without_birthday_not_listed(client):
    r = await client.get(BASE_URL)
    assert r.status_code == 200
    ids = [b["id"] for b in r.json()]
    assert "p-none" not in ids
    assert ids == ["p-bare", "p-addr", "p-phone"]
    assert r.json()[1]["person_name"] == "Housed"


async def test_delete_birthday_of_bare_person_deletes_person(client, db_session):
    r = await client.delete(f"{BASE_URL}/p-bare")
    assert r.status_code == 204
    db_session.expunge_all()
    assert await db_session.get(Person, "p-bare") is None


@pytest.mark.parametrize("person_id", ["p-addr", "p-phone"])
async def test_delete_birthday_keeps_person_with_address(client, db_session, person_id):
    r = await client.delete(f"{BASE_URL}/{person_id}")
    assert r.status_code == 204
    db_session.expunge_all()
    p = await db_session.get(Person, person_id)
    assert p is not None
    assert (p.birth_month, p.birth_day, p.birth_year) == (None, None, None)
    ids = [b["id"] for b in (await client.get(BASE_URL)).json()]
    assert person_id not in ids


async def test_delete_birthday_of_person_without_birthday_is_404(client):
    r = await client.delete(f"{BASE_URL}/p-none")
    assert r.status_code == 404


async def test_feed_uid_uses_person_id(db_session):
    ics = await feed_service.generate_feed(db_session, USER_ID, HOUSEHOLD_ID)
    for pid in ("p-bare", "p-addr", "p-phone"):
        assert f"birthday-{pid}@nesto" in ics
    assert "birthday-p-none@nesto" not in ics
    assert "Housed's Birthday (born 1990)" in ics


async def test_patch_cannot_null_birth_date(client):
    r = await client.patch(f"{BASE_URL}/p-bare", json={"birth_month": None})
    assert r.status_code == 422
