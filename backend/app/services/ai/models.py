"""Curated list of OpenRouter models the AI assistant may use.

Every entry must support tool calling (verified against
https://openrouter.ai/api/v1/models ``supported_parameters``). The first entry
is the default model; settings reject ids that are not in this list.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class CuratedModel:
    id: str
    label: str
    context_tokens: int
    supports_tools: bool = True


CURATED_MODELS: tuple[CuratedModel, ...] = (
    CuratedModel(id="anthropic/claude-haiku-5.5", label="Claude Haiku 5.5 (fast, cheap)", context_tokens=1_000_000),
    CuratedModel(id="anthropic/claude-sonnet-5.5", label="Claude Sonnet 5.5 (stronger)", context_tokens=1_000_000),
    CuratedModel(id="openai/gpt-6-luna", label="GPT-6 Luna", context_tokens=1_050_000),
    CuratedModel(id="google/gemini-3.8-flash", label="Gemini 3.8 Flash", context_tokens=1_048_576),
    CuratedModel(id="deepseek/deepseek-v4.1-flash", label="DeepSeek V4.1 Flash", context_tokens=1_048_576),
)

DEFAULT_MODEL_ID: str = CURATED_MODELS[0].id

_BY_ID: dict[str, CuratedModel] = {m.id: m for m in CURATED_MODELS}


def is_valid_model(model_id: str) -> bool:
    return model_id in _BY_ID
