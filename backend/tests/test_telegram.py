from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from app.automatic_reminders import _next_date
from app.telegram import next_occurrence, parse_scheduled_at, reminder_is_enabled


def test_parse_scheduled_at_normalizes_utc() -> None:
    assert parse_scheduled_at("2025-01-01T12:00:00-05:00") == datetime(
        2025, 1, 1, 17, 0, tzinfo=timezone.utc)


def test_recurring_monthly_reminder_clamps_to_last_day() -> None:
    scheduled = datetime(2025, 1, 31, 15, 30, tzinfo=timezone.utc)
    assert next_occurrence(scheduled, "Mensual", "UTC") == datetime(
        2025, 2, 28, 15, 30, tzinfo=timezone.utc)


def test_reminder_enabled_accepts_form_values() -> None:
    assert reminder_is_enabled("Sí")
    assert reminder_is_enabled(True)
    assert not reminder_is_enabled("No")
    assert not reminder_is_enabled(False)


def test_automatic_reminder_offsets_use_calendar_time_in_profile_timezone() -> None:
    source = datetime(2026, 3, 7, 17, 30, tzinfo=timezone.utc)
    assert _next_date(source, 1, "day", ZoneInfo("America/New_York")) == datetime(
        2026, 3, 8, 16, 30, tzinfo=timezone.utc)
    assert _next_date(source, 1, "week", ZoneInfo("America/New_York")) == datetime(
        2026, 3, 14, 16, 30, tzinfo=timezone.utc)
    assert _next_date(datetime(2026, 1, 31, 17, 30, tzinfo=timezone.utc), 1, "month", ZoneInfo("UTC")) == datetime(
        2026, 2, 28, 17, 30, tzinfo=timezone.utc)


def test_automatic_reminder_policy_uses_one_month_for_composition() -> None:
    from app.automatic_reminders import AUTO_REMINDERS

    policy = {key: (delay, unit)
              for key, _title, delay, unit in AUTO_REMINDERS}
    assert policy == {
        "dose": (1, "week"),
        "weight": (1, "day"),
        "composition": (1, "month"),
        "measurements": (1, "month"),
    }
