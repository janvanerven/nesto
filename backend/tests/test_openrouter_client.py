import json
import logging
import os

os.environ.setdefault("SECRET_KEY", "a" * 64)
os.environ.setdefault("OIDC_ISSUER_URL", "https://auth.example.com")
os.environ.setdefault("OIDC_CLIENT_ID", "test-client")

import httpx
import pytest
from fastapi import HTTPException

from app.services.ai.openrouter import OpenRouterClient

MSGS = [{"role": "user", "content": "hi"}]


def _client(handler, key="sk-or-secret"):
    return OpenRouterClient(key, transport=httpx.MockTransport(handler))


async def test_chat_sends_privacy_pin_and_max_tokens():
    seen = {}

    def handler(request: httpx.Request):
        seen["body"] = json.loads(request.content)
        return httpx.Response(200, json={"choices": [{"message": {"content": "ok"}, "finish_reason": "stop"}]})

    async with _client(handler) as c:
        result = await c.chat(MSGS, model="m/x", max_tokens=500)
    assert result.text == "ok"
    assert seen["body"]["provider"] == {"data_collection": "deny"}
    assert seen["body"]["max_tokens"] == 500
    assert seen["body"]["stream"] is False


async def test_chat_parses_tool_calls():
    def handler(request):
        return httpx.Response(200, json={
            "choices": [{"message": {"content": None, "tool_calls": [
                {"id": "c1", "function": {"name": "add", "arguments": "{\"a\": 1}"}},
            ]}, "finish_reason": "tool_calls"}],
            "usage": {"prompt_tokens": 3, "completion_tokens": 4, "total_tokens": 7},
        })

    async with _client(handler) as c:
        result = await c.chat(MSGS, model="m/x", tools=[{"type": "function"}], max_tokens=10)
    assert result.tool_calls[0].name == "add"
    assert result.tool_calls[0].arguments == {"a": 1}
    assert result.usage.total_tokens == 7


async def test_401_maps_to_400():
    async with _client(lambda r: httpx.Response(401, json={"error": {"message": "bad"}})) as c:
        with pytest.raises(HTTPException) as exc:
            await c.chat(MSGS, model="m/x", max_tokens=10)
    assert exc.value.status_code == 400
    assert exc.value.detail == "OpenRouter rejected the API key"


async def test_402_maps_to_502_with_message():
    async with _client(lambda r: httpx.Response(402, json={"error": {"message": "no credits"}})) as c:
        with pytest.raises(HTTPException) as exc:
            await c.chat(MSGS, model="m/x", max_tokens=10)
    assert exc.value.status_code == 502
    assert "insufficient credits" in exc.value.detail and "no credits" in exc.value.detail


async def test_key_not_in_logs(caplog):
    caplog.set_level(logging.DEBUG)
    async with _client(lambda r: httpx.Response(500, json={"error": {"message": "boom"}})) as c:
        with pytest.raises(HTTPException):
            await c.chat(MSGS, model="m/x", max_tokens=10)
    assert "sk-or-secret" not in caplog.text
