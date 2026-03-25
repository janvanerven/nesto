import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, field_validator
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user_id
from app.database import get_db
from app.models.push_subscription import PushSubscription

router = APIRouter(prefix="/api/auth/me/push-subscription", tags=["push"])


class PushSubscriptionCreate(BaseModel):
    endpoint: str
    p256dh: str
    auth: str

    @field_validator('endpoint')
    @classmethod
    def endpoint_must_be_https(cls, v: str) -> str:
        if not v.startswith('https://'):
            raise ValueError('endpoint must be an https:// URL')
        return v


@router.post("", status_code=204)
async def save_push_subscription(
    body: PushSubscriptionCreate,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    """Upsert a push subscription for the current user."""
    result = await db.execute(
        select(PushSubscription).where(
            PushSubscription.user_id == user_id,
            PushSubscription.endpoint == body.endpoint,
        )
    )
    existing = result.scalar_one_or_none()
    if existing:
        existing.p256dh = body.p256dh
        existing.auth = body.auth
    else:
        db.add(PushSubscription(
            id=str(uuid.uuid4()),
            user_id=user_id,
            endpoint=body.endpoint,
            p256dh=body.p256dh,
            auth=body.auth,
        ))
    await db.commit()


@router.delete("", status_code=204)
async def delete_push_subscription(
    endpoint: Annotated[str, Query(description="Push subscription endpoint URL to remove")],
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    """Delete a push subscription by endpoint (passed as ?endpoint=... query parameter)."""
    await db.execute(
        delete(PushSubscription).where(
            PushSubscription.user_id == user_id,
            PushSubscription.endpoint == endpoint,
        )
    )
    await db.commit()
