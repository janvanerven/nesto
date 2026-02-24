from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import decode_token
from app.database import get_db
from app.schemas.user import UserResponse
from app.services.user_service import upsert_user

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
