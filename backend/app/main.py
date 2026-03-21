import asyncio
import logging
import os
from contextlib import asynccontextmanager
from datetime import date, datetime, timezone

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.database import async_session
from app.routers import auth, calendar_sync, documents, events, households, loyalty_cards, shopping_lists, tasks

logger = logging.getLogger(__name__)

# Track last-sent dates to avoid duplicate sends
_last_daily_sent: date | None = None
_last_weekly_sent: date | None = None


async def _digest_scheduler_loop():
    """Background loop that checks once per minute whether to send digests."""
    global _last_daily_sent, _last_weekly_sent
    while True:
        try:
            await asyncio.sleep(60)
            now = datetime.now(timezone.utc)
            today = now.date()

            # Daily digest: configured hour (any minute — dedup by date)
            if (
                now.hour == settings.digest_daily_hour
                and _last_daily_sent != today
                and settings.smtp_host
            ):
                logger.info("Running daily digest...")
                from app.services.digest_service import run_daily_digest
                async with async_session() as db:
                    sent = await run_daily_digest(db)
                _last_daily_sent = today
                logger.info("Daily digest complete: %d emails sent", sent)

            # Weekly digest: Sunday at configured hour (any minute — dedup by date)
            if (
                now.weekday() == 6  # Sunday
                and now.hour == settings.digest_weekly_hour
                and _last_weekly_sent != today
                and settings.smtp_host
            ):
                logger.info("Running weekly digest...")
                from app.services.digest_service import run_weekly_digest
                async with async_session() as db:
                    sent = await run_weekly_digest(db)
                _last_weekly_sent = today
                logger.info("Weekly digest complete: %d emails sent", sent)

        except asyncio.CancelledError:
            break
        except Exception:
            logger.exception("Digest scheduler error")


async def _calendar_sync_loop():
    """Background loop that syncs CalDAV connections every 5 minutes."""
    sync_lock = asyncio.Lock()
    while True:
        try:
            await asyncio.sleep(300)  # 5 minutes
            if sync_lock.locked():
                logger.debug("Calendar sync: previous run still in progress, skipping")
                continue
            async with sync_lock:
                from app.services.calendar_sync_service import sync_connection
                from app.models.calendar_sync import CalendarConnection
                from sqlalchemy import select

                async with async_session() as db:
                    result = await db.execute(
                        select(CalendarConnection).where(CalendarConnection.enabled == True)
                    )
                    connections = result.scalars().all()

                for conn in connections:
                    try:
                        async with async_session() as db:
                            r = await db.execute(
                                select(CalendarConnection).where(CalendarConnection.id == conn.id)
                            )
                            fresh_conn = r.scalar_one_or_none()
                            if fresh_conn and fresh_conn.enabled:
                                await sync_connection(db, fresh_conn)
                    except Exception:
                        logger.exception("Calendar sync error for connection %s", conn.id)

        except asyncio.CancelledError:
            break
        except Exception:
            logger.exception("Calendar sync scheduler error")


@asynccontextmanager
async def lifespan(app: FastAPI):
    os.makedirs("data", exist_ok=True)
    os.makedirs("data/documents", exist_ok=True)
    digest_task = asyncio.create_task(_digest_scheduler_loop())
    sync_task = asyncio.create_task(_calendar_sync_loop())
    logger.info("Digest scheduler started (daily@%02d:00, weekly@Sun %02d:00)",
                settings.digest_daily_hour, settings.digest_weekly_hour)
    logger.info("Calendar sync scheduler started (every 5 minutes)")
    yield
    digest_task.cancel()
    sync_task.cancel()
    try:
        await digest_task
    except asyncio.CancelledError:
        pass
    try:
        await sync_task
    except asyncio.CancelledError:
        pass


app = FastAPI(
    title="Nesto",
    version="0.1.0",
    lifespan=lifespan,
    docs_url="/docs" if settings.environment == "development" else None,
    redoc_url="/redoc" if settings.environment == "development" else None,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)


app.include_router(auth.router)
app.include_router(events.router)
app.include_router(households.router)
app.include_router(shopping_lists.router)
app.include_router(tasks.router)
app.include_router(loyalty_cards.router)
app.include_router(documents.router)
app.include_router(documents.tags_router)
app.include_router(calendar_sync.connections_router)
app.include_router(calendar_sync.external_events_router)
app.include_router(calendar_sync.feed_token_router)
app.include_router(calendar_sync.feed_router)


@app.get("/api/health")
async def health():
    return {"status": "ok"}
