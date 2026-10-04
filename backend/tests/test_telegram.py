import asyncio
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.automatic_reminders import _next_date
from app.database import Base
from app.models import Dose, JournalEntry, Medication, User
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


def test_telegram_oral_dose_saves_the_explicit_unit(monkeypatch) -> None:
    from app.telegram import handle_telegram_command

    async def fake_send(_chat_id: str, _text: str) -> bool:
        return True

    monkeypatch.setattr("app.telegram.send_telegram_message", fake_send)
    engine = create_engine("sqlite://", poolclass=StaticPool)
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        user = User(email="oral-dose@example.com", password_hash="unused")
        db.add(user)
        db.flush()
        medication = Medication(
            user_id=user.id, name="Vitamina D3", route="oral", is_primary=True)
        other_medication = Medication(
            user_id=user.id, name="Inyectable", concentration_mg=10,
            concentration_volume_ml=0.5, units_per_ml=100, is_primary=False)
        db.add_all([medication, other_medication])
        db.commit()

        asyncio.run(handle_telegram_command(
            db, user.id, "123", "/dosis 2000 UI reposición"))

        dose = db.scalar(select(Dose).where(
            Dose.medication_id == medication.id))
        assert dose is not None
        assert dose.dose_amount == 2000
        assert dose.dose_unit == "UI"
        assert dose.dose_mg is None
        assert dose.calculated_volume_ml is None
        assert dose.calculated_u100_units is None
        assert db.scalar(select(Dose).where(
            Dose.medication_id == other_medication.id)) is None


def test_telegram_reminder_has_snooze_buttons(monkeypatch) -> None:
    from app.telegram import send_reminder_message

    sent: dict[str, object] = {}

    async def fake_request(_method: str, payload: dict[str, object]) -> bool:
        sent.update(payload)
        return True

    monkeypatch.setattr("app.telegram.telegram_request", fake_request)
    scheduled = datetime(2026, 10, 3, 12, 0, tzinfo=timezone.utc)

    assert asyncio.run(send_reminder_message("123", "Recordatorio", scheduled))

    keyboard = sent["reply_markup"]["inline_keyboard"]
    assert keyboard[0][0]["callback_data"] == f"done:{int(scheduled.timestamp())}"
    assert [button["callback_data"] for button in keyboard[1]] == [
        f"snooze:{seconds}:{int(scheduled.timestamp())}"
        for _label, seconds in (("15 min", 900), ("1 h", 3600), ("3 h", 10800))
    ]


def test_automatic_reminder_offsets_use_calendar_time_in_profile_timezone() -> None:
    source = datetime(2026, 3, 7, 17, 30, tzinfo=timezone.utc)
    assert _next_date(source, 1, "day", ZoneInfo("America/New_York")) == datetime(
        2026, 3, 8, 9, 0, tzinfo=timezone.utc)
    assert _next_date(source, 1, "week", ZoneInfo("America/New_York")) == datetime(
        2026, 3, 14, 9, 0, tzinfo=timezone.utc)
    assert _next_date(source, 1, "day", ZoneInfo("America/New_York"), "07:30") == datetime(
        2026, 3, 8, 11, 30, tzinfo=timezone.utc)
    assert _next_date(datetime(2026, 1, 31, 17, 30, tzinfo=timezone.utc), 1, "month", ZoneInfo("UTC")) == datetime(
        2026, 2, 28, 5, 0, tzinfo=timezone.utc)


def test_automatic_reminder_policy_uses_one_week_for_composition() -> None:
    from app.automatic_reminders import AUTO_REMINDERS

    policy = {key: (delay, unit)
              for key, _title, delay, unit in AUTO_REMINDERS}
    assert policy == {
        "dose": (1, "week"),
        "weight": (1, "day"),
        "blood_pressure": (1, "week"),
        "symptoms": (1, "week"),
        "activity": (1, "week"),
        "composition": (1, "week"),
        "measurements": (1, "month"),
    }


def test_automatic_reminder_sources_cover_the_weekly_checklist() -> None:
    from app.automatic_reminders import _latest_sources

    engine = create_engine("sqlite://", poolclass=StaticPool)
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        user = User(email="checklist@example.com", password_hash="unused")
        db.add(user)
        db.flush()
        occurred_at = datetime(2026, 10, 1, tzinfo=timezone.utc)
        entries = [
            JournalEntry(user_id=user.id, module="labs", title="Presión", occurred_at=occurred_at,
                         data={"results": [{"systolic": 120, "diastolic": 80}]}),
            JournalEntry(user_id=user.id, module="symptoms", title="Check-in", occurred_at=occurred_at,
                         data={"appetite": "Sin cambios", "satiety": "Sin cambios", "hydration_l": 2}),
            JournalEntry(user_id=user.id, module="symptoms", title="Síntoma", occurred_at=occurred_at,
                         data={"results": [{"name": "Náuseas"}]}),
            JournalEntry(user_id=user.id, module="activity", title="Actividad", occurred_at=occurred_at,
                         data={"entry_type": "single", "duration_min": 30}),
        ]
        db.add_all(entries)
        db.flush()

        sources = _latest_sources(db, user.id)

        assert sources["blood_pressure"] == (entries[0].id, occurred_at)
        assert sources["symptoms"] == (entries[2].id, occurred_at)
        assert sources["activity"] == (entries[3].id, occurred_at)


def test_automatic_reminders_are_created_before_the_first_record() -> None:
    from app.automatic_reminders import AUTO_REMINDERS, sync_automatic_reminders

    engine = create_engine("sqlite://", poolclass=StaticPool)
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        user = User(email="pending-checklist@example.com",
                    password_hash="unused")
        db.add(user)
        db.flush()
        medication = Medication(user_id=user.id, name="Tratamiento")
        db.add(medication)
        db.commit()

        sync_automatic_reminders(db, user)

        reminders = db.query(JournalEntry).filter_by(
            user_id=user.id, module="reminders").all()
        assert {entry.data["auto_key"] for entry in reminders} == {
            key for key, _title, _delay, _unit in AUTO_REMINDERS
        }
        assert all(entry.data["source_signature"] ==
                   "pending" for entry in reminders)
        assert all(entry.data["enabled"] == "Sí" for entry in reminders)

        medication.active = False
        db.commit()
        sync_automatic_reminders(db, user)
        dose_reminder = db.query(JournalEntry).filter_by(
            user_id=user.id, module="reminders").filter(
                JournalEntry.data["auto_key"].as_string() == "dose").one()
        assert dose_reminder.data["enabled"] == "No"
        assert dose_reminder.data["source_missing"] is True

        medication.active = True
        db.commit()
        sync_automatic_reminders(db, user)
        assert dose_reminder.data["enabled"] == "Sí"
        assert "source_missing" not in dose_reminder.data


def test_retired_symptom_reminders_are_disabled() -> None:
    from app.automatic_reminders import sync_automatic_reminders

    engine = create_engine("sqlite://", poolclass=StaticPool)
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        user = User(email="retired-checklist@example.com",
                    password_hash="unused")
        db.add(user)
        db.flush()
        old_reminders = [
            JournalEntry(
                user_id=user.id,
                module="reminders",
                occurred_at=datetime(2026, 10, 1, tzinfo=timezone.utc),
                title=key,
                data={"auto_generated": True, "auto_key": key, "enabled": "Sí"},
            )
            for key in ("weekly_checkin", "hydration")
        ]
        db.add_all(old_reminders)
        db.commit()

        sync_automatic_reminders(db, user)

        assert all(entry.data["enabled"] == "No" for entry in old_reminders)
        assert all(entry.data["system_disabled_reason"]
                   == "replaced" for entry in old_reminders)
