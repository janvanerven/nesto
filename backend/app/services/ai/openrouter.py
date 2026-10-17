"""Async OpenRouter client (OpenAI-compatible chat completions with tool calling).

Design: docs/superpowers/specs/2026-10-17-ai-assistant-design.md.

Every chat request pins ``provider.data_collection = "deny"`` — this is the
privacy control the user selected and must never be dropped, even if
OpenRouter answers that no provider is available under that constraint.

The API key is never logged; failures are logged at warning level with the
HTTP status and the provider's message only.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from typing import Any

import httpx

from fastapi import HTTPException

logger = logging.getLogger(__name__)

BASE_URL = "https://openrouter.ai/api/v1"
TIMEOUT_SECONDS = 90.0
_REFERER = "https://github.com/janvanerven/nesto"
_TITLE = "Nesto"

# Privacy pin sent with every chat request (spec §4). Never relaxed.
_PROVIDER_PIN: dict[str, Any] = {"data_collection": "deny"}

# Substrings (lower-cased) in a 404 error message that indicate OpenRouter
# found no provider/endpoint for the model under our provider constraints.
_NO_PROVIDER_MARKERS = (
    "no endpoints",
    "no providers",
    "no allowed providers",
    "data policy",
    "no provider",
)


def _headers(api_key: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {api_key}",
        "HTTP-Referer": _REFERER,
        "X-Title": _TITLE,
    }


async def check_key(api_key: str, *, transport: httpx.AsyncBaseTransport | None = None) -> dict:
    """Validate an OpenRouter key via ``GET /key``.

    Returns ``{"label": str, "limit_remaining": float | None, "usage": float | None}``.
    Raises ``HTTPException`` 400 on 401/403 and 502 for other failures.
    ``transport`` is for tests only (``httpx.MockTransport``).
    """
    try:
        async with httpx.AsyncClient(timeout=15.0, transport=transport) as client:
            resp = await client.get(f"{BASE_URL}/key", headers=_headers(api_key))
    except httpx.RequestError as exc:
        logger.warning("Cannot reach OpenRouter: %s", exc)
        raise HTTPException(502, "Cannot reach OpenRouter")
    if resp.status_code in (401, 403):
        raise HTTPException(400, "OpenRouter rejected the API key")
    if resp.status_code >= 400:
        raise HTTPException(502, f"OpenRouter returned HTTP {resp.status_code}")
    data = resp.json().get("data", {}) if isinstance(resp.json(), dict) else {}
    return {
        "label": data.get("label") or "",
        "limit_remaining": data.get("limit_remaining"),
        "usage": data.get("usage"),
    }


# --------------------------------------------------------------------------
# Result types
# --------------------------------------------------------------------------


@dataclass
class Usage:
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0

    @classmethod
    def from_dict(cls, data: Any) -> Usage:
        if not isinstance(data, dict):
            return cls()
        return cls(
            prompt_tokens=_as_int(data.get("prompt_tokens")),
            completion_tokens=_as_int(data.get("completion_tokens")),
            total_tokens=_as_int(data.get("total_tokens")),
        )


@dataclass
class ToolCall:
    id: str
    name: str
    arguments: dict
    """Parsed JSON arguments. ``{}`` when the model emitted invalid JSON."""
    raw_arguments: str = ""
    """The raw argument string exactly as the model emitted it."""


@dataclass
class ChatResult:
    text: str
    tool_calls: list[ToolCall] = field(default_factory=list)
    usage: Usage = field(default_factory=Usage)
    finish_reason: str | None = None


def _as_int(value: Any) -> int:
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


def _parse_arguments(name: str, raw: Any) -> tuple[dict, str]:
    """Return ``(parsed_dict, raw_string)`` for a tool-call argument payload."""
    if isinstance(raw, dict):
        return raw, json.dumps(raw)
    raw_str = "" if raw is None else str(raw)
    if not raw_str.strip():
        return {}, raw_str
    try:
        parsed = json.loads(raw_str)
    except ValueError:
        logger.warning("Tool call %r has invalid JSON arguments; using {}", name)
        return {}, raw_str
    if not isinstance(parsed, dict):
        logger.warning("Tool call %r arguments are not a JSON object; using {}", name)
        return {}, raw_str
    return parsed, raw_str


def _make_tool_call(entry: dict) -> ToolCall:
    fn = entry.get("function") or {}
    name = str(fn.get("name") or "")
    arguments, raw = _parse_arguments(name, fn.get("arguments"))
    return ToolCall(id=str(entry.get("id") or ""), name=name, arguments=arguments, raw_arguments=raw)


# --------------------------------------------------------------------------
# Error mapping
# --------------------------------------------------------------------------


def _extract_error_message(payload: Any) -> str:
    """Pull the provider message out of ``{"error": {"message": ...}}`` (or variants)."""
    if isinstance(payload, dict):
        err = payload.get("error")
        if isinstance(err, dict):
            msg = err.get("message")
            if msg:
                return str(msg)
            return json.dumps(err)
        if isinstance(err, str) and err:
            return err
        msg = payload.get("message")
        if msg:
            return str(msg)
    return ""


def _error_message_from_body(body: bytes) -> str:
    try:
        payload = json.loads(body or b"")
    except ValueError:
        text = body.decode("utf-8", "replace").strip() if body else ""
        return text[:300]
    return _extract_error_message(payload)


def _map_http_error(status: int, message: str, *, model: str) -> HTTPException:
    """Translate an OpenRouter HTTP error status into the app error hierarchy."""
    logger.warning("OpenRouter request failed: HTTP %s %s", status, message or "(no message)")
    detail_suffix = f": {message}" if message else ""
    if status in (401, 403):
        return HTTPException(400, "OpenRouter rejected the API key")
    if status == 402:
        return HTTPException(502, f"OpenRouter: payment required / insufficient credits{detail_suffix}")
    if status == 429:
        return HTTPException(502, f"OpenRouter: rate limited{detail_suffix}")
    if status == 404 and any(marker in message.lower() for marker in _NO_PROVIDER_MARKERS):
        return HTTPException(
            502,
            f"No OpenRouter provider serves model '{model}' with data collection denied "
            f"(your privacy setting). Nesto does not relax this setting; choose a different "
            f"model{detail_suffix}"
        )
    return HTTPException(502, f"OpenRouter returned HTTP {status}{detail_suffix}")


def _map_envelope_error(payload: dict, *, model: str) -> HTTPException:
    """Map an ``{"error": ...}`` chunk that arrived in a 200 response."""
    err = payload.get("error")
    message = _extract_error_message(payload)
    code = err.get("code") if isinstance(err, dict) else None
    status = _as_int(code) if isinstance(code, (int, str)) and str(code).isdigit() else 0
    if status >= 400:
        return _map_http_error(status, message, model=model)
    logger.warning("OpenRouter error envelope: %s", message or "(no message)")
    return HTTPException(502, f"OpenRouter error: {message}" if message else "OpenRouter error")


# --------------------------------------------------------------------------
# Client
# --------------------------------------------------------------------------


class OpenRouterClient:
    """Thin async client for OpenRouter chat completions.

    Use as an async context manager or call :meth:`aclose` when done.
    """

    def __init__(
        self,
        api_key: str,
        *,
        base_url: str = BASE_URL,
        timeout: float = TIMEOUT_SECONDS,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._client = httpx.AsyncClient(
            timeout=timeout,
            headers=_headers(api_key),
            transport=transport,
        )

    async def __aenter__(self) -> OpenRouterClient:
        return self

    async def __aexit__(self, *exc_info: object) -> None:
        await self.aclose()

    async def aclose(self) -> None:
        await self._client.aclose()

    # -- request building --------------------------------------------------

    @staticmethod
    def _build_body(
        messages: list[dict],
        *,
        model: str,
        tools: list[dict] | None,
        max_tokens: int,
        response_format: dict | None,
    ) -> dict[str, Any]:
        body: dict[str, Any] = {
            "model": model,
            "messages": messages,
            "stream": False,
            "max_tokens": max_tokens,
            "provider": dict(_PROVIDER_PIN),
        }
        if tools:
            body["tools"] = tools
            body["tool_choice"] = "auto"
        if response_format is not None:
            body["response_format"] = response_format
        return body

    # -- public API --------------------------------------------------------

    async def chat(
        self,
        messages: list[dict],
        *,
        model: str,
        tools: list[dict] | None = None,
        max_tokens: int,
        response_format: dict | None = None,
    ) -> ChatResult:
        """Run one chat completion and return the assembled result."""
        body = self._build_body(
            messages, model=model, tools=tools,
            max_tokens=max_tokens, response_format=response_format,
        )
        url = f"{self._base_url}/chat/completions"
        try:
            return await self._chat_once(url, body, model=model)
        except httpx.TimeoutException as exc:
            logger.warning("OpenRouter request timed out: %s", exc)
            raise HTTPException(502, "OpenRouter request timed out")
        except httpx.RequestError as exc:
            logger.warning("Cannot reach OpenRouter: %s", exc)
            raise HTTPException(502, "Cannot reach OpenRouter")

    async def _chat_once(self, url: str, body: dict, *, model: str) -> ChatResult:
        resp = await self._client.post(url, json=body)
        if resp.status_code >= 400:
            raise _map_http_error(resp.status_code, _error_message_from_body(resp.content), model=model)
        try:
            payload = resp.json()
        except ValueError:
            logger.warning("OpenRouter returned a non-JSON body")
            raise HTTPException(502, "OpenRouter returned an unreadable response")
        if not isinstance(payload, dict):
            raise HTTPException(502, "OpenRouter returned an unreadable response")
        if "error" in payload and not payload.get("choices"):
            # OpenRouter can return HTTP 200 with an error envelope for some upstream failures.
            raise _map_envelope_error(payload, model=model)
        choices = payload.get("choices") or []
        choice = choices[0] if choices and isinstance(choices[0], dict) else {}
        message = choice.get("message") or {}
        text = message.get("content") or ""
        if not isinstance(text, str):
            text = _flatten_content(text)
        tool_calls = [
            _make_tool_call(tc) for tc in (message.get("tool_calls") or []) if isinstance(tc, dict)
        ]
        return ChatResult(
            text=text,
            tool_calls=tool_calls,
            usage=Usage.from_dict(payload.get("usage")),
            finish_reason=choice.get("finish_reason"),
        )


def _flatten_content(content: Any) -> str:
    """Collapse OpenAI "content parts" (list of ``{"type": "text", "text": ...}``) into a string."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for part in content:
            if isinstance(part, dict) and part.get("type") == "text":
                parts.append(str(part.get("text") or ""))
            elif isinstance(part, str):
                parts.append(part)
        return "".join(parts)
    return ""
