import logging
import uuid
from datetime import date, datetime, timedelta, timezone

from email.message import EmailMessage

import aiosmtplib
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.event import Event
from app.models.household import HouseholdMember
from app.models.reminder_sent import ReminderSent
from app.models.task import Task
from app.models.user import User

logger = logging.getLogger(__name__)


async def _already_sent(db: AsyncSession, entity_type: str, entity_id: str,
                        occurrence_date: date, channel: str = "email") -> bool:
    result = await db.execute(
        select(ReminderSent).where(
            ReminderSent.entity_type == entity_type,
            ReminderSent.entity_id == entity_id,
            ReminderSent.occurrence_date == occurrence_date,
            ReminderSent.channel == channel,
        )
    )
    return result.scalar_one_or_none() is not None


async def _record_sent(db: AsyncSession, entity_type: str, entity_id: str,
                       occurrence_date: date, channel: str = "email") -> None:
    db.add(ReminderSent(
        id=str(uuid.uuid4()),
        entity_type=entity_type,
        entity_id=entity_id,
        occurrence_date=occurrence_date,
        channel=channel,
    ))
    await db.commit()


async def _send_email(to: str, subject: str, body: str) -> None:
    msg = EmailMessage()
    msg["From"] = settings.smtp_from or settings.smtp_user or "nesto@localhost"
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content(body)

    await aiosmtplib.send(
        msg,
        hostname=settings.smtp_host,
        port=settings.smtp_port,
        username=settings.smtp_user or None,
        password=settings.smtp_password or None,
        use_tls=settings.smtp_use_tls,
    )


async def _get_user(db: AsyncSession, user_id: str) -> User | None:
    result = await db.execute(select(User).where(User.id == user_id))
    return result.scalar_one_or_none()


async def run_task_reminders(db: AsyncSession) -> int:
    """Send morning-of email reminders for tasks due today. Returns count sent."""
    if not settings.smtp_host:
        return 0

    today = date.today()
    sent = 0

    result = await db.execute(
        select(Task).where(
            Task.due_date == today,
            Task.status != "done",
        )
    )
    tasks = result.scalars().all()

    for task in tasks:
        if await _already_sent(db, "task", task.id, today):
            continue

        recipient_id = task.assigned_to or task.created_by
        user = await _get_user(db, recipient_id)
        if not user or not user.reminders_tasks:
            await _record_sent(db, "task", task.id, today)  # skip, don't retry
            continue

        await _record_sent(db, "task", task.id, today)  # stamp before send
        try:
            await _send_email(
                to=user.email,
                subject=f"Reminder: {task.title}",
                body=(
                    f"Hi {user.first_name or user.display_name},\n\n"
                    f"This is a reminder that '{task.title}' is due today.\n\n"
                    f"— Nesto"
                ),
            )
            sent += 1
            logger.info("Task reminder sent: task=%s user=%s", task.id, user.email)
        except Exception:
            logger.exception("Failed to send task reminder for task %s", task.id)

    return sent


async def run_event_reminders(db: AsyncSession) -> int:
    """Send ~1-hour-before email reminders for upcoming events. Returns count sent."""
    if not settings.smtp_host:
        return 0

    now = datetime.now(timezone.utc).replace(tzinfo=None)  # naive UTC to match DB
    window_start = now + timedelta(minutes=45)
    window_end = now + timedelta(minutes=75)
    sent = 0

    result = await db.execute(
        select(Event).where(
            Event.start_time >= window_start,
            Event.start_time <= window_end,
        )
    )
    events = result.scalars().all()

    for event in events:
        occurrence_date = event.start_time.date()
        if await _already_sent(db, "event", event.id, occurrence_date):
            continue

        members_result = await db.execute(
            select(User).join(
                HouseholdMember,
                HouseholdMember.user_id == User.id,
            ).where(
                HouseholdMember.household_id == event.household_id,
                User.reminders_events.is_(True),
            )
        )
        users = members_result.scalars().all()

        await _record_sent(db, "event", event.id, occurrence_date)  # stamp before sends

        for user in users:
            try:
                start_local = event.start_time.strftime("%H:%M")
                await _send_email(
                    to=user.email,
                    subject=f"Starting soon: {event.title}",
                    body=(
                        f"Hi {user.first_name or user.display_name},\n\n"
                        f"'{event.title}' starts at {start_local} today.\n\n"
                        f"— Nesto"
                    ),
                )
                sent += 1
                logger.info("Event reminder sent: event=%s user=%s", event.id, user.email)
            except Exception:
                logger.exception("Failed to send event reminder for event %s to %s", event.id, user.email)

    return sent


async def run_reminders(db: AsyncSession) -> int:
    """Run all reminder types. Called by the scheduler every 15 minutes."""
    task_count = await run_task_reminders(db)
    event_count = await run_event_reminders(db)
    return task_count + event_count


async def cleanup_old_reminders(db: AsyncSession, days: int = 30) -> None:
    """Delete reminder records older than `days` days."""
    cutoff = date.today() - timedelta(days=days)
    await db.execute(
        delete(ReminderSent).where(ReminderSent.occurrence_date < cutoff)
    )
    await db.commit()
