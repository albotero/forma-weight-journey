from datetime import datetime, timezone

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
