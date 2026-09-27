from datetime import datetime, timedelta, timezone
import os
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, Response, UploadFile, status
from fastapi.security import OAuth2PasswordRequestForm
from fastapi.responses import FileResponse
from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.calculations import dose_volume_ml, u100_units
from app.config import settings
from app.database import get_db
from app.dependencies import current_user
from app.models import BodyMeasurement, Dose, JournalEntry, Medication, PhotoRecord, RefreshSession, User, UserProfile, WeightMeasurement
from app.schemas import (BodyMeasurementCreate, BodyMeasurementOut, DoseCreate, DoseOut, JournalEntryCreate,
                         JournalEntryOut, MedicationCreate, MedicationOut, PhotoRecordOut, ProfileOut,
                         PhotoUpdate, ProfileUpdate, Token, UserCreate, WeightCreate, WeightOut)
from app.security import (create_access_token, create_refresh_token, hash_password,
                          hash_refresh_token, verify_password)

router = APIRouter(prefix="/api")
limiter = Limiter(key_func=get_remote_address)


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
    db.add(Medication(
        user_id=user.id,
        name="Tirzepatida",
        active=True,
        concentration_mg=10,
        concentration_volume_ml=0.5,
        units_per_ml=100,
    ))
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
def list_entries(module: str, limit: int = Query(default=100, ge=1, le=500), user: User = Depends(current_user), db: Session = Depends(get_db)) -> list[JournalEntry]:
    statement = select(JournalEntry).where(JournalEntry.user_id == user.id,
                                           JournalEntry.module == module).order_by(JournalEntry.occurred_at.desc()).limit(limit)
    return list(db.scalars(statement))


@router.post("/entries", response_model=JournalEntryOut, status_code=status.HTTP_201_CREATED)
def create_entry(payload: JournalEntryCreate, user: User = Depends(current_user), db: Session = Depends(get_db)) -> JournalEntry:
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
    key = f"{uuid4().hex}{extensions[file.content_type]}"
    directory = Path(settings.storage_path) / "photos" / str(user.id)
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(directory, 0o700)
    file_path = directory / key
    file_path.write_bytes(content)
    os.chmod(file_path, 0o600)
    photo = PhotoRecord(user_id=user.id, file_key=key, content_type=file.content_type,
                        caption=caption, taken_at=utc_datetime(taken_at))
    db.add(photo)
    db.commit()
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
    path.unlink(missing_ok=True)
    db.delete(photo)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
