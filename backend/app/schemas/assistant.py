from typing import Literal

from pydantic import BaseModel, Field, model_validator


class AiModelOption(BaseModel):
    id: str
    label: str


class AiSettingsView(BaseModel):
    has_key: bool
    label: str
    model: str
    models: list[AiModelOption]


class AiSettingsUpdate(BaseModel):
    api_key: str | None = Field(default=None, min_length=1)
    model: str | None = Field(default=None, max_length=200)


class AiKeyTestResult(BaseModel):
    ok: bool
    label: str


# --- Home assistant ---

MAX_MESSAGES = 20
MAX_MESSAGE_CHARS = 4000
MAX_TRANSCRIPT_CHARS = 24000


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=MAX_MESSAGE_CHARS)


class AssistantRequest(BaseModel):
    messages: list[ChatMessage] = Field(min_length=1, max_length=MAX_MESSAGES)
    timezone: str = "UTC"

    @model_validator(mode="after")
    def _total_length(self) -> "AssistantRequest":
        if sum(len(m.content) for m in self.messages) > MAX_TRANSCRIPT_CHARS:
            raise ValueError(f"Conversation is too long (max {MAX_TRANSCRIPT_CHARS} characters)")
        return self


class Proposal(BaseModel):
    id: str
    type: Literal[
        "birthday", "task", "event", "list_items", "grocery_list",
        "address", "person", "person_update", "address_update",
    ]
    summary: str
    payload: dict
    list_id: str | None = None
    target_id: str | None = None  # person or address id for person_update/address_update
    replaces: str | None = None


class AssistantResponse(BaseModel):
    reply: str
    assistant_content: str
    proposals: list[Proposal]
