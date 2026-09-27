from datetime import datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator, model_validator


class UserCreate(BaseModel):
    email: EmailStr
    password: str = Field(min_length=12, max_length=128)


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"


class ProfileUpdate(BaseModel):
    height_cm: float = Field(gt=0, le=260)
    initial_weight_kg: float = Field(gt=0, le=500)
    timezone: str = Field(default="America/Bogota", max_length=64)
    birth_date: str | None = None

    @field_validator("timezone")
    @classmethod
    def valid_timezone(cls, value: str) -> str:
        try:
            ZoneInfo(value)
        except (ZoneInfoNotFoundError, ValueError):
            raise ValueError("Unknown IANA timezone") from None
        return value


class ProfileOut(ProfileUpdate):
    model_config = ConfigDict(from_attributes=True)
    id: int


class MedicationCreate(BaseModel):
    name: str = Field(default="Tirzepatida", min_length=1, max_length=120)
    active: bool = True
    concentration_mg: float = Field(gt=0, le=10000)
    concentration_volume_ml: float = Field(gt=0, le=1000)
    units_per_ml: float | None = Field(default=100, gt=0, le=10000)
    notes: str | None = None


class MedicationOut(MedicationCreate):
    model_config = ConfigDict(from_attributes=True)
    id: int
    created_at: datetime


class WeightCreate(BaseModel):
    measured_at: datetime | None = None
    weight_kg: float = Field(gt=0, le=500)
    source: str | None = Field(default=None, max_length=80)
    notes: str | None = None


class WeightOut(WeightCreate):
    model_config = ConfigDict(from_attributes=True)
    id: int
    measured_at: datetime
    created_at: datetime


class DoseCreate(BaseModel):
    medication_id: int
    administered_at: datetime | None = None
    dose_mg: float = Field(gt=0, le=1000)
    injection_site: str | None = Field(default=None, max_length=80)
    notes: str | None = None


class DoseOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    medication_id: int
    administered_at: datetime
    dose_mg: float
    calculated_volume_ml: float
    calculated_u100_units: float | None
    injection_site: str | None
    notes: str | None
    created_at: datetime


class BodyMeasurementCreate(BaseModel):
    measured_at: datetime | None = None
    waist_cm: float | None = Field(default=None, gt=0, le=300)
    neck_cm: float | None = Field(default=None, gt=0, le=150)
    chest_cm: float | None = Field(default=None, gt=0, le=300)
    abdomen_cm: float | None = Field(default=None, gt=0, le=300)
    hip_cm: float | None = Field(default=None, gt=0, le=300)
    arm_cm: float | None = Field(default=None, gt=0, le=150)
    thigh_cm: float | None = Field(default=None, gt=0, le=200)
    notes: str | None = None

    @model_validator(mode="after")
    def has_measurement(self) -> "BodyMeasurementCreate":
        if not any(getattr(self, key) is not None for key in ("waist_cm", "neck_cm", "chest_cm", "abdomen_cm", "hip_cm", "arm_cm", "thigh_cm")):
            raise ValueError("At least one measurement is required")
        return self


class BodyMeasurementOut(BodyMeasurementCreate):
    model_config = ConfigDict(from_attributes=True)
    id: int
    measured_at: datetime
