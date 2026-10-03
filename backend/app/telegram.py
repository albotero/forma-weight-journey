import calendar
import logging
import re
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.calculations import dose_volume_ml, u100_units
from app.automatic_reminders import sync_all_automatic_reminders
from app.config import settings
from app.database import SessionLocal
from app.models import (
    BodyMeasurement,
    Dose,
    JournalEntry,
    Medication,
    TelegramConnection,
    UserProfile,
    WeightMeasurement,
)

logger = logging.getLogger(__name__)
TELEGRAM_API = "https://api.telegram.org"


async def telegram_request(method: str, payload: dict[str, object]) -> bool:
    if not settings.telegram_bot_token:
        return False
    url = f"{TELEGRAM_API}/bot{settings.telegram_bot_token}/{method}"
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.post(url, json=payload)
            response.raise_for_status()
            return response.json().get("ok") is True
    except (httpx.HTTPError, ValueError) as error:
        logger.warning("Telegram %s request failed (%s)",
                       method, type(error).__name__)
        return False


async def configure_webhook() -> None:
    if not (settings.telegram_bot_token and settings.telegram_bot_username
            and settings.telegram_webhook_secret and settings.public_app_url):
        return
    await telegram_request("setWebhook", {
        "url": f"{settings.public_app_url.rstrip('/')}/api/telegram/webhook",
        "secret_token": settings.telegram_webhook_secret,
        "allowed_updates": ["message", "callback_query"],
    })


async def send_telegram_message(chat_id: str, text: str) -> bool:
    return await telegram_request("sendMessage", {"chat_id": chat_id, "text": text})


async def send_reminder_message(chat_id: str, text: str, scheduled_at: datetime) -> bool:
    callback_data = f"done:{int(scheduled_at.timestamp())}"
    return await telegram_request("sendMessage", {
        "chat_id": chat_id,
        "text": text,
        "reply_markup": {"inline_keyboard": [[{"text": "✅ Ya lo cumplí", "callback_data": callback_data}]]},
    })


async def send_reminder_followup(chat_id: str, occurrence: int) -> bool:
    callback_data = f"capture:{occurrence}"
    return await telegram_request("sendMessage", {
        "chat_id": chat_id,
        "text": "¿Quieres registrar el dato ahora por este chat?",
        "reply_markup": {"inline_keyboard": [[
            {"text": "Sí, registrar aquí", "callback_data": callback_data},
            {"text": "No, gracias", "callback_data": f"dismiss:{occurrence}"},
        ]]},
    })


async def answer_callback_query(callback_query_id: str, text: str) -> bool:
    return await telegram_request("answerCallbackQuery", {"callback_query_id": callback_query_id, "text": text})


def _decimal(value: str, *, minimum: Decimal, maximum: Decimal) -> Decimal:
    try:
        number = Decimal(value.replace(",", "."))
    except InvalidOperation:
        raise ValueError("Escribe un número válido.") from None
    if not number.is_finite() or number < minimum or number > maximum:
        raise ValueError(f"El valor debe estar entre {minimum} y {maximum}.")
    exponent = number.as_tuple().exponent
    if isinstance(exponent, int) and max(0, -exponent) > 2:
        raise ValueError("Admito como máximo dos decimales.")
    return number


async def handle_telegram_command(db: Session, user_id: int, chat_id: str, text: str) -> None:
    command, _, arguments = text.strip().partition(" ")
    command = command.split("@", maxsplit=1)[0].casefold()
    arguments = arguments.strip()
    if command in {"/ayuda", "/help", "/start"}:
        await send_telegram_message(chat_id, "Puedes registrar datos con estos comandos:\n"
                                    "/peso 82.35 [nota]\n/dosis 2.5 [nota]\n"
                                    "/cintura 90 [nota]\n/sintoma 5 náuseas\n"
                                    "/presion 120/80\n/recordatorio 2026-09-28 08:00 Texto\n\n"
                                    "Usa ✅ Ya lo cumplí en un recordatorio para confirmarlo. "
                                    "Se aceptan solo mensajes privados y comandos explícitos.")
        return

    now = datetime.now(timezone.utc)
    try:
        if command == "/peso":
            value_text, _, notes = arguments.partition(" ")
            value = _decimal(value_text, minimum=Decimal(
                "0.01"), maximum=Decimal("500"))
            db.add(WeightMeasurement(user_id=user_id, measured_at=now, weight_kg=float(value),
                                     source="Telegram", notes=notes.strip() or None))
            reply = f"Peso registrado: {value} kg."
        elif command == "/cintura":
            value_text, _, notes = arguments.partition(" ")
            value = _decimal(value_text, minimum=Decimal(
                "0.01"), maximum=Decimal("300"))
            db.add(BodyMeasurement(user_id=user_id, measured_at=now, waist_cm=float(value),
                                   notes=notes.strip() or None))
            reply = f"Cintura registrada: {value} cm."
        elif command == "/dosis":
            value_text, _, notes = arguments.partition(" ")
            value = _decimal(value_text, minimum=Decimal(
                "0.01"), maximum=Decimal("1000"))
            active_medications = db.scalars(select(Medication).where(
                Medication.user_id == user_id, Medication.active.is_(True))).all()
            if len(active_medications) != 1:
                await send_telegram_message(chat_id, "No pude identificar un único medicamento activo. Configura uno en la app o registra la dosis desde allí para elegirlo explícitamente.")
                return
            medication = active_medications[0]
            volume = dose_volume_ml(
                float(value), medication.concentration_mg, medication.concentration_volume_ml)
            units = u100_units(
                volume, medication.units_per_ml) if medication.units_per_ml is not None else None
            db.add(Dose(medication_id=medication.id, administered_at=now, dose_mg=float(value),
                        calculated_volume_ml=volume, calculated_u100_units=units,
                        notes=notes.strip() or None))
            reply = f"Registro guardado: {value} mg de {medication.name}. Esto solo registra lo que indicaste; no recomienda una dosis."
        elif command == "/sintoma":
            severity_text, separator, title = arguments.partition(" ")
            if not separator or not title.strip():
                raise ValueError("Formato: /sintoma 5 náuseas")
            severity = _decimal(severity_text, minimum=Decimal(
                "0"), maximum=Decimal("10"))
            db.add(JournalEntry(user_id=user_id, module="symptoms", occurred_at=now,
                                title=title.strip()[:160], data={"record_type": "Síntoma", "severity": float(severity)}))
            reply = f"Síntoma registrado con intensidad {severity}/10."
        elif command == "/presion":
            match = re.fullmatch(
                r"\s*(\d+(?:[.,]\d{1,2})?)\s*/\s*(\d+(?:[.,]\d{1,2})?)\s*", arguments)
            if match is None:
                raise ValueError("Formato: /presion 120/80")
            systolic = _decimal(match.group(1), minimum=Decimal(
                "1"), maximum=Decimal("400"))
            diastolic = _decimal(match.group(
                2), minimum=Decimal("1"), maximum=Decimal("400"))
            db.add(JournalEntry(user_id=user_id, module="labs", occurred_at=now,
                                title="Presión arterial", data={"systolic_pressure": float(systolic),
                                                                "diastolic_pressure": float(diastolic)}))
            reply = f"Registro guardado: presión arterial {systolic}/{diastolic} mmHg."
        elif command == "/recordatorio":
            match = re.fullmatch(
                r"(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})\s+(.{1,160})", arguments)
            if match is None:
                raise ValueError(
                    "Formato: /recordatorio AAAA-MM-DD HH:MM texto")
            profile = db.scalar(select(UserProfile).where(
                UserProfile.user_id == user_id))
            try:
                local_zone = ZoneInfo(
                    profile.timezone if profile else settings.timezone)
            except (ZoneInfoNotFoundError, ValueError):
                local_zone = timezone.utc
            local_time = datetime.strptime(
                f"{match.group(1)} {match.group(2)}", "%Y-%m-%d %H:%M").replace(tzinfo=local_zone)
            scheduled = local_time.astimezone(timezone.utc)
            if scheduled <= now:
                raise ValueError(
                    "La fecha del recordatorio debe estar en el futuro.")
            title = match.group(3).strip()
            db.add(JournalEntry(user_id=user_id, module="reminders", occurred_at=scheduled, title=title,
                                data={"reminder_at": scheduled.isoformat(), "repeat": "No repetir", "enabled": "Sí"}))
            reply = f"Recordatorio guardado para {local_time.strftime('%d/%m/%Y %H:%M')} (hora local)."
        else:
            await send_telegram_message(chat_id, "No reconozco ese comando. Escribe /ayuda para ver opciones.")
            return
    except (ValueError, OverflowError) as error:
        await send_telegram_message(chat_id, str(error))
        return

    db.commit()
    await send_telegram_message(chat_id, reply)


def parse_scheduled_at(value: object) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        scheduled = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if scheduled.tzinfo is None:
        scheduled = scheduled.replace(tzinfo=timezone.utc)
    return scheduled.astimezone(timezone.utc)


def next_occurrence(scheduled: datetime, repeat: str, timezone_name: str) -> datetime | None:
    if repeat == "No repetir":
        return None
    try:
        local_timezone = ZoneInfo(timezone_name)
    except (ZoneInfoNotFoundError, ValueError):
        local_timezone = timezone.utc
    local = scheduled.astimezone(local_timezone)
    if repeat == "Diario":
        result = local + timedelta(days=1)
    elif repeat == "Semanal":
        result = local + timedelta(weeks=1)
    elif repeat == "Mensual":
        year = local.year + (local.month == 12)
        month = 1 if local.month == 12 else local.month + 1
        day = min(local.day, calendar.monthrange(year, month)[1])
        result = local.replace(year=year, month=month, day=day)
    else:
        return None
    return result.astimezone(timezone.utc)


def reminder_is_enabled(value: object) -> bool:
    return value is True or (isinstance(value, str) and value.strip().casefold() in {"sí", "si", "true"})


async def dispatch_due_reminders() -> None:
    if not settings.telegram_bot_token:
        return
    now = datetime.now(timezone.utc)
    max_lateness = timedelta(minutes=2)
    due: dict[tuple[int, str, datetime],
              list[tuple[int, str, str | None, str]]] = {}
    with SessionLocal() as db:
        sync_all_automatic_reminders(db)
        entries = db.scalars(select(JournalEntry).where(
            JournalEntry.module == "reminders")).all()
        for entry in entries:
            data = entry.data or {}
            scheduled = parse_scheduled_at(data.get("reminder_at"))
            if (not reminder_is_enabled(data.get("enabled")) or scheduled is None
                    or scheduled > now or now - scheduled > max_lateness):
                continue
            connection = db.scalar(select(TelegramConnection).where(
                TelegramConnection.user_id == entry.user_id,
                TelegramConnection.chat_id.is_not(None),
            ))
            if connection is None or connection.chat_id is None:
                continue
            profile = db.scalar(select(UserProfile).where(
                UserProfile.user_id == entry.user_id))
            zone = profile.timezone if profile else settings.timezone
            group_key = (entry.user_id, connection.chat_id, scheduled)
            due.setdefault(group_key, []).append((
                entry.id,
                entry.title,
                data.get("source_recorded_at") if isinstance(
                    data.get("source_recorded_at"), str) else None,
                zone,
            ))

    for (_user_id, chat_id, scheduled), candidates in due.items():
        occurrence = int(scheduled.timestamp())
        entry_ids: list[int] = []
        message_lines = ["Recordatorios Forma:"]
        with SessionLocal() as db:
            for entry_id, title, source_recorded_at, timezone_name in candidates:
                query = select(JournalEntry).where(JournalEntry.id == entry_id)
                if db.bind is not None and db.bind.dialect.name == "postgresql":
                    query = query.with_for_update(skip_locked=True)
                entry = db.scalar(query)
                if entry is None:
                    continue
                data = dict(entry.data or {})
                if (parse_scheduled_at(data.get("reminder_at")) != scheduled
                        or not reminder_is_enabled(data.get("enabled"))
                        or data.get("last_sent_epoch") == occurrence
                        or now - scheduled > max_lateness):
                    continue
                connection = db.scalar(select(TelegramConnection).where(
                    TelegramConnection.user_id == entry.user_id,
                    TelegramConnection.chat_id == chat_id,
                ))
                if connection is None:
                    continue
                data["last_sent_epoch"] = occurrence
                entry.data = data
                entry_ids.append(entry_id)
                message_lines.append(f"• {title}")
                source_time = parse_scheduled_at(source_recorded_at)
                if source_time is not None:
                    try:
                        local_source_time = source_time.astimezone(
                            ZoneInfo(timezone_name))
                    except (ZoneInfoNotFoundError, ValueError):
                        local_source_time = source_time
                    message_lines.append(
                        f"  Último registro: {local_source_time.strftime('%d/%m/%Y %H:%M')}"
                    )
            if not entry_ids:
                continue
            db.commit()
        if not await send_reminder_message(chat_id, "\n".join(message_lines), scheduled):
            with SessionLocal() as db:
                for entry_id in entry_ids:
                    entry = db.scalar(select(JournalEntry).where(
                        JournalEntry.id == entry_id))
                    if entry is None:
                        continue
                    data = dict(entry.data or {})
                    if data.get("last_sent_epoch") == occurrence:
                        data.pop("last_sent_epoch", None)
                        entry.data = data
                db.commit()
            continue
        with SessionLocal() as db:
            for entry_id in entry_ids:
                entry = db.scalar(select(JournalEntry).where(
                    JournalEntry.id == entry_id))
                if entry is None:
                    continue
                data = dict(entry.data or {})
                if parse_scheduled_at(data.get("reminder_at")) != scheduled:
                    continue
                profile = db.scalar(select(UserProfile).where(
                    UserProfile.user_id == entry.user_id))
                zone = profile.timezone if profile else settings.timezone
                next_time = next_occurrence(scheduled, str(
                    data.get("repeat", "No repetir")), zone)
                if next_time is None:
                    data["enabled"] = "No"
                else:
                    while next_time <= now:
                        following = next_occurrence(next_time, str(
                            data.get("repeat", "No repetir")), zone)
                        if following is None:
                            break
                        next_time = following
                    data["reminder_at"] = next_time.isoformat()
                entry.data = data
                entry.occurred_at = next_time or now
            db.commit()


def connection_status(db: Session, user_id: int) -> bool:
    connection = db.scalar(select(TelegramConnection).where(
        TelegramConnection.user_id == user_id))
    return bool(connection and connection.chat_id)
