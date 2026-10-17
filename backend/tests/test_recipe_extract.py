import json
import os

os.environ.setdefault("SECRET_KEY", "a" * 64)
os.environ.setdefault("OIDC_ISSUER_URL", "https://auth.example.com")
os.environ.setdefault("OIDC_CLIENT_ID", "test-client")

import httpx
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.database import Base
from app.models.ai_settings import HouseholdAiSettings
from app.models.household import Household, HouseholdMember
from app.models.shopping_list import ShoppingList
from app.models.user import User
from app.routers import shopping_lists as lists_router
from app.services import crypto_service
from app.services.ai import rate_limit, recipe_extract
from app.services.safe_fetch import FetchError

USER_ID = "test-user-001"
HOUSEHOLD_ID = "test-household-001"
OTHER_HOUSEHOLD_ID = "test-household-002"
GROCERY_ID = "list-groceries"
OTHER_LIST_ID = "list-other"
ARCHIVED_ID = "list-archived"
RECIPE_URL = "https://example.com/lasagne"


def _url(list_id=GROCERY_ID):
    return f"/api/households/{HOUSEHOLD_ID}/lists/{list_id}/recipes/extract"


@pytest.fixture
async def db_session():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    session_factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with session_factory() as session:
        session.add(User(id=USER_ID, email="test@example.com", display_name="Test User"))
        session.add(Household(id=HOUSEHOLD_ID, name="Test Home", created_by=USER_ID))
        session.add(HouseholdMember(household_id=HOUSEHOLD_ID, user_id=USER_ID))
        session.add(Household(id=OTHER_HOUSEHOLD_ID, name="Other Home", created_by=USER_ID))
        session.add(HouseholdAiSettings(
            household_id=HOUSEHOLD_ID,
            encrypted_api_key=crypto_service.encrypt_password("sk-or-secret"),
            key_label="k",
            model="m/x",
            updated_by=USER_ID,
        ))
        session.add(ShoppingList(id=GROCERY_ID, household_id=HOUSEHOLD_ID, name="Food", kind="groceries", created_by=USER_ID))
        session.add(ShoppingList(id=OTHER_LIST_ID, household_id=HOUSEHOLD_ID, name="Misc", kind="other", created_by=USER_ID))
        session.add(ShoppingList(id=ARCHIVED_ID, household_id=HOUSEHOLD_ID, name="Old", kind="groceries", status="archived", created_by=USER_ID))
        await session.commit()
        yield session
    await engine.dispose()


@pytest.fixture
async def client(db_session: AsyncSession):
    from app.auth import get_current_user_id
    from app.database import get_db
    from app.main import app

    async def override_get_db():
        yield db_session

    async def override_get_current_user_id():
        return USER_ID

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_current_user_id] = override_get_current_user_id
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as ac:
        yield ac
    app.dependency_overrides.clear()


@pytest.fixture(autouse=True)
def _reset(monkeypatch):
    rate_limit.reset()
    yield
    monkeypatch.setattr(recipe_extract, "_transport", None)


def _mock_page(monkeypatch, html):
    async def fake(url, **kw):
        return url, html

    monkeypatch.setattr(lists_router, "safe_fetch_html", fake)


def _mock_llm(monkeypatch, content, seen=None):
    def handler(request: httpx.Request):
        if seen is not None:
            seen.append(json.loads(request.content))
        return httpx.Response(200, json={"choices": [{"message": {"content": content}, "finish_reason": "stop"}]})

    monkeypatch.setattr(recipe_extract, "_transport", httpx.MockTransport(handler))


JSONLD_PAGE = """<html><head><title>Site | Lasagne</title>
<script type="application/ld+json">{"@type":"Recipe","name":"Lasagne","recipeIngredient":["250 g gehakt","zout"]}</script>
</head><body><nav>Menu</nav><p>Long story</p></body></html>"""


def parse(html):
    return recipe_extract.parse_jsonld_recipe(html)


def test_jsonld_simple():
    assert parse(JSONLD_PAGE) == ("Lasagne", ["250 g gehakt", "zout"])


def test_jsonld_graph_and_type_list():
    data = {"@graph": [{"@type": "WebPage"}, {"@type": ["Recipe", "Thing"], "name": "Soep",
                                              "recipeIngredient": ["1 <b>ui</b>", "2 &amp; 3 eieren"]}]}
    html = f'<script type="application/ld+json">{json.dumps(data)}</script>'
    assert parse(html) == ("Soep", ["1 ui", "2 & 3 eieren"])
    listed = f'<script type="application/ld+json">{json.dumps([{"@type": "Recipe", "recipeIngredient": ["a"]}])}</script>'
    assert parse(listed) == ("", ["a"])


def test_no_jsonld_returns_none():
    assert parse("<html><body>hi</body></html>") is None
    assert parse('<script type="application/ld+json">{not json</script>') is None


def test_visible_text_skips_scripts_and_nav():
    html = ("<html><head><style>.x{}</style></head><body><nav>NAVTEXT</nav><header>HEAD</header>"
            "<script>var a=1;</script><svg><text>SVGTEXT</text></svg><noscript>NOSCRIPT</noscript>"
            "<p>200 g  rijst</p><footer>FOOT</footer></body></html>")
    text = recipe_extract.visible_text(html)
    assert text == "200 g rijst"
    assert len(recipe_extract.visible_text("<p>" + "a" * 20000 + "</p>")) == 15000


async def test_extract_endpoint_uses_jsonld_lines_and_marks_staples(client, monkeypatch):
    _mock_page(monkeypatch, JSONLD_PAGE)
    seen = []
    _mock_llm(monkeypatch, '```json\n{"ingredients":[{"name":"gehakt","quantity":"250 g","staple":false},'
                           '{"name":"zout","quantity":"","staple":true}]}\n```', seen)
    r = await client.post(_url(), json={"url": RECIPE_URL})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["url"] == RECIPE_URL and body["title"] == "Lasagne"
    assert body["ingredients"] == [
        {"name": "gehakt", "quantity": "250 g", "staple": False},
        {"name": "zout", "quantity": "", "staple": True},
    ]
    user_msg = seen[0]["messages"][-1]["content"]
    assert "1. 250 g gehakt" in user_msg and "2. zout" in user_msg
    assert "Long story" not in user_msg
    assert seen[0]["response_format"] == {"type": "json_object"} and seen[0]["max_tokens"] == 2000


async def test_extract_falls_back_to_page_text_and_llm_title(client, monkeypatch):
    _mock_page(monkeypatch, "<html><title>Tab</title><body><p>2 eieren</p></body></html>")
    seen = []
    _mock_llm(monkeypatch, '{"title":"Omelet","ingredients":[{"name":"eieren","quantity":"2","staple":false}]}', seen)
    r = await client.post(_url(), json={"url": RECIPE_URL})
    assert r.json()["title"] == "Omelet"
    assert "2 eieren" in seen[0]["messages"][-1]["content"]


async def test_extract_title_falls_back_to_html_title_then_host(client, monkeypatch):
    _mock_llm(monkeypatch, '{"ingredients":[{"name":"x","quantity":"","staple":false}]}')
    _mock_page(monkeypatch, "<title>Tab</title><p>x</p>")
    assert (await client.post(_url(), json={"url": RECIPE_URL})).json()["title"] == "Tab"
    _mock_page(monkeypatch, "<p>x</p>")
    assert (await client.post(_url(), json={"url": RECIPE_URL})).json()["title"] == "example.com"


async def test_extract_no_ingredients_found(client, monkeypatch):
    _mock_page(monkeypatch, "<nav>Menu</nav><script>1</script>")
    _mock_llm(monkeypatch, '{"ingredients":[]}')
    r = await client.post(_url(), json={"url": RECIPE_URL})
    assert r.status_code == 422
    assert r.json()["detail"] == "Couldn't find ingredients on that page"


async def test_extract_invalid_llm_json_502(client, monkeypatch):
    _mock_page(monkeypatch, JSONLD_PAGE)
    _mock_llm(monkeypatch, "sorry, no")
    r = await client.post(_url(), json={"url": RECIPE_URL})
    assert r.status_code == 502
    assert r.json()["detail"] == "Couldn't read the ingredients from that page"


async def test_extract_clips_to_60_items(client, monkeypatch):
    _mock_page(monkeypatch, JSONLD_PAGE)
    items = [{"name": f"i{n}", "quantity": "q" * 300, "staple": False} for n in range(80)]
    items.insert(0, {"name": "  ", "quantity": "1", "staple": False})
    items[1]["name"] = "n" * 900
    _mock_llm(monkeypatch, json.dumps({"ingredients": items}))
    out = (await client.post(_url(), json={"url": RECIPE_URL})).json()["ingredients"]
    assert len(out) == 60
    assert len(out[0]["name"]) == 500 and len(out[0]["quantity"]) == 100


async def test_extract_rejects_non_grocery_list(client):
    r = await client.post(_url(OTHER_LIST_ID), json={"url": RECIPE_URL})
    assert r.status_code == 400 and r.json()["detail"] == "Recipes can only be added to grocery lists"


async def test_extract_rejects_archived_and_missing_list(client):
    assert (await client.post(_url(ARCHIVED_ID), json={"url": RECIPE_URL})).status_code == 409
    assert (await client.post(_url("nope"), json={"url": RECIPE_URL})).status_code == 404


async def test_extract_rejects_bad_url(client):
    assert (await client.post(_url(), json={"url": "ftp://x/y"})).status_code == 422


async def test_extract_without_key_fails_before_fetch(client, db_session, monkeypatch):
    await db_session.delete(await db_session.get(HouseholdAiSettings, HOUSEHOLD_ID))
    await db_session.commit()

    async def boom(url, **kw):
        raise AssertionError("must not fetch")

    monkeypatch.setattr(lists_router, "safe_fetch_html", boom)
    r = await client.post(_url(), json={"url": RECIPE_URL})
    assert r.status_code == 400


async def test_extract_fetch_error_422(client, monkeypatch):
    async def fail(url, **kw):
        raise FetchError("That address isn't allowed")

    monkeypatch.setattr(lists_router, "safe_fetch_html", fail)
    r = await client.post(_url(), json={"url": RECIPE_URL})
    assert r.status_code == 422 and r.json()["detail"] == "That address isn't allowed"


async def test_llm_request_has_no_tools(client, monkeypatch):
    _mock_page(monkeypatch, JSONLD_PAGE)
    seen = []
    _mock_llm(monkeypatch, '{"ingredients":[{"name":"x","quantity":"","staple":false}]}', seen)
    await client.post(_url(), json={"url": RECIPE_URL})
    assert "tools" not in seen[0]


def test_valueless_script_type_does_not_crash():
    html = "<script type>x</script><p>hi</p>"
    assert parse(html) is None
    assert recipe_extract.visible_text(html) == "hi"


def test_deeply_nested_jsonld_does_not_crash():
    html = '<script type="application/ld+json">' + "[" * 100000 + "</script>"
    assert parse(html) is None
    graph = '{"@graph":[' * 900 + "{}" + "]}" * 900
    assert parse(f'<script type="application/ld+json">{graph}</script>') is None


async def test_huge_jsonld_lines_are_capped(client, monkeypatch):
    data = {"@type": "Recipe", "name": "Big", "recipeIngredient": ["x" * 1000] * 1000}
    _mock_page(monkeypatch, f'<script type="application/ld+json">{json.dumps(data)}</script>')
    seen = []
    _mock_llm(monkeypatch, '{"ingredients":[{"name":"x","quantity":"","staple":false}]}', seen)
    r = await client.post(_url(), json={"url": RECIPE_URL})
    assert r.status_code == 200
    assert len(seen[0]["messages"][-1]["content"]) <= 15000 + 500


async def test_llm_request_has_privacy_pin(client, monkeypatch):
    _mock_page(monkeypatch, JSONLD_PAGE)
    seen = []
    _mock_llm(monkeypatch, '{"ingredients":[{"name":"x","quantity":"","staple":false}]}', seen)
    await client.post(_url(), json={"url": RECIPE_URL})
    assert seen[0]["provider"] == {"data_collection": "deny"}


async def test_extract_cross_household_404(client):
    url = f"/api/households/{OTHER_HOUSEHOLD_ID}/lists/{GROCERY_ID}/recipes/extract"
    r = await client.post(url, json={"url": RECIPE_URL})
    assert r.status_code == 404
