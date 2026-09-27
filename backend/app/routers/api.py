from datetime import datetime, timedelta, timezone
import hashlib
import hmac
import logging
import os
from pathlib import Path
import secrets
from uuid import uuid4

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, Response, UploadFile, status
from fastapi.security import OAuth2PasswordRequestForm
from fastapi.responses import FileResponse
from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.calculations import dose_volume_ml, u100_units
from app.automatic_reminders import sync_automatic_reminders
from app.config import settings
from app.database import get_db
from app.dependencies import current_user
from app.models import BodyMeasurement, Dose, JournalEntry, Medication, PhotoRecord, RefreshSession, TelegramConnection, User, UserProfile, WeightMeasurement
from app.schemas import (AccountOut, BodyMeasurementCreate, BodyMeasurementOut, DoseCreate, DoseOut, JournalEntryCreate,
                         JournalEntryOut, MedicationCreate, MedicationOut, PhotoRecordOut, ProfileOut,
                         PasswordChange, PhotoUpdate, ProfileUpdate, ReminderToggle, Token, UserCreate, WeightCreate, WeightOut)
from app.security import (create_access_token, create_refresh_token, hash_password,
                          hash_refresh_token, verify_password)
from app.telegram import answer_callback_query, connection_status, handle_telegram_command, send_telegram_message

router = APIRouter(prefix="/api")
logger = logging.getLogger(__name__)


def rate_limit_client_address(request: Request) -> str:
    # The API is private behind Nginx, which overwrites X-Real-IP with $remote_addr.
    return request.headers.get("x-real-ip") or get_remote_address(request)


limiter = Limiter(key_func=rate_limit_client_address)


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def utc_datetime(value: datetime | None) -> datetime:
    result = value or utc_now()
    return result.replace(tzinfo=timezone.utc) if result.tzinfo is None else result.astimezone(timezone.utc)


def issue_refresh_session(user: User, response: Response, db: Session) -> None:
    token = create_refresh_token()
    db.add(RefreshSession(
        user_id=user.id,
        token_hash=hash_refresh_token(token),
        expires_at=utc_now() + timedelta(days=settings.refresh_token_days),
    ))
    response.set_cookie(
        "forma_refresh", token, max_age=settings.refresh_token_days * 86400,
        httponly=True, secure=settings.cookie_secure, samesite="strict", path="/api/auth",
        domain=settings.cookie_domain,
    )


def clear_refresh_cookie(response: Response) -> None:
    response.delete_cookie("forma_refresh", httponly=True, secure=settings.cookie_secure,
                           samesite="strict", path="/api/auth", domain=settings.cookie_domain)


def validate_auth_origin(request: Request) -> None:
    origin = request.headers.get("origin")
    allowed = {value.strip() for value in settings.cors_origins.split(",")}
    if origin and origin not in allowed:
        raise HTTPException(status_code=403, detail="Untrusted request origin")


@router.get("/telegram/connection")
def get_telegram_connection(user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict[str, object]:
    return {
        "configured": bool(settings.telegram_bot_token and settings.telegram_webhook_secret and settings.telegram_bot_username),
        "linked": connection_status(db, user.id),
        "bot_username": settings.telegram_bot_username,
    }


@router.post("/telegram/connection")
def create_telegram_pairing(user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict[str, str]:
    if not (settings.telegram_bot_token and settings.telegram_bot_username and settings.telegram_webhook_secret):
        raise HTTPException(
            status_code=503, detail="Telegram notifications are not configured")
    code = secrets.token_urlsafe(18)
    connection = db.scalar(select(TelegramConnection).where(
        TelegramConnection.user_id == user.id))
    if connection is None:
        connection = TelegramConnection(user_id=user.id)
        db.add(connection)
    connection.chat_id = None
    connection.linked_at = None
    connection.pairing_token_hash = hashlib.sha256(code.encode()).hexdigest()
    connection.pairing_expires_at = utc_now() + timedelta(minutes=15)
    db.commit()
    return {
        "start_url": f"https://t.me/{settings.telegram_bot_username}?start={code}",
        "expires_at": connection.pairing_expires_at.isoformat(),
    }


@router.delete("/telegram/connection", status_code=status.HTTP_204_NO_CONTENT)
def delete_telegram_connection(user: User = Depends(current_user), db: Session = Depends(get_db)) -> Response:
    connection = db.scalar(select(TelegramConnection).where(
        TelegramConnection.user_id == user.id))
    if connection is not None:
        db.delete(connection)
        db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/telegram/webhook")
async def telegram_webhook(request: Request, db: Session = Depends(get_db)) -> dict[str, bool]:
    received_secret = request.headers.get(
        "X-Telegram-Bot-Api-Secret-Token", "")
    if not settings.telegram_webhook_secret or not hmac.compare_digest(received_secret, settings.telegram_webhook_secret):
        raise HTTPException(status_code=403, detail="Invalid webhook secret")
    update = await request.json()
    callback = update.get("callback_query") if isinstance(
        update, dict) else None
    if isinstance(callback, dict):
        callback_id = callback.get("id")
        callback_data = callback.get("data")
        message = callback.get("message")
        callback_chat = message.get(
            "chat") if isinstance(message, dict) else None
        parts = callback_data.split(":") if isinstance(
            callback_data, str) else []
        if (isinstance(callback_id, str) and len(parts) == 3 and parts[0] == "done"
                and isinstance(callback_chat, dict) and callback_chat.get("type") == "private"):
            try:
                entry_id, occurrence = int(parts[1]), int(parts[2])
                chat_id = str(callback_chat["id"])
            except (ValueError, KeyError):
                await answer_callback_query(callback_id, "Este botón no es válido.")
                return {"ok": True}
            connection = db.scalar(select(TelegramConnection).where(
                TelegramConnection.chat_id == chat_id))
            if connection is None:
                await answer_callback_query(callback_id, "Este chat no está vinculado a Forma.")
                return {"ok": True}
            entry = db.scalar(select(JournalEntry).where(
                JournalEntry.id == entry_id,
                JournalEntry.module == "reminders",
                JournalEntry.user_id == connection.user_id,
            ))
            if entry is None:
                await answer_callback_query(callback_id, "No se encontró este recordatorio vinculado a tu cuenta.")
                return {"ok": True}
            data = dict(entry.data or {})
            if data.get("last_sent_epoch") != occurrence:
                await answer_callback_query(callback_id, "Este aviso ya venció; revisa el recordatorio más reciente.")
                return {"ok": True}
            if data.get("completed_reminder_epoch") == occurrence:
                await answer_callback_query(callback_id, "Ya quedó marcado como cumplido.")
                return {"ok": True}
            data["completed_reminder_epoch"] = occurrence
            data["completed_at"] = utc_now().isoformat()
            entry.data = data
            db.commit()
            await answer_callback_query(callback_id, "¡Listo! Recordatorio marcado como cumplido.")
        return {"ok": True}

    message = update.get("message") if isinstance(update, dict) else None
    if not isinstance(message, dict):
        return {"ok": True}
    chat = message.get("chat")
    text = message.get("text")
    if not isinstance(chat, dict) or chat.get("type") != "private" or not isinstance(chat.get("id"), (str, int)) or not isinstance(text, str):
        return {"ok": True}
    chat_id = str(chat["id"])
    parts = text.strip().split(maxsplit=1)
    if parts and parts[0].split("@", maxsplit=1)[0] == "/start" and len(parts) == 2:
        code_hash = hashlib.sha256(parts[1].encode()).hexdigest()
        connection = db.scalar(select(TelegramConnection).where(
            TelegramConnection.pairing_token_hash == code_hash))
        if connection is None or connection.pairing_expires_at is None or utc_datetime(connection.pairing_expires_at) <= utc_now():
            await send_telegram_message(chat_id, "El enlace expiró o no es válido. Genera un nuevo enlace desde Forma.")
            return {"ok": True}
        occupied = db.scalar(select(TelegramConnection).where(
            TelegramConnection.chat_id == chat_id, TelegramConnection.user_id != connection.user_id))
        if occupied is not None:
            await send_telegram_message(chat_id, "Esta cuenta de Telegram ya está vinculada a otra cuenta de Forma.")
            return {"ok": True}
        connection.chat_id = chat_id
        connection.linked_at = utc_now()
        connection.pairing_token_hash = None
        connection.pairing_expires_at = None
        db.commit()
        await send_telegram_message(chat_id, "Telegram quedó vinculado. Recibirás aquí tus recordatorios activos de Forma.")
        await send_telegram_message(chat_id, "Escribe /ayuda para registrar peso, dosis, cintura, presión arterial, síntomas o crear un recordatorio desde Telegram.")
    else:
        connection = db.scalar(select(TelegramConnection).where(
            TelegramConnection.chat_id == chat_id))
        if connection is None:
            await send_telegram_message(chat_id, "Este chat no está vinculado a Forma. Inicia la vinculación desde la sección Recordatorios de la app.")
        else:
            await handle_telegram_command(db, connection.user_id, chat_id, text)
    return {"ok": True}


@router.post("/auth/register", response_model=Token, status_code=status.HTTP_201_CREATED)
@limiter.limit("10/minute")
def register(request: Request, response: Response, payload: UserCreate, db: Session = Depends(get_db)) -> Token:
    email = str(payload.email).lower()
    if db.scalar(select(User).where(User.email == email)):
        raise HTTPException(
            status_code=409, detail="An account with this email already exists")
    user = User(email=email, password_hash=hash_password(payload.password))
    db.add(user)
    db.flush()
    db.add(UserProfile(user_id=user.id, timezone=settings.timezone))
    issue_refresh_session(user, response, db)
    db.commit()
    return Token(access_token=create_access_token(str(user.id)))


@router.post("/auth/login", response_model=Token)
@limiter.limit("10/minute")
def login(request: Request, response: Response, form: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)) -> Token:
    user = db.scalar(select(User).where(User.email == form.username.lower()))
    if user is None or not verify_password(form.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Incorrect email or password", headers={
                            "WWW-Authenticate": "Bearer"})
    issue_refresh_session(user, response, db)
    db.commit()
    return Token(access_token=create_access_token(str(user.id)))


@router.post("/auth/refresh", response_model=Token)
def refresh_session(request: Request, response: Response, db: Session = Depends(get_db)) -> Token:
    validate_auth_origin(request)
    token = request.cookies.get("forma_refresh")
    session = db.scalar(select(RefreshSession).where(
        RefreshSession.token_hash == hash_refresh_token(token or "")))
    if session is None or session.revoked_at is not None or utc_datetime(session.expires_at) <= utc_now():
        clear_refresh_cookie(response)
        raise HTTPException(status_code=401, detail="Session expired")
    user = db.get(User, session.user_id)
    if user is None:
        clear_refresh_cookie(response)
        raise HTTPException(status_code=401, detail="Session expired")
    session.revoked_at = utc_now()
    issue_refresh_session(user, response, db)
    db.commit()
    return Token(access_token=create_access_token(str(user.id)))


@router.post("/auth/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(request: Request, response: Response, db: Session = Depends(get_db)) -> Response:
    validate_auth_origin(request)
    token = request.cookies.get("forma_refresh")
    if token:
        session = db.scalar(select(RefreshSession).where(
            RefreshSession.token_hash == hash_refresh_token(token)))
        if session is not None and session.revoked_at is None:
            session.revoked_at = utc_now()
            db.commit()
    clear_refresh_cookie(response)
    response.status_code = status.HTTP_204_NO_CONTENT
    return response


@router.put("/auth/password", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit("5/minute")
def change_password(request: Request, payload: PasswordChange, user: User = Depends(current_user), db: Session = Depends(get_db)) -> Response:
    if not verify_password(payload.current_password, user.password_hash):
        raise HTTPException(
            status_code=400, detail="La contraseña actual no es correcta")
    if payload.current_password == payload.new_password:
        raise HTTPException(
            status_code=422, detail="La nueva contraseña debe ser distinta")
    user.password_hash = hash_password(payload.new_password)
    for session in db.scalars(select(RefreshSession).where(
            RefreshSession.user_id == user.id, RefreshSession.revoked_at.is_(None))).all():
        session.revoked_at = utc_now()
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/account", response_model=AccountOut)
def get_account(user: User = Depends(current_user)) -> User:
    return user


@router.get("/profile", response_model=ProfileOut)
def get_profile(user: User = Depends(current_user), db: Session = Depends(get_db)) -> UserProfile:
    profile = db.scalar(select(UserProfile).where(
        UserProfile.user_id == user.id))
    if profile is None:
        raise HTTPException(status_code=404, detail="Profile not found")
    return profile


@router.put("/profile", response_model=ProfileOut)
def update_profile(payload: ProfileUpdate, user: User = Depends(current_user), db: Session = Depends(get_db)) -> UserProfile:
    profile = db.scalar(select(UserProfile).where(
        UserProfile.user_id == user.id))
    if profile is None:
        profile = UserProfile(user_id=user.id)
        db.add(profile)
    for field, value in payload.model_dump().items():
        setattr(profile, field, value)
    db.commit()
    db.refresh(profile)
    return profile


@router.get("/medications", response_model=list[MedicationOut])
def list_medications(user: User = Depends(current_user), db: Session = Depends(get_db)) -> list[Medication]:
    return list(db.scalars(select(Medication).where(Medication.user_id == user.id).order_by(Medication.created_at.desc())))


@router.post("/medications", response_model=MedicationOut, status_code=201)
def create_medication(payload: MedicationCreate, user: User = Depends(current_user), db: Session = Depends(get_db)) -> Medication:
    medication = Medication(user_id=user.id, **payload.model_dump())
    db.add(medication)
    db.commit()
    db.refresh(medication)
    return medication


@router.put("/medications/{medication_id}", response_model=MedicationOut)
def update_medication(medication_id: int, payload: MedicationCreate, user: User = Depends(current_user), db: Session = Depends(get_db)) -> Medication:
    medication = db.scalar(select(Medication).where(
        Medication.id == medication_id, Medication.user_id == user.id))
    if medication is None:
        raise HTTPException(status_code=404, detail="Medication not found")
    for field, value in payload.model_dump().items():
        setattr(medication, field, value)
    db.commit()
    db.refresh(medication)
    return medication


@router.delete("/medications/{medication_id}", status_code=status.HTTP_204_NO_CONTENT)
def deactivate_medication(medication_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)) -> Response:
    medication = db.scalar(select(Medication).where(
        Medication.id == medication_id, Medication.user_id == user.id))
    if medication is None:
        raise HTTPException(status_code=404, detail="Medication not found")
    medication.active = False
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/weights", response_model=list[WeightOut])
def list_weights(limit: int = Query(default=100, ge=1, le=500), offset: int = Query(default=0, ge=0), user: User = Depends(current_user), db: Session = Depends(get_db)) -> list[WeightMeasurement]:
    statement = select(WeightMeasurement).where(WeightMeasurement.user_id == user.id).order_by(
        WeightMeasurement.measured_at.desc()).offset(offset).limit(limit)
    return list(db.scalars(statement))


@router.post("/weights", response_model=WeightOut, status_code=201)
def create_weight(payload: WeightCreate, user: User = Depends(current_user), db: Session = Depends(get_db)) -> WeightMeasurement:
    weight = WeightMeasurement(user_id=user.id, **payload.model_dump(exclude={"measured_at"}),
                               measured_at=utc_datetime(payload.measured_at))
    db.add(weight)
    db.commit()
    db.refresh(weight)
    return weight


@router.put("/weights/{weight_id}", response_model=WeightOut)
def update_weight(weight_id: int, payload: WeightCreate, user: User = Depends(current_user), db: Session = Depends(get_db)) -> WeightMeasurement:
    weight = db.scalar(select(WeightMeasurement).where(
        WeightMeasurement.id == weight_id, WeightMeasurement.user_id == user.id))
    if weight is None:
        raise HTTPException(status_code=404, detail="Weight record not found")
    for field, value in payload.model_dump(exclude={"measured_at"}).items():
        setattr(weight, field, value)
    weight.measured_at = utc_datetime(payload.measured_at)
    db.commit()
    db.refresh(weight)
    return weight


@router.delete("/weights/{weight_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_weight(weight_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)) -> Response:
    weight = db.scalar(select(WeightMeasurement).where(
        WeightMeasurement.id == weight_id, WeightMeasurement.user_id == user.id))
    if weight is None:
        raise HTTPException(status_code=404, detail="Weight record not found")
    db.delete(weight)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/doses", response_model=list[DoseOut])
def list_doses(limit: int = Query(default=100, ge=1, le=500), offset: int = Query(default=0, ge=0), user: User = Depends(current_user), db: Session = Depends(get_db)) -> list[Dose]:
    statement = select(Dose).join(Medication).where(Medication.user_id == user.id).order_by(
        Dose.administered_at.desc()).offset(offset).limit(limit)
    return list(db.scalars(statement))


@router.post("/doses", response_model=DoseOut, status_code=201)
def create_dose(payload: DoseCreate, user: User = Depends(current_user), db: Session = Depends(get_db)) -> Dose:
    medication = db.scalar(select(Medication).where(
        Medication.id == payload.medication_id, Medication.user_id == user.id, Medication.active.is_(True)))
    if medication is None:
        raise HTTPException(
            status_code=404, detail="Active medication not found")
    volume = dose_volume_ml(
        payload.dose_mg, medication.concentration_mg, medication.concentration_volume_ml)
    units = u100_units(
        volume, medication.units_per_ml) if medication.units_per_ml is not None else None
    dose = Dose(medication_id=medication.id, administered_at=utc_datetime(payload.administered_at), dose_mg=payload.dose_mg,
                calculated_volume_ml=volume, calculated_u100_units=units, injection_site=payload.injection_site, notes=payload.notes)
    db.add(dose)
    db.commit()
    db.refresh(dose)
    return dose


@router.put("/doses/{dose_id}", response_model=DoseOut)
def update_dose(dose_id: int, payload: DoseCreate, user: User = Depends(current_user), db: Session = Depends(get_db)) -> Dose:
    dose = db.scalar(select(Dose).join(Medication).where(
        Dose.id == dose_id, Medication.user_id == user.id))
    if dose is None:
        raise HTTPException(status_code=404, detail="Dose record not found")
    medication = db.scalar(select(Medication).where(
        Medication.id == payload.medication_id, Medication.user_id == user.id))
    if medication is None:
        raise HTTPException(status_code=404, detail="Medication not found")
    volume = dose_volume_ml(
        payload.dose_mg, medication.concentration_mg, medication.concentration_volume_ml)
    dose.medication_id = medication.id
    dose.administered_at = utc_datetime(payload.administered_at)
    dose.dose_mg = payload.dose_mg
    dose.calculated_volume_ml = volume
    dose.calculated_u100_units = u100_units(
        volume, medication.units_per_ml) if medication.units_per_ml is not None else None
    dose.injection_site = payload.injection_site
    dose.notes = payload.notes
    db.commit()
    db.refresh(dose)
    return dose


@router.delete("/doses/{dose_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_dose(dose_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)) -> Response:
    dose = db.scalar(select(Dose).join(Medication).where(
        Dose.id == dose_id, Medication.user_id == user.id))
    if dose is None:
        raise HTTPException(status_code=404, detail="Dose record not found")
    db.delete(dose)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/body-measurements", response_model=list[BodyMeasurementOut])
def list_body_measurements(limit: int = Query(default=100, ge=1, le=500), offset: int = Query(default=0, ge=0), user: User = Depends(current_user), db: Session = Depends(get_db)) -> list[BodyMeasurement]:
    statement = select(BodyMeasurement).where(BodyMeasurement.user_id == user.id).order_by(
        BodyMeasurement.measured_at.desc()).offset(offset).limit(limit)
    return list(db.scalars(statement))


@router.post("/body-measurements", response_model=BodyMeasurementOut, status_code=201)
def create_body_measurement(payload: BodyMeasurementCreate, user: User = Depends(current_user), db: Session = Depends(get_db)) -> BodyMeasurement:
    measurement = BodyMeasurement(user_id=user.id, **payload.model_dump(
        exclude={"measured_at"}), measured_at=utc_datetime(payload.measured_at))
    db.add(measurement)
    db.commit()
    db.refresh(measurement)
    return measurement


@router.put("/body-measurements/{measurement_id}", response_model=BodyMeasurementOut)
def update_body_measurement(measurement_id: int, payload: BodyMeasurementCreate, user: User = Depends(current_user), db: Session = Depends(get_db)) -> BodyMeasurement:
    measurement = db.scalar(select(BodyMeasurement).where(
        BodyMeasurement.id == measurement_id, BodyMeasurement.user_id == user.id))
    if measurement is None:
        raise HTTPException(status_code=404, detail="Measurement not found")
    for field, value in payload.model_dump(exclude={"measured_at"}).items():
        setattr(measurement, field, value)
    measurement.measured_at = utc_datetime(payload.measured_at)
    db.commit()
    db.refresh(measurement)
    return measurement


@router.delete("/body-measurements/{measurement_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_body_measurement(measurement_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)) -> Response:
    measurement = db.scalar(select(BodyMeasurement).where(
        BodyMeasurement.id == measurement_id, BodyMeasurement.user_id == user.id))
    if measurement is None:
        raise HTTPException(status_code=404, detail="Measurement not found")
    db.delete(measurement)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/entries/{module}", response_model=list[JournalEntryOut])
def list_entries(module: str, limit: int = Query(default=100, ge=1, le=500), offset: int = Query(default=0, ge=0), user: User = Depends(current_user), db: Session = Depends(get_db)) -> list[JournalEntry]:
    if module == "reminders":
        sync_automatic_reminders(db, user)
    statement = select(JournalEntry).where(JournalEntry.user_id == user.id,
                                           JournalEntry.module == module).order_by(JournalEntry.occurred_at.desc()).offset(offset).limit(limit)
    return list(db.scalars(statement))


@router.patch("/entries/{entry_id}/enabled", response_model=JournalEntryOut)
def toggle_reminder(entry_id: int, payload: ReminderToggle, user: User = Depends(current_user), db: Session = Depends(get_db)) -> JournalEntry:
    entry = db.scalar(select(JournalEntry).where(
        JournalEntry.id == entry_id, JournalEntry.user_id == user.id,
        JournalEntry.module == "reminders",
    ))
    if entry is None:
        raise HTTPException(status_code=404, detail="Reminder not found")
    data = dict(entry.data or {})
    if payload.enabled and data.get("auto_generated") is True:
        scheduled = data.get("reminder_at")
        scheduled_at = None
        if isinstance(scheduled, str):
            try:
                scheduled_at = datetime.fromisoformat(
                    scheduled.replace("Z", "+00:00"))
                scheduled_at = utc_datetime(scheduled_at)
            except ValueError:
                scheduled_at = None
        if scheduled_at is not None and data.get("last_sent_epoch") == int(scheduled_at.timestamp()):
            raise HTTPException(
                status_code=409, detail="This automatic reminder was already sent; it will be recreated after the next record")
        if scheduled_at is not None and scheduled_at <= utc_now():
            scheduled_at = utc_now() + timedelta(seconds=30)
            data["reminder_at"] = scheduled_at.isoformat()
            entry.occurred_at = scheduled_at
    data["enabled"] = "Sí" if payload.enabled else "No"
    if payload.enabled:
        data.pop("source_missing", None)
    entry.data = data
    db.commit()
    db.refresh(entry)
    return entry


@router.post("/entries", response_model=JournalEntryOut, status_code=status.HTTP_201_CREATED)
def create_entry(payload: JournalEntryCreate, user: User = Depends(current_user), db: Session = Depends(get_db)) -> JournalEntry:
    if payload.module == "reminders" and payload.data.get("auto_generated") is True:
        raise HTTPException(
            status_code=422, detail="Automatic reminder metadata is reserved")
    entry = JournalEntry(user_id=user.id, module=payload.module, occurred_at=utc_datetime(payload.occurred_at),
                         title=payload.title, data=payload.data, notes=payload.notes)
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return entry


@router.put("/entries/{entry_id}", response_model=JournalEntryOut)
def update_entry(entry_id: int, payload: JournalEntryCreate, user: User = Depends(current_user), db: Session = Depends(get_db)) -> JournalEntry:
    entry = db.scalar(select(JournalEntry).where(
        JournalEntry.id == entry_id, JournalEntry.user_id == user.id))
    if entry is None or entry.module != payload.module:
        raise HTTPException(status_code=404, detail="Record not found")
    if entry.module == "reminders" and entry.data and entry.data.get("auto_generated") is True:
        raise HTTPException(
            status_code=409, detail="Automatic reminders can only be enabled or disabled")
    if payload.module == "reminders" and payload.data.get("auto_generated") is True:
        raise HTTPException(
            status_code=422, detail="Automatic reminder metadata is reserved")
    entry.occurred_at = utc_datetime(payload.occurred_at)
    entry.title = payload.title
    entry.data = payload.data
    entry.notes = payload.notes
    db.commit()
    db.refresh(entry)
    return entry


@router.delete("/entries/{entry_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_entry(entry_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)) -> Response:
    entry = db.scalar(select(JournalEntry).where(
        JournalEntry.id == entry_id, JournalEntry.user_id == user.id))
    if entry is None:
        raise HTTPException(status_code=404, detail="Record not found")
    if entry.module == "reminders" and entry.data and entry.data.get("auto_generated") is True:
        raise HTTPException(
            status_code=409, detail="Automatic reminders can be disabled, not deleted")
    db.delete(entry)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/photos", response_model=list[PhotoRecordOut])
def list_photos(user: User = Depends(current_user), db: Session = Depends(get_db)) -> list[PhotoRecord]:
    return list(db.scalars(select(PhotoRecord).where(PhotoRecord.user_id == user.id).order_by(PhotoRecord.taken_at.desc())))


@router.post("/photos", response_model=PhotoRecordOut, status_code=status.HTTP_201_CREATED)
def upload_photo(file: UploadFile = File(...), caption: str | None = Form(default=None), taken_at: datetime | None = Form(default=None),
                 user: User = Depends(current_user), db: Session = Depends(get_db)) -> PhotoRecord:
    extensions = {"image/jpeg": ".jpg",
                  "image/png": ".png", "image/webp": ".webp"}
    if file.content_type not in extensions:
        raise HTTPException(
            status_code=415, detail="Only JPEG, PNG, or WebP images are supported")
    content = file.file.read(10 * 1024 * 1024 + 1)
    if len(content) > 10 * 1024 * 1024:
        raise HTTPException(
            status_code=413, detail="Image must be 10 MB or smaller")
    signature_matches = {
        "image/jpeg": content.startswith(b"\xff\xd8\xff"),
        "image/png": content.startswith(b"\x89PNG\r\n\x1a\n"),
        "image/webp": content.startswith(b"RIFF") and content[8:12] == b"WEBP",
    }
    if not signature_matches[file.content_type]:
        raise HTTPException(
            status_code=415, detail="Image content does not match its media type")
    photo_taken_at = utc_datetime(taken_at)
    if photo_taken_at > utc_now():
        raise HTTPException(
            status_code=422, detail="Photo date cannot be in the future")
    key = f"{uuid4().hex}{extensions[file.content_type]}"
    directory = Path(settings.storage_path) / "photos" / str(user.id)
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(directory, 0o700)
    file_path = directory / key
    try:
        file_path.write_bytes(content)
        os.chmod(file_path, 0o600)
        photo = PhotoRecord(user_id=user.id, file_key=key, content_type=file.content_type,
                            caption=caption, taken_at=photo_taken_at)
        db.add(photo)
        db.commit()
    except Exception:
        db.rollback()
        file_path.unlink(missing_ok=True)
        raise
    db.refresh(photo)
    return photo


@router.put("/photos/{photo_id}", response_model=PhotoRecordOut)
def update_photo(photo_id: int, payload: PhotoUpdate, user: User = Depends(current_user), db: Session = Depends(get_db)) -> PhotoRecord:
    photo = db.scalar(select(PhotoRecord).where(
        PhotoRecord.id == photo_id, PhotoRecord.user_id == user.id))
    if photo is None:
        raise HTTPException(status_code=404, detail="Photo not found")
    photo.caption = payload.caption
    photo.taken_at = utc_datetime(payload.taken_at)
    db.commit()
    db.refresh(photo)
    return photo


@router.get("/photos/{photo_id}/image")
def get_photo(photo_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)) -> FileResponse:
    photo = db.scalar(select(PhotoRecord).where(
        PhotoRecord.id == photo_id, PhotoRecord.user_id == user.id))
    if photo is None:
        raise HTTPException(status_code=404, detail="Photo not found")
    path = Path(settings.storage_path) / "photos" / \
        str(user.id) / photo.file_key
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Photo file not found")
    return FileResponse(path, media_type=photo.content_type, headers={"Cache-Control": "private, no-store"})


@router.delete("/photos/{photo_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_photo(photo_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)) -> Response:
    photo = db.scalar(select(PhotoRecord).where(
        PhotoRecord.id == photo_id, PhotoRecord.user_id == user.id))
    if photo is None:
        raise HTTPException(status_code=404, detail="Photo not found")
    path = Path(settings.storage_path) / "photos" / \
        str(user.id) / photo.file_key
    tombstone = path.with_name(f".{photo.file_key}.deleting")
    moved_file = path.is_file()
    if moved_file:
        os.replace(path, tombstone)
    db.delete(photo)
    try:
        db.commit()
    except Exception:
        db.rollback()
        if moved_file and tombstone.is_file():
            os.replace(tombstone, path)
        raise
    if moved_file:
        try:
            tombstone.unlink(missing_ok=True)
        except OSError:
            logger.warning(
                "Could not remove deleted photo file for record %s", photo_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
