import calendar
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.models import BodyMeasurement, Dose, JournalEntry, Medication, User, UserProfile, WeightMeasurement

AUTO_REMINDERS: tuple[tuple[str, str, int, str], ...] = (
    ("dose", "Registrar dosis", 7, "week"),
    ("weight", "Registrar peso", 1, "day"),
    ("composition", "Registrar composición corporal", 7, "week"),
    ("measurements", "Registrar medidas corporales", 1, "month"),
)


def _utc(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def _next_date(source: datetime, delay: int, unit: str, zone: ZoneInfo) -> datetime:
    local = _utc(source).astimezone(zone)
    if unit == "day":
        result = local + timedelta(days=delay)
    elif unit == "week":
        result = local + timedelta(weeks=delay)
    else:
        month_index = local.year * 12 + local.month - 1 + delay
        year, zero_month = divmod(month_index, 12)
        month = zero_month + 1
        day = min(local.day, calendar.monthrange(year, month)[1])
        result = local.replace(year=year, month=month, day=day)
    return result.astimezone(timezone.utc)


def _latest_sources(db: Session, user_id: int) -> dict[str, tuple[int, datetime] | None]:
    latest_dose = db.scalar(
        select(Dose)
        .join(Medication, Dose.medication_id == Medication.id)
        .where(Medication.user_id == user_id, Medication.active.is_(True))
        .order_by(Dose.administered_at.desc(), Dose.id.desc())
        .limit(1)
    )
    latest_weight = db.scalar(
        select(WeightMeasurement)
        .where(WeightMeasurement.user_id == user_id)
        .order_by(WeightMeasurement.measured_at.desc(), WeightMeasurement.id.desc())
        .limit(1)
    )
    composition_conditions = [
        getattr(WeightMeasurement, name).is_not(None)
        for name in (
            "body_fat_percent", "fat_free_mass_kg", "subcutaneous_fat_percent",
            "visceral_fat_index", "body_water_percent", "skeletal_muscle_percent",
            "muscle_mass_kg", "bone_mass_kg", "protein_percent", "bmr_kcal", "metabolic_age",
        )
    ]
    latest_composition = db.scalar(
        select(WeightMeasurement)
        .where(WeightMeasurement.user_id == user_id, or_(*composition_conditions))
        .order_by(WeightMeasurement.measured_at.desc(), WeightMeasurement.id.desc())
        .limit(1)
    )
    latest_measurement = db.scalar(
        select(BodyMeasurement)
        .where(BodyMeasurement.user_id == user_id)
        .order_by(BodyMeasurement.measured_at.desc(), BodyMeasurement.id.desc())
        .limit(1)
    )
    return {
        "dose": (latest_dose.id, latest_dose.administered_at) if latest_dose else None,
        "weight": (latest_weight.id, latest_weight.measured_at) if latest_weight else None,
        "composition": (latest_composition.id, latest_composition.measured_at) if latest_composition else None,
        "measurements": (latest_measurement.id, latest_measurement.measured_at) if latest_measurement else None,
    }


def sync_automatic_reminders(db: Session, user: User) -> None:
    # Serialize syncs for one account so parallel page requests cannot create duplicate reminders.
    db.scalar(select(User).where(User.id == user.id).with_for_update())
    profile = db.scalar(select(UserProfile).where(
        UserProfile.user_id == user.id))
    timezone_name = profile.timezone if profile else "America/Bogota"
    try:
        zone = ZoneInfo(timezone_name)
    except (ZoneInfoNotFoundError, ValueError):
        zone = ZoneInfo("UTC")

    sources = _latest_sources(db, user.id)
    existing = db.scalars(
        select(JournalEntry).where(
            JournalEntry.user_id == user.id,
            JournalEntry.module == "reminders",
        )
    ).all()
    auto_entries = {
        str(entry.data.get("auto_key")): entry
        for entry in existing
        if entry.data and entry.data.get("auto_generated") is True
    }
    for key, title, delay, unit in AUTO_REMINDERS:
        source = sources[key]
        reminder = auto_entries.get(key)
        if source is None:
            if reminder is not None and reminder.data.get("enabled") != "No":
                data = dict(reminder.data)
                data["enabled"] = "No"
                data["source_missing"] = True
                reminder.data = data
            continue

        source_id, source_time = source
        source_signature = f"{source_id}:{_utc(source_time).isoformat()}"
        scheduled = _next_date(source_time, delay, unit, zone)
        if reminder is None:
            reminder = JournalEntry(
                user_id=user.id,
                module="reminders",
                occurred_at=scheduled,
                title=title,
                data={
                    "auto_generated": True,
                    "auto_key": key,
                    "source_record_id": source_id,
                    "source_signature": source_signature,
                    "reminder_at": scheduled.isoformat(),
                    "repeat": "No repetir",
                    "enabled": "Sí",
                },
            )
            db.add(reminder)
            continue

        data = dict(reminder.data or {})
        if data.get("source_signature") != source_signature:
            data.update({
                "source_record_id": source_id,
                "source_signature": source_signature,
                "reminder_at": scheduled.isoformat(),
                "repeat": "No repetir",
                "enabled": "Sí",
            })
            data.pop("last_sent_epoch", None)
            data.pop("completed_reminder_epoch", None)
            data.pop("completed_at", None)
            data.pop("source_missing", None)
            reminder.data = data
            reminder.occurred_at = scheduled
        elif data.get("source_missing"):
            data.pop("source_missing", None)
            data["enabled"] = "Sí"
            reminder.data = data
            reminder.occurred_at = scheduled

    db.commit()


def sync_all_automatic_reminders(db: Session) -> None:
    for user in db.scalars(select(User)).all():
        sync_automatic_reminders(db, user)
    db.commit()
