from fastapi import APIRouter, Depends, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user_id
from app.database import get_db
from app.schemas.assistant import (
    AiKeyTestResult,
    AiSettingsUpdate,
    AiSettingsView,
    AssistantRequest,
    AssistantResponse,
)
from app.services.ai import openrouter, rate_limit
from app.services.ai.assistant import run_assistant
from app.services.ai import settings_service as svc
from app.services.household_service import get_household

router = APIRouter(prefix="/api/households/{household_id}/assistant", tags=["assistant"])


@router.post("", response_model=AssistantResponse)
async def ask_assistant(
    household_id: str,
    body: AssistantRequest,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    await get_household(db, household_id, user_id)
    rate_limit.check_and_count(household_id, user_id)  # once per user turn
    return await run_assistant(db, household_id, user_id, body)


@router.get("/settings", response_model=AiSettingsView)
async def get_settings(
    household_id: str,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    await get_household(db, household_id, user_id)
    return await svc.get_settings_view(db, household_id)


@router.put("/settings", response_model=AiSettingsView)
async def put_settings(
    household_id: str,
    body: AiSettingsUpdate,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    await get_household(db, household_id, user_id)
    return await svc.save_settings(db, household_id, user_id, body.api_key, body.model)


@router.delete("/settings", status_code=204)
async def delete_settings(
    household_id: str,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    await get_household(db, household_id, user_id)
    await svc.delete_settings(db, household_id)
    return Response(status_code=204)


@router.post("/settings/test", response_model=AiKeyTestResult)
async def test_settings(
    household_id: str,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    await get_household(db, household_id, user_id)
    key, _ = await svc.get_key_and_model(db, household_id)
    info = await openrouter.check_key(key)
    return AiKeyTestResult(ok=True, label=info.get("label") or "")
