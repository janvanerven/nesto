import html
import logging
import math
from datetime import date, datetime, time, timedelta

import aiosmtplib
from email.message import EmailMessage
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.event import Event
from app.models.household import Household, HouseholdMember
from app.models.task import Task
from app.models.user import User

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Recurrence expansion (server-side port of frontend/src/utils/recurrence.ts)
# ---------------------------------------------------------------------------

def _advance_date(current: datetime, rule: str, interval: int, anchor: datetime) -> datetime:
    if rule == "daily":
        return current + timedelta(days=interval)
    elif rule == "weekly":
        return current + timedelta(weeks=interval)
    elif rule == "monthly":
        anchor_week = math.ceil(anchor.day / 7)
        anchor_dow = anchor.weekday()  # 0=Mon in Python
        # Move forward by interval months
        month = current.month - 1 + interval
        year = current.year + month // 12
        month = month % 12 + 1
        # Find first day of target month
        candidate = current.replace(year=year, month=month, day=1,
                                    hour=anchor.hour, minute=anchor.minute, second=anchor.second)
        # Find first matching weekday
        while candidate.weekday() != anchor_dow:
            candidate += timedelta(days=1)
        # Advance to the correct week
        candidate += timedelta(weeks=anchor_week - 1)
        # If we overflowed the month, skip to next interval (no recursion)
        if candidate.month != month:
            next_month = month + interval
            next_year = year + (next_month - 1) // 12
            next_month = (next_month - 1) % 12 + 1
            candidate = candidate.replace(year=next_year, month=next_month, day=1)
            while candidate.weekday() != anchor_dow:
                candidate += timedelta(days=1)
            candidate += timedelta(weeks=anchor_week - 1)
        return candidate
    elif rule == "yearly":
        # Handle leap year: Feb 29 → Feb 28 in non-leap years
        try:
            return current.replace(year=current.year + interval)
        except ValueError:
            return current.replace(year=current.year + interval, day=28)
    return current


def expand_event_occurrences(
    events: list[Event],
    range_start: datetime,
    range_end: datetime,
) -> list[tuple[Event, datetime, datetime]]:
    occurrences: list[tuple[Event, datetime, datetime]] = []

    for event in events:
        start = event.start_time
        end = event.end_time
        duration = end - start

        if not event.recurrence_rule:
            if end >= range_start and start <= range_end:
                occurrences.append((event, start, end))
            continue

        rec_end_date = event.recurrence_end
        if rec_end_date:
            rec_end = datetime.combine(rec_end_date, time(23, 59, 59))
        else:
            rec_end = range_end
        effective_end = min(rec_end, range_end)
        interval = event.recurrence_interval or 1

        cursor = start
        iterations = 0
        while cursor <= effective_end and iterations < 1000:
            iterations += 1
            occ_end = cursor + duration
            if occ_end >= range_start and cursor <= range_end:
                occurrences.append((event, cursor, occ_end))
            cursor = _advance_date(cursor, event.recurrence_rule, interval, start)

    occurrences.sort(key=lambda x: x[1])
    return occurrences


# ---------------------------------------------------------------------------
# Data gathering
# ---------------------------------------------------------------------------

async def _get_user_households(db: AsyncSession, user_id: str) -> list[Household]:
    result = await db.execute(
        select(Household)
        .join(HouseholdMember, HouseholdMember.household_id == Household.id)
        .where(HouseholdMember.user_id == user_id)
    )
    return list(result.scalars().all())


async def get_daily_digest_data(db: AsyncSession, user_id: str) -> list[dict]:
    """Gather today's events, tasks due today, and yesterday's completions per household."""
    households = await _get_user_households(db, user_id)
    today = date.today()
    yesterday = today - timedelta(days=1)
    day_start = datetime.combine(today, time.min)
    day_end = datetime.combine(today, time.max)
    yesterday_start = datetime.combine(yesterday, time.min)
    yesterday_end = datetime.combine(yesterday, time.max)

    digest_data = []
    for hh in households:
        # Events for today (with recurrence expansion)
        events_result = await db.execute(
            select(Event).where(
                Event.household_id == hh.id,
                (Event.recurrence_rule.isnot(None)) | (
                    (Event.end_time >= day_start) & (Event.start_time <= day_end)
                ),
            )
        )
        all_events = list(events_result.scalars().all())
        today_occurrences = expand_event_occurrences(all_events, day_start, day_end)

        # Tasks due today (not done)
        tasks_result = await db.execute(
            select(Task).where(
                Task.household_id == hh.id,
                Task.due_date == today,
                Task.status != "done",
            )
        )
        tasks_due = list(tasks_result.scalars().all())

        # Yesterday's completions
        completed_result = await db.execute(
            select(Task).where(
                Task.household_id == hh.id,
                (
                    (Task.completed_at >= yesterday_start) & (Task.completed_at <= yesterday_end)
                ) | (
                    (Task.last_completed_at >= yesterday_start) & (Task.last_completed_at <= yesterday_end)
                ),
            )
        )
        completed = list(completed_result.scalars().all())

        if today_occurrences or tasks_due or completed:
            digest_data.append({
                "household": hh,
                "events": today_occurrences,
                "tasks_due": tasks_due,
                "completed": completed,
            })

    return digest_data


async def get_weekly_digest_data(db: AsyncSession, user_id: str) -> list[dict]:
    """Gather upcoming 7 days of events and tasks per household."""
    households = await _get_user_households(db, user_id)
    today = date.today()
    week_end = today + timedelta(days=7)
    range_start = datetime.combine(today, time.min)
    range_end = datetime.combine(week_end, time.max)

    digest_data = []
    for hh in households:
        # Events for the week
        events_result = await db.execute(
            select(Event).where(
                Event.household_id == hh.id,
                (Event.recurrence_rule.isnot(None)) | (
                    (Event.end_time >= range_start) & (Event.start_time <= range_end)
                ),
            )
        )
        all_events = list(events_result.scalars().all())
        week_occurrences = expand_event_occurrences(all_events, range_start, range_end)

        # Tasks due this week (not done)
        tasks_result = await db.execute(
            select(Task).where(
                Task.household_id == hh.id,
                Task.due_date >= today,
                Task.due_date <= week_end,
                Task.status != "done",
            )
        )
        tasks_due = list(tasks_result.scalars().all())

        if week_occurrences or tasks_due:
            digest_data.append({
                "household": hh,
                "events": week_occurrences,
                "tasks_due": tasks_due,
            })

    return digest_data


# ---------------------------------------------------------------------------
# HTML rendering
# ---------------------------------------------------------------------------

_PRIORITY_LABELS = {1: "Urgent", 2: "High", 3: "Normal", 4: "Low"}


def render_digest_html(user: User, digest_data: list[dict], period: str) -> str:
    """Build an inline-styled HTML email body."""
    greeting_name = user.first_name or user.display_name
    if period == "daily":
        title = f"Your daily digest for {date.today().strftime('%A, %B %d')}"
    else:
        start = date.today()
        end = start + timedelta(days=7)
        title = f"Your week ahead: {start.strftime('%b %d')} – {end.strftime('%b %d')}"

    sections_html = ""
    for entry in digest_data:
        hh = entry["household"]
        sections_html += f'<h2 style="color:#6366f1;font-size:18px;margin:24px 0 12px 0;">{_esc(hh.name)}</h2>'

        # Events
        events = entry.get("events", [])
        if events:
            sections_html += '<h3 style="font-size:15px;color:#374151;margin:16px 0 8px 0;">Events</h3>'
            sections_html += '<table style="width:100%;border-collapse:collapse;">'
            for event, occ_start, occ_end in events:
                time_str = occ_start.strftime("%H:%M") + " – " + occ_end.strftime("%H:%M")
                if period == "weekly":
                    time_str = occ_start.strftime("%a %b %d, %H:%M") + " – " + occ_end.strftime("%H:%M")
                sections_html += (
                    f'<tr><td style="padding:4px 8px 4px 0;color:#6b7280;font-size:13px;white-space:nowrap;">{time_str}</td>'
                    f'<td style="padding:4px 0;font-size:14px;">{_esc(event.title)}</td></tr>'
                )
            sections_html += '</table>'

        # Tasks due
        tasks_due = entry.get("tasks_due", [])
        if tasks_due:
            label = "Reminders due today" if period == "daily" else "Reminders due this week"
            sections_html += f'<h3 style="font-size:15px;color:#374151;margin:16px 0 8px 0;">{label}</h3>'
            sections_html += '<ul style="margin:0;padding-left:20px;">'
            for task in tasks_due:
                priority = _PRIORITY_LABELS.get(task.priority, "")
                due_str = ""
                if period == "weekly" and task.due_date:
                    due_str = f' <span style="color:#9ca3af;font-size:12px;">({task.due_date.strftime("%a %b %d")})</span>'
                sections_html += f'<li style="font-size:14px;margin:4px 0;">{_esc(task.title)}{due_str}'
                if priority and task.priority <= 2:
                    sections_html += f' <span style="color:#ef4444;font-size:12px;">({priority})</span>'
                sections_html += '</li>'
            sections_html += '</ul>'

        # Completed (daily only)
        completed = entry.get("completed", [])
        if completed:
            sections_html += '<h3 style="font-size:15px;color:#374151;margin:16px 0 8px 0;">Completed yesterday</h3>'
            sections_html += '<ul style="margin:0;padding-left:20px;">'
            for task in completed:
                sections_html += f'<li style="font-size:14px;margin:4px 0;color:#6b7280;text-decoration:line-through;">{_esc(task.title)}</li>'
            sections_html += '</ul>'

    if not digest_data:
        sections_html = '<p style="color:#6b7280;font-size:14px;">Nothing planned — enjoy your free time!</p>'

    return f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;padding:20px;background:#fafafa;">
  <div style="background:#ffffff;border-radius:12px;padding:24px;border:1px solid #e5e7eb;">
    <h1 style="font-size:22px;color:#111827;margin:0 0 4px 0;">Hi {_esc(greeting_name)},</h1>
    <p style="color:#6b7280;font-size:14px;margin:0 0 16px 0;">{title}</p>
    {sections_html}
    <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0 12px 0;">
    <p style="color:#9ca3af;font-size:12px;margin:0;">Sent by Nesto. Manage your digest preferences in Settings.</p>
  </div>
</body></html>"""


def _esc(text: str) -> str:
    """HTML-escape user content."""
    return html.escape(text)


# ---------------------------------------------------------------------------
# Email sending
# ---------------------------------------------------------------------------

async def send_digest_email(to: str, subject: str, html: str) -> None:
    if not settings.smtp_host:
        logger.warning("SMTP not configured, skipping email to %s", to)
        return

    msg = EmailMessage()
    msg["From"] = settings.smtp_from
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content("Your Nesto digest (view in an HTML-capable email client)")
    msg.add_alternative(html, subtype="html")

    await aiosmtplib.send(
        msg,
        hostname=settings.smtp_host,
        port=settings.smtp_port,
        username=settings.smtp_user or None,
        password=settings.smtp_password or None,
        use_tls=settings.smtp_use_tls,
        start_tls=not settings.smtp_use_tls,
    )
    logger.info("Digest email sent to %s: %s", to, subject)


# ---------------------------------------------------------------------------
# Runner functions
# ---------------------------------------------------------------------------

async def run_daily_digest(db: AsyncSession) -> int:
    """Send daily digest to all opted-in users. Returns count sent."""
    result = await db.execute(
        select(User).where(User.email_digest_daily == True)  # noqa: E712
    )
    users = list(result.scalars().all())
    sent = 0
    for user in users:
        try:
            data = await get_daily_digest_data(db, user.id)
            html = render_digest_html(user, data, "daily")
            subject = f"Nesto daily digest — {date.today().strftime('%A, %b %d')}"
            await send_digest_email(user.email, subject, html)
            sent += 1
        except Exception:
            logger.exception("Failed to send daily digest to %s", user.email)
    return sent


async def run_weekly_digest(db: AsyncSession) -> int:
    """Send weekly digest to all opted-in users. Returns count sent."""
    result = await db.execute(
        select(User).where(User.email_digest_weekly == True)  # noqa: E712
    )
    users = list(result.scalars().all())
    sent = 0
    for user in users:
        try:
            data = await get_weekly_digest_data(db, user.id)
            html = render_digest_html(user, data, "weekly")
            today = date.today()
            end = today + timedelta(days=7)
            subject = f"Nesto weekly digest — {today.strftime('%b %d')} to {end.strftime('%b %d')}"
            await send_digest_email(user.email, subject, html)
            sent += 1
        except Exception:
            logger.exception("Failed to send weekly digest to %s", user.email)
    return sent


async def send_test_digest(db: AsyncSession, user_id: str, period: str = "daily") -> None:
    """Send an immediate test digest for a single user."""
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise ValueError("User not found")

    if period == "daily":
        data = await get_daily_digest_data(db, user_id)
    else:
        data = await get_weekly_digest_data(db, user_id)

    html = render_digest_html(user, data, period)
    subject = f"[TEST] Nesto {period} digest"
    await send_digest_email(user.email, subject, html)
