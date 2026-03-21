import os

os.environ.setdefault("SECRET_KEY", "a" * 64)
os.environ.setdefault("OIDC_ISSUER_URL", "https://auth.example.com")
os.environ.setdefault("OIDC_CLIENT_ID", "test-client")

from datetime import datetime


def test_event_to_ical_basic():
    from app.services.feed_service import _event_to_vevent

    class FakeEvent:
        id = "event-1"
        title = "Team standup"
        description = "Daily sync"
        start_time = datetime(2026, 3, 21, 9, 0)
        end_time = datetime(2026, 3, 21, 9, 30)
        all_day = False
        recurrence_rule = None
        recurrence_interval = 1
        recurrence_end = None

    vevent = _event_to_vevent(FakeEvent())
    ical_str = vevent.to_ical().decode()

    assert "Team standup" in ical_str
    assert "event-1@nesto" in ical_str
    assert "DTSTART" in ical_str


def test_event_to_ical_recurring():
    from app.services.feed_service import _event_to_vevent
    from datetime import date

    class FakeEvent:
        id = "event-2"
        title = "Weekly review"
        description = None
        start_time = datetime(2026, 3, 21, 14, 0)
        end_time = datetime(2026, 3, 21, 15, 0)
        all_day = False
        recurrence_rule = "weekly"
        recurrence_interval = 1
        recurrence_end = date(2026, 6, 1)

    vevent = _event_to_vevent(FakeEvent())
    ical_str = vevent.to_ical().decode()

    assert "RRULE:FREQ=WEEKLY" in ical_str
    assert "UNTIL=" in ical_str


def test_event_to_ical_allday():
    from app.services.feed_service import _event_to_vevent

    class FakeEvent:
        id = "event-3"
        title = "Holiday"
        description = None
        start_time = datetime(2026, 3, 21, 0, 0)
        end_time = datetime(2026, 3, 21, 23, 59, 59)
        all_day = True
        recurrence_rule = None
        recurrence_interval = 1
        recurrence_end = None

    vevent = _event_to_vevent(FakeEvent())
    ical_str = vevent.to_ical().decode()

    assert "Holiday" in ical_str
