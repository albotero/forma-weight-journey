from datetime import date, datetime, timezone
from decimal import Decimal, InvalidOperation
from typing import Literal, get_args
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator, model_validator


class UserCreate(BaseModel):
    email: EmailStr
    password: str = Field(min_length=12, max_length=128)


class PasswordChange(BaseModel):
    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=12, max_length=128)


class PasswordResetRequest(BaseModel):
    email: EmailStr


class PasswordResetConfirm(BaseModel):
    token: str = Field(min_length=32, max_length=128)
    new_password: str = Field(min_length=12, max_length=128)


class AccountOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    email: EmailStr
    created_at: datetime


class NumericPrecisionModel(BaseModel):
    @model_validator(mode="before")
    @classmethod
    def at_most_two_decimal_places(cls, value: object) -> object:
        if not isinstance(value, dict):
            return value

        def validate_dynamic_numbers(item: object) -> None:
            if isinstance(item, dict):
                for nested in item.values():
                    validate_dynamic_numbers(nested)
            elif isinstance(item, (list, tuple)):
                for nested in item:
                    validate_dynamic_numbers(nested)
            elif isinstance(item, (int, float)) and not isinstance(item, bool):
                check_precision(item)

        def check_precision(item: object) -> None:
            try:
                number = Decimal(str(item))
            except (InvalidOperation, ValueError):
                return
            if number.is_finite() and max(0, -number.as_tuple().exponent) > 2:
                raise ValueError(
                    "Numeric values support at most two decimal places")

        for name, item in value.items():
            field = cls.model_fields.get(name)
            if field is not None and (field.annotation is float or float in get_args(field.annotation)) and item is not None:
                check_precision(item)
            elif name == "data":
                validate_dynamic_numbers(item)
        return value

    @model_validator(mode="after")
    def past_measurements_only(self) -> "NumericPrecisionModel":
        now = datetime.now(timezone.utc)
        for name in ("measured_at", "administered_at"):
            value = getattr(self, name, None)
            if value is None:
                continue
            timestamp = value.replace(
                tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)
            if timestamp > now:
                raise ValueError(f"{name} cannot be in the future")
        return self


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"


class ProfileUpdate(NumericPrecisionModel):
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

    @field_validator("birth_date")
    @classmethod
    def valid_birth_date(cls, value: str | None) -> str | None:
        if value is None:
            return None
        try:
            parsed = date.fromisoformat(value)
        except ValueError:
            raise ValueError("Birth date must use YYYY-MM-DD") from None
        if parsed > date.today():
            raise ValueError("Birth date cannot be in the future")
        return parsed.isoformat()


class ProfileOut(ProfileUpdate):
    model_config = ConfigDict(from_attributes=True)
    id: int
    medications_reviewed: bool = False


class MedicationsReviewToggle(BaseModel):
    reviewed: bool


class MedicationCreate(NumericPrecisionModel):
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


class WeightCreate(NumericPrecisionModel):
    measured_at: datetime | None = None
    weight_kg: float = Field(gt=0, le=500)
    body_fat_percent: float | None = Field(default=None, ge=0, le=100)
    fat_free_mass_kg: float | None = Field(default=None, ge=0, le=500)
    subcutaneous_fat_percent: float | None = Field(default=None, ge=0, le=100)
    visceral_fat_index: float | None = Field(default=None, ge=0, le=1000)
    body_water_percent: float | None = Field(default=None, ge=0, le=100)
    skeletal_muscle_percent: float | None = Field(default=None, ge=0, le=100)
    muscle_mass_kg: float | None = Field(default=None, ge=0, le=500)
    bone_mass_kg: float | None = Field(default=None, ge=0, le=100)
    protein_percent: float | None = Field(default=None, ge=0, le=100)
    bmr_kcal: float | None = Field(default=None, ge=0, le=20000)
    metabolic_age: int | None = Field(default=None, ge=0, le=150)
    source: str | None = Field(default=None, max_length=80)
    notes: str | None = None


class WeightOut(WeightCreate):
    model_config = ConfigDict(from_attributes=True)
    id: int
    measured_at: datetime
    created_at: datetime


class DoseCreate(NumericPrecisionModel):
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


class BodyMeasurementCreate(NumericPrecisionModel):
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


JournalModule = Literal["symptoms", "activity",
                        "labs", "goals", "reviews", "reminders"]


class JournalEntryCreate(NumericPrecisionModel):
    module: JournalModule
    occurred_at: datetime | None = None
    title: str = Field(min_length=1, max_length=160)
    data: dict[str, object] = Field(default_factory=dict)
    notes: str | None = None


class JournalEntryOut(JournalEntryCreate):
    model_config = ConfigDict(from_attributes=True)
    id: int
    occurred_at: datetime
    created_at: datetime
    updated_at: datetime


class ReminderToggle(BaseModel):
    enabled: bool


CatalogCategory = Literal["symptom", "goal", "lab"]
SymptomCategory = Literal["Gastrointestinal", "Otro"]


class CatalogItemCreate(BaseModel):
    category: CatalogCategory
    name: str = Field(min_length=1, max_length=120)
    unit: str | None = Field(default=None, max_length=40)
    symptom_category: SymptomCategory | None = None


class CatalogItemOut(CatalogItemCreate):
    model_config = ConfigDict(from_attributes=True)
    id: int
    is_blood_pressure: bool


class PhotoRecordOut(BaseModel):
    id: int
    caption: str | None
    taken_at: datetime
    created_at: datetime


class PhotoUpdate(BaseModel):
    caption: str | None = Field(default=None, max_length=300)
    taken_at: datetime

    @model_validator(mode="after")
    def taken_at_is_not_future(self) -> "PhotoUpdate":
        timestamp = self.taken_at.replace(
            tzinfo=timezone.utc) if self.taken_at.tzinfo is None else self.taken_at.astimezone(timezone.utc)
        if timestamp > datetime.now(timezone.utc):
            raise ValueError("Photo date cannot be in the future")
        return self
