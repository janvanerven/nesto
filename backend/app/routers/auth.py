from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import decode_token, get_current_user_id
from app.config import settings
from app.database import get_db
from app.schemas.sekura import SekuraConnectionCreate, SekuraConnectionResponse, SekuraTestResponse
from app.schemas.user import UserResponse, UserUpdate
from app.services.sekura_connection_service import (
    delete_sekura_connection,
    get_decrypted_api_key,
    get_sekura_connection,
    save_sekura_connection,
)
from app.services.user_service import update_user, upsert_user

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.get("/me", response_model=UserResponse)
async def get_me(
    token: dict[str, Any] = Depends(decode_token),
    db: AsyncSession = Depends(get_db),
):
    sub = token.get("sub")
    if not sub:
        raise HTTPException(status_code=401, detail="Token missing subject")
    email = token.get("email", "")
    name = token.get("preferred_username", token.get("name", email))
    avatar = token.get("picture")

    user = await upsert_user(db, sub=sub, email=email, name=name, avatar=avatar)
    return user


@router.patch("/me", response_model=UserResponse)
async def update_me(
    body: UserUpdate,
    token: dict[str, Any] = Depends(decode_token),
    db: AsyncSession = Depends(get_db),
):
    sub = token.get("sub")
    if not sub:
        raise HTTPException(status_code=401, detail="Token missing subject")
    return await update_user(db, sub, body)


class TestDigestRequest(BaseModel):
    period: str = "daily"


@router.post("/me/test-digest")
async def test_digest(
    body: TestDigestRequest,
    token: dict[str, Any] = Depends(decode_token),
    db: AsyncSession = Depends(get_db),
):
    if settings.environment != "development":
        raise HTTPException(status_code=404, detail="Not found")
    sub = token.get("sub")
    if not sub:
        raise HTTPException(status_code=401, detail="Token missing subject")
    if body.period not in ("daily", "weekly"):
        raise HTTPException(status_code=400, detail="period must be 'daily' or 'weekly'")

    from app.services.digest_service import send_test_digest
    await send_test_digest(db, sub, body.period)
    return {"status": "sent"}


# ---------------------------------------------------------------------------
# Sekura connection management
# ---------------------------------------------------------------------------

@router.get("/me/sekura", response_model=SekuraConnectionResponse)
async def get_my_sekura(
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    conn = await get_sekura_connection(db, user_id)
    if conn is None:
        return SekuraConnectionResponse(configured=False)
    return SekuraConnectionResponse(configured=True, key_scope=conn.key_scope)


@router.post("/me/sekura", response_model=SekuraConnectionResponse)
async def save_my_sekura(
    body: SekuraConnectionCreate,
    request: Request,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    key_scope = "readwrite"
    sekura = getattr(request.app.state, "sekura", None)
    if sekura is not None:
        ok, error = await sekura.test_connection(body.api_key)
        if not ok:
            raise HTTPException(status_code=400, detail=f"Invalid Sekura API key: {error}")
        key_scope = await sekura.detect_key_scope(body.api_key)

    conn = await save_sekura_connection(db, user_id, body.api_key, key_scope)
    return SekuraConnectionResponse(configured=True, key_scope=conn.key_scope)


@router.delete("/me/sekura")
async def delete_my_sekura(
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    await delete_sekura_connection(db, user_id)
    return {"ok": True}


@router.post("/me/sekura/test", response_model=SekuraTestResponse)
async def test_my_sekura(
    request: Request,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    api_key = await get_decrypted_api_key(db, user_id)
    if api_key is None:
        return SekuraTestResponse(ok=False, error="Sekura not configured")

    sekura = getattr(request.app.state, "sekura", None)
    if sekura is None:
        return SekuraTestResponse(ok=False, error="Sekura not enabled on this server")

    ok, error = await sekura.test_connection(api_key)
    return SekuraTestResponse(ok=ok, error=error)
