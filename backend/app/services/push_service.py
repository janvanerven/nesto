import asyncio
import json
import logging
import uuid
from datetime import datetime, timezone

from pywebpush import WebPushException, webpush
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import async_session
from app.models.household import HouseholdMember
from app.models.push_subscription import PushSubscription

logger = logging.getLogger(__name__)


def _send_push_sync(
    subscription_info: dict,
    data: str,
    vapid_private_key: str,
    vapid_claims: dict,
) -> None:
    """Synchronous pywebpush send — run via asyncio.to_thread."""
    webpush(
        subscription_info=subscription_info,
        data=data,
        vapid_private_key=vapid_private_key,
        vapid_claims=vapid_claims,
    )


async def send_push_to_user(
    db: AsyncSession,
    user_id: str,
    title: str,
    body: str,
    url: str,
) -> int:
    """Send a push notification to all subscriptions for a user.

    Returns the number of successful sends. Deletes expired (410) subscriptions
    automatically. Caller is responsible for committing the session.
    """
    if not settings.vapid_private_key:
        return 0

    result = await db.execute(
        select(PushSubscription).where(PushSubscription.user_id == user_id)
    )
    subscriptions = result.scalars().all()
    if not subscriptions:
        return 0

    data = json.dumps({"title": title, "body": body, "url": url})
    vapid_claims = {
        "sub": f"mailto:{settings.smtp_from or 'noreply@nesto.app'}"
    }
    sent = 0
    expired_ids = []

    for sub in subscriptions:
        subscription_info = {
            "endpoint": sub.endpoint,
            "keys": {"p256dh": sub.p256dh, "auth": sub.auth},
        }
        try:
            await asyncio.to_thread(
                _send_push_sync,
                subscription_info,
                data,
                settings.vapid_private_key,
                vapid_claims,
            )
            sub.last_used_at = datetime.now(timezone.utc).replace(tzinfo=None)
            sent += 1
            logger.debug("Push sent to user=%s endpoint=%.40s", user_id, sub.endpoint)
        except WebPushException as exc:
            if exc.response is not None and exc.response.status_code == 410:
                logger.info("Push subscription expired for user=%s, removing", user_id)
                expired_ids.append(sub.id)
            else:
                logger.exception("Push send failed for user=%s", user_id)
        except Exception:
            logger.exception("Push send failed for user=%s", user_id)

    if expired_ids:
        await db.execute(
            delete(PushSubscription).where(PushSubscription.id.in_(expired_ids))
        )

    await db.flush()  # persist last_used_at + 410 deletes; caller commits
    return sent


async def send_push_to_users(
    db: AsyncSession,
    user_ids: list[str],
    title: str,
    body: str,
    url: str,
) -> int:
    """Send push notifications to multiple users. Returns total sends."""
    total = 0
    for user_id in user_ids:
        total += await send_push_to_user(db, user_id, title, body, url)
    return total


async def notify_household_new_notice(household_id: str, author_id: str, content_preview: str) -> None:
    """Fire push notifications to all household members except the author.

    Intended to be called as a FastAPI BackgroundTask — opens its own DB session.
    """
    async with async_session() as db:
        result = await db.execute(
            select(HouseholdMember.user_id).where(
                HouseholdMember.household_id == household_id,
                HouseholdMember.user_id != author_id,
            )
        )
        user_ids = [row[0] for row in result.fetchall()]
        if not user_ids:
            return
        sent = await send_push_to_users(
            db,
            user_ids,
            title="New notice",
            body=f"{content_preview[:80]}{'…' if len(content_preview) > 80 else ''}",
            url="/notices",
        )
        await db.commit()
        if sent:
            logger.info("Notice push sent to %d member(s) in household=%s", sent, household_id)
