from datetime import datetime

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True)
    pending_email: Mapped[str | None] = mapped_column(
        String(320), nullable=True)
    email_verified_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    auth_version: Mapped[int] = mapped_column(
        Integer, default=0, server_default="0")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now())
    profile: Mapped["UserProfile | None"] = relationship(
        back_populates="user", cascade="all, delete-orphan", uselist=False)
    medications: Mapped[list["Medication"]] = relationship(
        back_populates="user", cascade="all, delete-orphan")
    weights: Mapped[list["WeightMeasurement"]] = relationship(
        back_populates="user", cascade="all, delete-orphan")


class UserProfile(Base):
    __tablename__ = "user_profiles"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey(
        "users.id", ondelete="CASCADE"), unique=True)
    birth_date: Mapped[str | None] = mapped_column(String(10), nullable=True)
    height_cm: Mapped[float] = mapped_column(Float, default=180)
    initial_weight_kg: Mapped[float] = mapped_column(Float, default=106)
    timezone: Mapped[str] = mapped_column(String(64), default="America/Bogota")
    reminder_time: Mapped[str] = mapped_column(
        String(5), default="05:00", server_default="05:00")
    medications_reviewed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True)
    medications_reviewed_signature: Mapped[str | None] = mapped_column(
        String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    user: Mapped[User] = relationship(back_populates="profile")


class Medication(Base):
    __tablename__ = "medications"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey(
        "users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(120), default="Tirzepatida")
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    is_primary: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default="false")
    route: Mapped[str] = mapped_column(
        String(16), default="injectable", server_default="injectable")
    concentration_mg: Mapped[float | None] = mapped_column(
        Float, nullable=True)
    concentration_volume_ml: Mapped[float |
                                    None] = mapped_column(Float, nullable=True)
    units_per_ml: Mapped[float | None] = mapped_column(
        Float, nullable=True)
    dosing_interval: Mapped[str | None] = mapped_column(
        String(10), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now())
    user: Mapped[User] = relationship(back_populates="medications")
    doses: Mapped[list["Dose"]] = relationship(
        back_populates="medication", cascade="all, delete-orphan")


class Dose(Base):
    __tablename__ = "doses"

    id: Mapped[int] = mapped_column(primary_key=True)
    medication_id: Mapped[int] = mapped_column(ForeignKey(
        "medications.id", ondelete="CASCADE"), index=True)
    administered_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), index=True)
    dose_mg: Mapped[float | None] = mapped_column(Float, nullable=True)
    dose_amount: Mapped[float] = mapped_column(Float)
    dose_unit: Mapped[str] = mapped_column(
        String(20), default="mg", server_default="mg")
    calculated_volume_ml: Mapped[float |
                                 None] = mapped_column(Float, nullable=True)
    calculated_u100_units: Mapped[float |
                                  None] = mapped_column(Float, nullable=True)
    injection_site: Mapped[str | None] = mapped_column(
        String(80), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now())
    medication: Mapped[Medication] = relationship(back_populates="doses")


class WeightMeasurement(Base):
    __tablename__ = "weight_measurements"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey(
        "users.id", ondelete="CASCADE"), index=True)
    measured_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), index=True)
    weight_kg: Mapped[float] = mapped_column(Float)
    body_fat_percent: Mapped[float | None] = mapped_column(
        Float, nullable=True)
    fat_free_mass_kg: Mapped[float | None] = mapped_column(
        Float, nullable=True)
    subcutaneous_fat_percent: Mapped[float |
                                     None] = mapped_column(Float, nullable=True)
    visceral_fat_index: Mapped[float | None] = mapped_column(
        Float, nullable=True)
    body_water_percent: Mapped[float | None] = mapped_column(
        Float, nullable=True)
    skeletal_muscle_percent: Mapped[float |
                                    None] = mapped_column(Float, nullable=True)
    muscle_mass_kg: Mapped[float | None] = mapped_column(Float, nullable=True)
    bone_mass_kg: Mapped[float | None] = mapped_column(Float, nullable=True)
    protein_percent: Mapped[float | None] = mapped_column(Float, nullable=True)
    bmr_kcal: Mapped[float | None] = mapped_column(Float, nullable=True)
    metabolic_age: Mapped[int | None] = mapped_column(Integer, nullable=True)
    source: Mapped[str | None] = mapped_column(String(80), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now())
    user: Mapped[User] = relationship(back_populates="weights")


class BodyMeasurement(Base):
    __tablename__ = "body_measurements"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey(
        "users.id", ondelete="CASCADE"), index=True)
    measured_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), index=True)
    waist_cm: Mapped[float | None] = mapped_column(Float, nullable=True)
    neck_cm: Mapped[float | None] = mapped_column(Float, nullable=True)
    chest_cm: Mapped[float | None] = mapped_column(Float, nullable=True)
    abdomen_cm: Mapped[float | None] = mapped_column(Float, nullable=True)
    hip_cm: Mapped[float | None] = mapped_column(Float, nullable=True)
    arm_cm: Mapped[float | None] = mapped_column(Float, nullable=True)
    thigh_cm: Mapped[float | None] = mapped_column(Float, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)


class JournalEntry(Base):
    __tablename__ = "journal_entries"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey(
        "users.id", ondelete="CASCADE"), index=True)
    module: Mapped[str] = mapped_column(String(32), index=True)
    occurred_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), index=True)
    title: Mapped[str] = mapped_column(String(160))
    data: Mapped[dict[str, object]] = mapped_column(JSON, default=dict)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class PhotoRecord(Base):
    __tablename__ = "photo_records"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey(
        "users.id", ondelete="CASCADE"), index=True)
    file_key: Mapped[str] = mapped_column(String(80), unique=True)
    content_type: Mapped[str] = mapped_column(String(80))
    caption: Mapped[str | None] = mapped_column(String(300), nullable=True)
    taken_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now())


class RefreshSession(Base):
    __tablename__ = "refresh_sessions"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey(
        "users.id", ondelete="CASCADE"), index=True)
    token_hash: Mapped[str] = mapped_column(
        String(64), unique=True, index=True)
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), index=True)
    revoked_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now())


class PasswordResetToken(Base):
    __tablename__ = "password_reset_tokens"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey(
        "users.id", ondelete="CASCADE"), index=True)
    token_hash: Mapped[str] = mapped_column(
        String(64), unique=True, index=True)
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), index=True)
    used_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now())


class EmailVerificationToken(Base):
    __tablename__ = "email_verification_tokens"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey(
        "users.id", ondelete="CASCADE"), index=True)
    email: Mapped[str] = mapped_column(String(320))
    purpose: Mapped[str] = mapped_column(String(24))
    token_hash: Mapped[str] = mapped_column(
        String(64), unique=True, index=True)
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), index=True)
    used_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now())


class CatalogItem(Base):
    __tablename__ = "catalog_items"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey(
        "users.id", ondelete="CASCADE"), index=True)
    category: Mapped[str] = mapped_column(String(16), index=True)
    name: Mapped[str] = mapped_column(String(120))
    unit: Mapped[str | None] = mapped_column(String(40), nullable=True)
    symptom_category: Mapped[str | None] = mapped_column(
        String(40), nullable=True)
    is_blood_pressure: Mapped[bool] = mapped_column(
        Boolean, default=False)
    normal_min: Mapped[float | None] = mapped_column(Float, nullable=True)
    normal_max: Mapped[float | None] = mapped_column(Float, nullable=True)
    diastolic_normal_min: Mapped[float |
                                 None] = mapped_column(Float, nullable=True)
    diastolic_normal_max: Mapped[float |
                                 None] = mapped_column(Float, nullable=True)
    sort_order: Mapped[int] = mapped_column(
        Integer, default=0, server_default="0")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now())


class TelegramConnection(Base):
    __tablename__ = "telegram_connections"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), unique=True, index=True)
    chat_id: Mapped[str | None] = mapped_column(
        String(64), unique=True, nullable=True)
    pairing_token_hash: Mapped[str | None] = mapped_column(
        String(64), unique=True, nullable=True)
    pairing_expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True)
    linked_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True)
