import asyncio
import logging
import os
from contextlib import asynccontextmanager
from datetime import date, datetime

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.database import async_session
from app.routers import auth, events, households, shopping_lists, tasks

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
            now = datetime.now()
            today = now.date()

            # Daily digest: configured hour, minute 0
            if (
                now.hour == settings.digest_daily_hour
                and now.minute == 0
                and _last_daily_sent != today
                and settings.smtp_host
            ):
                logger.info("Running daily digest...")
                from app.services.digest_service import run_daily_digest
                async with async_session() as db:
                    sent = await run_daily_digest(db)
                _last_daily_sent = today
                logger.info("Daily digest complete: %d emails sent", sent)

            # Weekly digest: Sunday at configured hour, minute 0
            if (
                now.weekday() == 6  # Sunday
                and now.hour == settings.digest_weekly_hour
                and now.minute == 0
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


@asynccontextmanager
async def lifespan(app: FastAPI):
    os.makedirs("data", exist_ok=True)
    task = asyncio.create_task(_digest_scheduler_loop())
    logger.info("Digest scheduler started (daily@%02d:00, weekly@Sun %02d:00)",
                settings.digest_daily_hour, settings.digest_weekly_hour)
    yield
    task.cancel()
    try:
        await task
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


@app.get("/api/health")
async def health():
    return {"status": "ok"}
