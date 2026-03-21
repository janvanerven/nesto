import asyncio
import ipaddress
import logging
import socket
import uuid
from datetime import datetime, timedelta, timezone
from urllib.parse import urlparse

import caldav
from icalendar import Calendar
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.calendar_sync import CalendarConnection, ExternalEvent
from app.services.crypto_service import decrypt_password

logger = logging.getLogger(__name__)

MAX_RAW_ICAL_SIZE = 65536  # 64KB
MAX_EVENT_SIZE = 655360  # 640KB hard limit per event
MAX_CONSECUTIVE_ERRORS = 10
CALDAV_TIMEOUT = 30  # seconds

_BLOCKED_NETWORKS = [
    ipaddress.ip_network("10.0.0.0/8"),
    ipaddress.ip_network("172.16.0.0/12"),
    ipaddress.ip_network("192.168.0.0/16"),
    ipaddress.ip_network("127.0.0.0/8"),
    ipaddress.ip_network("169.254.0.0/16"),
    ipaddress.ip_network("::1/128"),
    ipaddress.ip_network("fc00::/7"),
    ipaddress.ip_network("fe80::/10"),
]


def _validate_url_not_internal(url: str) -> None:
    """Resolve hostname and reject private/internal IP addresses."""
    host = urlparse(url).hostname
    if not host:
        raise ValueError("Invalid URL: no hostname")
    try:
        addr_infos = socket.getaddrinfo(host, None)
    except socket.gaierror:
        raise ValueError(f"Cannot resolve hostname: {host}")
    for addr_info in addr_infos:
        ip = ipaddress.ip_address(addr_info[4][0])
        if any(ip in net for net in _BLOCKED_NETWORKS):
            raise ValueError(f"URL resolves to a private/internal address")


def _sanitize_sync_error(e: Exception) -> str:
    """Return a user-friendly error message without leaking internal details."""
    msg = str(e)
    if "401" in msg or "Unauthorized" in msg:
        return "Authentication failed — check your username and password"
    if "403" in msg or "Forbidden" in msg:
        return "Access denied by the CalDAV server"
    if "404" in msg or "Not Found" in msg:
        return "Calendar not found — check the calendar URL"
    if "timeout" in msg.lower() or "timed out" in msg.lower():
        return "Connection timed out — server may be unreachable"
    if "resolve" in msg.lower() or "getaddrinfo" in msg.lower():
        return "Cannot resolve server hostname"
    if "SSL" in msg or "certificate" in msg.lower():
        return "TLS/SSL error — check the server URL"
    return "Sync failed — check server URL and credentials"


def _parse_vevent(vevent_component, connection_id: str) -> dict | None:
    """Parse an iCalendar VEVENT component into a dict for ExternalEvent."""
    try:
        uid = str(vevent_component.get("uid", ""))
        if not uid:
            return None

        summary = str(vevent_component.get("summary", "Untitled"))
        description = vevent_component.get("description")
        if description:
            description = str(description)

        dtstart = vevent_component.get("dtstart")
        dtend = vevent_component.get("dtend")
        if not dtstart:
            return None

        dtstart_val = dtstart.dt
        all_day = not isinstance(dtstart_val, datetime)

        if all_day:
            start_time = datetime(dtstart_val.year, dtstart_val.month, dtstart_val.day, 0, 0, 0)
            if dtend:
                dtend_val = dtend.dt
                # iCal DTEND for all-day is exclusive, so subtract a day
                end_date = dtend_val - timedelta(days=1)
                end_time = datetime(end_date.year, end_date.month, end_date.day, 23, 59, 59)
            else:
                end_time = datetime(dtstart_val.year, dtstart_val.month, dtstart_val.day, 23, 59, 59)
        else:
            # Normalize to UTC before stripping tzinfo
            if dtstart_val.tzinfo:
                start_time = dtstart_val.astimezone(timezone.utc).replace(tzinfo=None)
            else:
                start_time = dtstart_val
            if dtend:
                dtend_val = dtend.dt
                if dtend_val.tzinfo:
                    end_time = dtend_val.astimezone(timezone.utc).replace(tzinfo=None)
                else:
                    end_time = dtend_val
            else:
                end_time = start_time

        # Extract original timezone (for reference, times are stored as UTC)
        tz = None
        if hasattr(dtstart_val, "tzinfo") and dtstart_val.tzinfo:
            tz = str(dtstart_val.tzinfo)

        # Extract location
        location = vevent_component.get("location")
        if location:
            location = str(location)

        # Extract RRULE
        rrule = vevent_component.get("rrule")
        rrule_str = None
        if rrule:
            rrule_str = rrule.to_ical().decode()

        return {
            "connection_id": connection_id,
            "caldav_uid": uid,
            "title": summary[:500],
            "description": description[:5000] if description else None,
            "start_time": start_time,
            "end_time": end_time,
            "all_day": all_day,
            "location": location[:500] if location else None,
            "recurrence_rule": rrule_str,
            "timezone": tz,
        }
    except Exception as e:
        logger.warning("Failed to parse VEVENT: %s", e)
        return None


def _fetch_events_sync(
    server_url: str, calendar_url: str, username: str, password: str
) -> list[tuple[str, str, str | None]]:
    """Synchronous CalDAV fetch. Returns list of (uid, ical_data, href)."""
    _validate_url_not_internal(server_url)
    _validate_url_not_internal(calendar_url)

    client = caldav.DAVClient(url=server_url, username=username, password=password, timeout=CALDAV_TIMEOUT)
    calendar = caldav.Calendar(client=client, url=calendar_url)

    events = calendar.events()
    result = []
    for event in events:
        ical_data = event.data

        # Skip oversized events to prevent memory exhaustion
        if len(ical_data) > MAX_EVENT_SIZE:
            logger.warning("Skipping oversized event (%d bytes) from %s", len(ical_data), server_url)
            continue

        href = str(event.url) if event.url else None

        # Parse UID from ical data
        try:
            cal = Calendar.from_ical(ical_data)
            for component in cal.walk():
                if component.name == "VEVENT":
                    uid = str(component.get("uid", ""))
                    if uid:
                        result.append((uid, ical_data, href))
                    break
        except Exception as e:
            logger.warning("Failed to parse event from %s: %s", href, e)

    return result


async def sync_connection(db: AsyncSession, connection: CalendarConnection) -> None:
    """Sync a single CalDAV connection."""
    try:
        password = decrypt_password(connection.encrypted_password)
    except Exception:
        connection.error_count += 1
        connection.last_error = "Failed to decrypt password — re-enter your CalDAV password"
        await db.commit()
        return

    try:
        events_data = await asyncio.wait_for(
            asyncio.to_thread(
                _fetch_events_sync,
                connection.server_url,
                connection.calendar_url,
                connection.username,
                password,
            ),
            timeout=120,  # 2-minute async-level deadline
        )
    except asyncio.TimeoutError:
        logger.warning("CalDAV fetch timed out for connection %s", connection.id)
        connection.error_count += 1
        connection.last_error = "Sync timed out — server may be unreachable"
        await db.commit()
        return
    except Exception as e:
        logger.warning("CalDAV fetch failed for connection %s: %s", connection.id, e)
        connection.error_count += 1
        connection.last_error = _sanitize_sync_error(e)
        if connection.error_count >= MAX_CONSECUTIVE_ERRORS:
            connection.enabled = False
            logger.warning("Disabled connection %s after %d errors", connection.id, MAX_CONSECUTIVE_ERRORS)
        await db.commit()
        return

    # Get existing external events for this connection
    existing_result = await db.execute(
        select(ExternalEvent).where(ExternalEvent.connection_id == connection.id)
    )
    existing_by_uid = {e.caldav_uid: e for e in existing_result.scalars().all()}

    seen_uids = set()

    for uid, ical_data, href in events_data:
        seen_uids.add(uid)

        try:
            cal = Calendar.from_ical(ical_data)
        except Exception:
            continue

        for component in cal.walk():
            if component.name != "VEVENT":
                continue

            parsed = _parse_vevent(component, connection.id)
            if not parsed:
                continue

            # Store raw ical if under size limit
            raw_ical = ical_data if len(ical_data) <= MAX_RAW_ICAL_SIZE else None

            if uid in existing_by_uid:
                # Update existing
                ext_event = existing_by_uid[uid]
                for key, value in parsed.items():
                    if key != "connection_id":
                        setattr(ext_event, key, value)
                ext_event.caldav_href = href
                ext_event.raw_ical = raw_ical
            else:
                # Create new
                ext_event = ExternalEvent(
                    id=str(uuid.uuid4()),
                    caldav_href=href,
                    raw_ical=raw_ical,
                    **parsed,
                )
                db.add(ext_event)
            break  # Only process first VEVENT per calendar object

    # Delete events no longer on the server
    for uid, ext_event in existing_by_uid.items():
        if uid not in seen_uids:
            await db.delete(ext_event)

    # Update connection state
    connection.last_synced_at = datetime.now(timezone.utc).replace(tzinfo=None)
    connection.error_count = 0
    connection.last_error = None

    await db.commit()
    logger.info("Synced connection %s: %d events", connection.id, len(seen_uids))


async def validate_caldav_credentials(
    server_url: str, calendar_url: str, username: str, password: str
) -> bool:
    """Test CalDAV credentials. Returns True if valid."""
    def _test():
        _validate_url_not_internal(server_url)
        _validate_url_not_internal(calendar_url)
        client = caldav.DAVClient(url=server_url, username=username, password=password, timeout=CALDAV_TIMEOUT)
        calendar = caldav.Calendar(client=client, url=calendar_url)
        # Try to fetch properties — will raise on bad auth
        calendar.get_properties([caldav.dav.DisplayName()])
        return True

    try:
        return await asyncio.wait_for(asyncio.to_thread(_test), timeout=60)
    except Exception:
        return False
