from datetime import date, datetime, timezone
from decimal import Decimal, InvalidOperation
import math
from typing import Literal, get_args
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator, model_validator


class UserCreate(BaseModel):
    email: EmailStr
    password: str = Field(min_length=12, max_length=128)


class EmailTokenConfirm(BaseModel):
    token: str = Field(min_length=32, max_length=128)


class EmailChangeRequest(BaseModel):
    current_password: str = Field(min_length=1, max_length=128)
    new_email: EmailStr


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
    email_verified: bool
    pending_email: EmailStr | None
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
    reminder_time: str = Field(
        default="05:00", pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
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
    route: Literal["injectable", "oral"] = "injectable"
    concentration_mg: float | None = Field(default=None, gt=0, le=10000)
    concentration_volume_ml: float | None = Field(default=None, gt=0, le=1000)
    units_per_ml: float | None = Field(default=None, gt=0, le=10000)
    dosing_interval: Literal["daily", "weekly"] | None = None
    notes: str | None = None

    @model_validator(mode="after")
    def validate_route_fields(self) -> "MedicationCreate":
        if self.route == "injectable":
            if self.concentration_mg is None or self.concentration_volume_ml is None:
                raise ValueError(
                    "Injectable medications require concentration and volume")
            if self.units_per_ml is None:
                self.units_per_ml = 100
        elif any(value is not None for value in (
                self.concentration_mg, self.concentration_volume_ml, self.units_per_ml)):
            raise ValueError(
                "Oral medications do not use injection concentration fields")
        return self


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
    dose_amount: float | None = Field(default=None, gt=0, le=1000000)
    dose_unit: Literal["mg", "mcg", "UI", "g",
                       "mL", "tableta", "cápsula", "gota"] = "mg"
    dose_mg: float | None = Field(default=None, gt=0, le=1000)
    injection_site: str | None = Field(default=None, max_length=80)
    notes: str | None = None

    @model_validator(mode="after")
    def normalize_dose_amount(self) -> "DoseCreate":
        if self.dose_amount is None:
            if self.dose_mg is None:
                raise ValueError("Dose amount is required")
            self.dose_amount = self.dose_mg
        if self.dose_unit == "mg":
            if self.dose_mg is None:
                self.dose_mg = self.dose_amount
            elif self.dose_mg != self.dose_amount:
                raise ValueError(
                    "dose_mg and dose_amount must match when the unit is mg")
        elif self.dose_mg is not None:
            raise ValueError(
                "Use dose_amount instead of dose_mg when the unit is not mg")
        return self


class DoseOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    medication_id: int
    administered_at: datetime
    dose_mg: float | None
    dose_amount: float
    dose_unit: str
    calculated_volume_ml: float | None
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

    @model_validator(mode="after")
    def activity_data_is_valid(self) -> "JournalEntryCreate":
        if self.module != "activity" or "entry_type" not in self.data:
            return self

        entry_type = self.data["entry_type"]
        if entry_type == "weekly":
            fields = {
                "weekly_calories_kcal": (0, 200000),
                "weekly_steps": (0, 2000000),
                "weekly_distance_km": (0, 10000),
            }
            values = [self.data.get(key) for key in fields]
            if not any(value is not None for value in values):
                raise ValueError(
                    "At least one weekly activity total is required")
            for key, (minimum, maximum) in fields.items():
                value = self.data.get(key)
                if value is None:
                    continue
                if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
                    raise ValueError(f"{key} must be a finite number")
                if not minimum <= value <= maximum:
                    raise ValueError(f"{key} is outside the supported range")
                if key == "weekly_steps" and not isinstance(value, int):
                    raise ValueError("weekly_steps must be a whole number")
            return self

        if entry_type != "single":
            raise ValueError("entry_type must be 'single' or 'weekly'")
        activity_type = self.data.get("activity_type")
        choices = {"Caminata", "Correr", "Bicicleta", "Natación",
                   "Entrenamiento de fuerza", "Yoga/Pilates", "Otro"}
        if not isinstance(activity_type, str) or activity_type not in choices:
            raise ValueError("Select a supported activity type")
        if activity_type == "Otro":
            other_activity = self.data.get("other_activity")
            if not isinstance(other_activity, str) or not other_activity.strip() or len(other_activity) > 120:
                raise ValueError("Describe the other activity")
        fields = {
            "duration_min": (0, 1440),
            "distance_km": (0, 1000),
            "calories_kcal": (0, 100000),
        }
        values = [self.data.get(key) for key in fields]
        if not any(value is not None for value in values):
            raise ValueError("At least one activity measurement is required")
        for key, (minimum, maximum) in fields.items():
            value = self.data.get(key)
            if value is None:
                continue
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
                raise ValueError(f"{key} must be a finite number")
            if not minimum <= value <= maximum:
                raise ValueError(f"{key} is outside the supported range")
        return self


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


class CatalogItemCreate(NumericPrecisionModel):
    category: CatalogCategory
    name: str = Field(min_length=1, max_length=120)
    unit: str | None = Field(default=None, max_length=40)
    symptom_category: SymptomCategory | None = None
    normal_min: float | None = Field(default=None, ge=-1_000_000, le=1_000_000)
    normal_max: float | None = Field(default=None, ge=-1_000_000, le=1_000_000)
    diastolic_normal_min: float | None = Field(
        default=None, ge=-1_000_000, le=1_000_000)
    diastolic_normal_max: float | None = Field(
        default=None, ge=-1_000_000, le=1_000_000)

    @model_validator(mode="after")
    def normal_range_is_valid(self) -> "CatalogItemCreate":
        if self.normal_min is not None and self.normal_max is not None and self.normal_min > self.normal_max:
            raise ValueError(
                "normal_min must be less than or equal to normal_max")
        if self.diastolic_normal_min is not None and self.diastolic_normal_max is not None and self.diastolic_normal_min > self.diastolic_normal_max:
            raise ValueError(
                "diastolic_normal_min must be less than or equal to diastolic_normal_max")
        has_thresholds = any(value is not None for value in (
            self.normal_min, self.normal_max, self.diastolic_normal_min, self.diastolic_normal_max))
        if self.category != "lab" and has_thresholds:
            raise ValueError("Normal thresholds only apply to lab results")
        return self


class CatalogItemOut(CatalogItemCreate):
    model_config = ConfigDict(from_attributes=True)
    id: int
    is_blood_pressure: bool
    sort_order: int


class CatalogThresholdsUpdate(NumericPrecisionModel):
    normal_min: float | None = Field(default=None, ge=-1_000_000, le=1_000_000)
    normal_max: float | None = Field(default=None, ge=-1_000_000, le=1_000_000)
    diastolic_normal_min: float | None = Field(
        default=None, ge=-1_000_000, le=1_000_000)
    diastolic_normal_max: float | None = Field(
        default=None, ge=-1_000_000, le=1_000_000)

    @model_validator(mode="after")
    def normal_range_is_valid(self) -> "CatalogThresholdsUpdate":
        if self.normal_min is not None and self.normal_max is not None and self.normal_min > self.normal_max:
            raise ValueError(
                "normal_min must be less than or equal to normal_max")
        if self.diastolic_normal_min is not None and self.diastolic_normal_max is not None and self.diastolic_normal_min > self.diastolic_normal_max:
            raise ValueError(
                "diastolic_normal_min must be less than or equal to diastolic_normal_max")
        return self


class CatalogOrderUpdate(BaseModel):
    item_ids: list[int] = Field(min_length=1)


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
