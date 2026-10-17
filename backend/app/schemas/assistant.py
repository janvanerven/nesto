from pydantic import BaseModel, Field


class AiModelOption(BaseModel):
    id: str
    label: str


class AiSettingsView(BaseModel):
    has_key: bool
    label: str
    model: str
    models: list[AiModelOption]


class AiSettingsUpdate(BaseModel):
    api_key: str | None = Field(default=None, min_length=1, max_length=200)
    model: str | None = Field(default=None, max_length=200)


class AiKeyTestResult(BaseModel):
    ok: bool
    label: str
