import calendar
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.models import BodyMeasurement, Dose, JournalEntry, Medication, User, UserProfile, WeightMeasurement

AUTO_REMINDERS: tuple[tuple[str, str, int, str], ...] = (
    ("dose", "Checklist semanal: dosis registrada", 1, "week"),
    ("weight", "Checklist diario: registrar peso", 1, "day"),
    ("blood_pressure", "Checklist semanal: presión arterial", 1, "week"),
    ("symptoms", "Checklist semanal: síntomas, hidratación y apetito", 1, "week"),
    ("activity", "Checklist semanal: actividad", 1, "week"),
    ("composition", "Checklist mensual: composición corporal", 1, "month"),
    ("measurements", "Checklist mensual: medidas corporales", 1, "month"),
)


def _utc(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def _next_date(source: datetime, delay: int, unit: str, zone: ZoneInfo, reminder_time: str = "05:00") -> datetime:
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
    hour, minute = (int(part) for part in reminder_time.split(":"))
    return result.replace(hour=hour, minute=minute, second=0, microsecond=0).astimezone(timezone.utc)


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
    latest_blood_pressure = None
    latest_symptom_tracking = None
    latest_activity = None
    for entry in db.scalars(
        select(JournalEntry)
        .where(
            JournalEntry.user_id == user_id,
            JournalEntry.module.in_(("labs", "symptoms", "activity")),
        )
        .order_by(JournalEntry.occurred_at.desc(), JournalEntry.id.desc())
    ).all():
        results = entry.data.get("results") if entry.data else None
        if entry.module == "labs" and latest_blood_pressure is None and isinstance(results, list) and any(
            isinstance(result, dict) and result.get("systolic") is not None for result in results
        ):
            latest_blood_pressure = entry
        elif entry.module == "symptoms":
            data = entry.data or {}
            has_checkin = data.get("appetite") is not None and data.get(
                "satiety") is not None
            has_symptoms = (isinstance(results, list) and len(
                results) > 0) or data.get("tolerance") is not None
            has_hydration = data.get("hydration_l") is not None
            if latest_symptom_tracking is None and (has_checkin or has_symptoms or has_hydration):
                latest_symptom_tracking = entry
        elif entry.module == "activity" and latest_activity is None:
            latest_activity = entry
    return {
        "dose": (latest_dose.id, latest_dose.administered_at) if latest_dose else None,
        "weight": (latest_weight.id, latest_weight.measured_at) if latest_weight else None,
        "composition": (latest_composition.id, latest_composition.measured_at) if latest_composition else None,
        "measurements": (latest_measurement.id, latest_measurement.measured_at) if latest_measurement else None,
        "blood_pressure": (latest_blood_pressure.id, latest_blood_pressure.occurred_at) if latest_blood_pressure else None,
        "symptoms": (latest_symptom_tracking.id, latest_symptom_tracking.occurred_at) if latest_symptom_tracking else None,
        "activity": (latest_activity.id, latest_activity.occurred_at) if latest_activity else None,
    }


def sync_automatic_reminders(db: Session, user: User) -> None:
    # Serialize syncs for one account so parallel page requests cannot create duplicate reminders.
    db.scalar(select(User).where(User.id == user.id).with_for_update())
    profile = db.scalar(select(UserProfile).where(
        UserProfile.user_id == user.id))
    timezone_name = profile.timezone if profile else "America/Bogota"
    reminder_time = profile.reminder_time if profile else "05:00"
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
    configured_keys = {key for key, _title, _delay, _unit in AUTO_REMINDERS}
    for key, reminder in auto_entries.items():
        if key in configured_keys:
            continue
        data = dict(reminder.data or {})
        if not data.get("user_disabled"):
            data["enabled"] = "No"
            data["system_disabled_reason"] = "replaced"
        reminder.data = data

    has_active_medication = db.scalar(
        select(Medication.id).where(
            Medication.user_id == user.id,
            Medication.active.is_(True),
        ).limit(1)
    ) is not None
    for key, title, delay, unit in AUTO_REMINDERS:
        source = sources[key]
        reminder = auto_entries.get(key)
        if reminder is not None and reminder.title != title:
            reminder.title = title
        if source is None:
            if reminder is None:
                if key == "dose" and not has_active_medication:
                    continue
                scheduled = _next_date(
                    datetime.now(timezone.utc), delay, unit, zone, reminder_time)
                reminder = JournalEntry(
                    user_id=user.id,
                    module="reminders",
                    occurred_at=scheduled,
                    title=title,
                    data={
                        "auto_generated": True,
                        "auto_key": key,
                        "source_record_id": None,
                        "source_signature": "pending",
                        "source_recorded_at": None,
                        "reminder_at": scheduled.isoformat(),
                        "repeat": "No repetir",
                        "enabled": "Sí",
                    },
                )
                db.add(reminder)
                continue
            data = dict(reminder.data or {})
            if data.get("source_signature") == "pending":
                if key == "dose" and not has_active_medication:
                    if not data.get("source_missing"):
                        data["source_missing"] = True
                        if not data.get("user_disabled"):
                            data["enabled"] = "No"
                            data["system_disabled_reason"] = "source_missing"
                        reminder.data = data
                elif data.get("system_disabled_reason") == "source_missing":
                    data.pop("source_missing", None)
                    data.pop("system_disabled_reason", None)
                    if not data.get("user_disabled"):
                        data["enabled"] = "Sí"
                    scheduled = _next_date(
                        datetime.now(timezone.utc), delay, unit, zone, reminder_time)
                    data["reminder_at"] = scheduled.isoformat()
                    data.pop("last_sent_epoch", None)
                    data.pop("completed_reminder_epoch", None)
                    data.pop("completed_at", None)
                    reminder.data = data
                    reminder.occurred_at = scheduled
                continue
            if reminder is not None:
                data = dict(reminder.data)
                if not data.get("source_missing"):
                    data["source_missing"] = True
                    if not data.get("user_disabled"):
                        data["enabled"] = "No"
                        data["system_disabled_reason"] = "source_missing"
                    reminder.data = data
            continue

        source_id, source_time = source
        source_signature = f"{source_id}:{_utc(source_time).isoformat()}"
        scheduled = _next_date(source_time, delay, unit, zone, reminder_time)
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
                    "source_recorded_at": _utc(source_time).isoformat(),
                    "reminder_at": scheduled.isoformat(),
                    "repeat": "No repetir",
                    "enabled": "Sí",
                },
            )
            db.add(reminder)
            continue

        data = dict(reminder.data or {})
        source_recorded_at = _utc(source_time).isoformat()
        if data.get("source_recorded_at") != source_recorded_at:
            data["source_recorded_at"] = source_recorded_at
            reminder.data = data
        if data.get("source_signature") != source_signature:
            data.update({
                "source_record_id": source_id,
                "source_signature": source_signature,
                "source_recorded_at": _utc(source_time).isoformat(),
                "reminder_at": scheduled.isoformat(),
                "repeat": "No repetir",
                "enabled": "Sí",
            })
            data.pop("last_sent_epoch", None)
            data.pop("completed_reminder_epoch", None)
            data.pop("completed_at", None)
            data.pop("source_missing", None)
            data.pop("schedule_override", None)
            data.pop("user_disabled", None)
            data.pop("system_disabled_reason", None)
            reminder.data = data
            reminder.occurred_at = scheduled
        elif data.get("source_missing"):
            data.pop("source_missing", None)
            stored_at = data.get("reminder_at")
            try:
                stored_at = datetime.fromisoformat(stored_at.replace(
                    "Z", "+00:00")) if isinstance(stored_at, str) else None
            except ValueError:
                stored_at = None
            if stored_at is None or _utc(stored_at) != scheduled:
                data["reminder_at"] = scheduled.isoformat()
                data.pop("last_sent_epoch", None)
                data.pop("completed_reminder_epoch", None)
                data.pop("completed_at", None)
            if data.get("system_disabled_reason") == "source_missing":
                if not data.get("user_disabled"):
                    data["enabled"] = "Sí"
                data.pop("system_disabled_reason", None)
            reminder.data = data
            reminder.occurred_at = scheduled
        elif not data.get("schedule_override"):
            stored_at = data.get("reminder_at")
            try:
                stored_at = datetime.fromisoformat(stored_at.replace(
                    "Z", "+00:00")) if isinstance(stored_at, str) else None
            except ValueError:
                stored_at = None
            if stored_at is None or _utc(stored_at) != scheduled:
                data["reminder_at"] = scheduled.isoformat()
                data.pop("last_sent_epoch", None)
                data.pop("completed_reminder_epoch", None)
                data.pop("completed_at", None)
                reminder.data = data
                reminder.occurred_at = scheduled

    db.commit()


def sync_all_automatic_reminders(db: Session) -> None:
    for user in db.scalars(select(User)).all():
        sync_automatic_reminders(db, user)
    db.commit()
