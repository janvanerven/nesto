from cryptography.fernet import InvalidToken
from fastapi import HTTPException
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.ai_settings import HouseholdAiSettings
from app.schemas.assistant import AiModelOption, AiSettingsView
from app.services import crypto_service
from app.services.ai import openrouter
from app.services.ai.models import CURATED_MODELS, DEFAULT_MODEL_ID, is_valid_model

_NOT_SET_UP = "Assistant isn't set up. Add an OpenRouter key in Settings."
_RE_ENTER = "Assistant key needs to be re-entered in Settings"


def _models() -> list[AiModelOption]:
    return [AiModelOption(id=m.id, label=m.label) for m in CURATED_MODELS]


def _decrypt(row: HouseholdAiSettings) -> str | None:
    try:
        return crypto_service.decrypt_password(row.encrypted_api_key)
    except InvalidToken:
        return None


async def _get_row(db: AsyncSession, household_id: str) -> HouseholdAiSettings | None:
    result = await db.execute(
        select(HouseholdAiSettings).where(HouseholdAiSettings.household_id == household_id)
    )
    return result.scalar_one_or_none()


def _view(row: HouseholdAiSettings | None) -> AiSettingsView:
    if row is None:
        return AiSettingsView(has_key=False, label="", model=DEFAULT_MODEL_ID, models=_models())
    has_key = _decrypt(row) is not None
    return AiSettingsView(
        has_key=has_key,
        label=row.key_label if has_key else "",
        model=row.model,
        models=_models(),
    )


async def get_settings_view(db: AsyncSession, household_id: str) -> AiSettingsView:
    return _view(await _get_row(db, household_id))


def _is_plain_key(api_key: str) -> bool:
    """Printable ASCII, no whitespace/control chars (keeps header injection out of requests)."""
    return bool(api_key) and api_key.isascii() and api_key.isprintable() and not any(c.isspace() for c in api_key)


async def save_settings(
    db: AsyncSession,
    household_id: str,
    user_id: str,
    api_key: str | None,
    model: str | None,
) -> AiSettingsView:
    if model is not None and not is_valid_model(model):
        raise HTTPException(400, "Unknown model")
    if api_key is not None:
        api_key = api_key.strip()
    if api_key is not None and (len(api_key) > 200 or not _is_plain_key(api_key)):
        # Plain 400 (not a 422) so the submitted key is never echoed back.
        raise HTTPException(400, "That doesn't look like an OpenRouter key")
    row = await _get_row(db, household_id)
    if api_key is None and row is None:
        raise HTTPException(400, "Add an API key first")

    if api_key is not None:
        info = await openrouter.check_key(api_key)  # raises before anything is stored
        encrypted = crypto_service.encrypt_password(api_key)
        if row is None:
            row = HouseholdAiSettings(
                household_id=household_id,
                encrypted_api_key=encrypted,
                key_label=info.get("label") or "",
                model=model or DEFAULT_MODEL_ID,
                updated_by=user_id,
            )
            db.add(row)
        else:
            row.encrypted_api_key = encrypted
            row.key_label = info.get("label") or ""
            if model is not None:
                row.model = model
            row.updated_by = user_id
    else:
        if model is not None:
            row.model = model
        row.updated_by = user_id

    await db.commit()
    await db.refresh(row)
    return _view(row)


async def delete_settings(db: AsyncSession, household_id: str) -> None:
    await db.execute(
        delete(HouseholdAiSettings).where(HouseholdAiSettings.household_id == household_id)
    )
    await db.commit()


async def get_key_and_model(db: AsyncSession, household_id: str) -> tuple[str, str]:
    row = await _get_row(db, household_id)
    if row is None:
        raise HTTPException(400, _NOT_SET_UP)
    key = _decrypt(row)
    if key is None:
        raise HTTPException(400, _RE_ENTER)
    return key, row.model
