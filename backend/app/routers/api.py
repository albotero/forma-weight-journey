from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.security import OAuth2PasswordRequestForm
from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.calculations import dose_volume_ml, u100_units
from app.config import settings
from app.database import get_db
from app.dependencies import current_user
from app.models import BodyMeasurement, Dose, Medication, User, UserProfile, WeightMeasurement
from app.schemas import (BodyMeasurementCreate, BodyMeasurementOut, DoseCreate, DoseOut, MedicationCreate,
                         MedicationOut, ProfileOut, ProfileUpdate, Token, UserCreate, WeightCreate, WeightOut)
from app.security import create_access_token, hash_password, verify_password

router = APIRouter(prefix="/api")
limiter = Limiter(key_func=get_remote_address)


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def utc_datetime(value: datetime | None) -> datetime:
    result = value or utc_now()
    return result.replace(tzinfo=timezone.utc) if result.tzinfo is None else result.astimezone(timezone.utc)


@router.post("/auth/register", response_model=Token, status_code=status.HTTP_201_CREATED)
@limiter.limit("10/minute")
def register(request: Request, payload: UserCreate, db: Session = Depends(get_db)) -> Token:
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
    db.commit()
    return Token(access_token=create_access_token(str(user.id)))


@router.post("/auth/login", response_model=Token)
@limiter.limit("10/minute")
def login(request: Request, form: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)) -> Token:
    user = db.scalar(select(User).where(User.email == form.username.lower()))
    if user is None or not verify_password(form.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Incorrect email or password", headers={
                            "WWW-Authenticate": "Bearer"})
    return Token(access_token=create_access_token(str(user.id)))


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


@router.get("/weights", response_model=list[WeightOut])
def list_weights(limit: int = Query(default=100, ge=1, le=500), offset: int = Query(default=0, ge=0), user: User = Depends(current_user), db: Session = Depends(get_db)) -> list[WeightMeasurement]:
    statement = select(WeightMeasurement).where(WeightMeasurement.user_id == user.id).order_by(
        WeightMeasurement.measured_at.desc()).offset(offset).limit(limit)
    return list(db.scalars(statement))


@router.post("/weights", response_model=WeightOut, status_code=201)
def create_weight(payload: WeightCreate, user: User = Depends(current_user), db: Session = Depends(get_db)) -> WeightMeasurement:
    weight = WeightMeasurement(user_id=user.id, measured_at=utc_datetime(
        payload.measured_at), weight_kg=payload.weight_kg, source=payload.source, notes=payload.notes)
    db.add(weight)
    db.commit()
    db.refresh(weight)
    return weight


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
