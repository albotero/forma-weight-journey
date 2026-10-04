from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from hashlib import sha256
from io import BytesIO
import json
import re
from pathlib import Path
import shutil
import tempfile
from typing import Any, TypeVar
from uuid import uuid4
from zipfile import ZIP_DEFLATED, BadZipFile, ZipFile

from pydantic import BaseModel, ValidationError
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.models import BodyMeasurement, CatalogItem, Dose, JournalEntry, Medication, PhotoRecord, RefreshSession, TelegramConnection, User, UserProfile, WeightMeasurement
from app.schemas import BodyMeasurementCreate, CatalogItemCreate, DoseCreate, JournalEntryCreate, MedicationCreate, PhotoUpdate, ProfileUpdate, WeightCreate

EXPORT_FORMAT = "forma-account-export"
EXPORT_VERSION = 1
JSON_EXPORT_FORMAT = "forma-account-json-export"
MAX_ARCHIVE_BYTES = 50 * 1024 * 1024
MAX_UNCOMPRESSED_BYTES = 150 * 1024 * 1024
MAX_PHOTO_BYTES = 10 * 1024 * 1024
MAX_ROWS_PER_COLLECTION = 10000
MAX_ARCHIVE_FILES = 10002
_PHOTO_TYPES = {
    "image/jpeg": (".jpg", b"\xff\xd8\xff"),
    "image/png": (".png", b"\x89PNG\r\n\x1a\n"),
    "image/webp": (".webp", b"RIFF"),
}
_KEY_PATTERN = re.compile(r"(?:med|catalog|photo)-[0-9]{6}")
_Model = TypeVar("_Model", bound=BaseModel)


@dataclass
class ParsedExport:
    manifest: dict[str, Any]
    photo_files: dict[str, bytes]


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value is not None else None


def _json_catalog_keys(value: Any, catalog_keys: dict[int, str]) -> Any:
    if isinstance(value, list):
        return [_json_catalog_keys(item, catalog_keys) for item in value]
    if isinstance(value, dict):
        result: dict[str, Any] = {}
        for key, item in value.items():
            if key == "catalog_item_id":
                result["catalog_item_key"] = catalog_keys.get(
                    item) if isinstance(item, int) else None
            else:
                result[key] = _json_catalog_keys(item, catalog_keys)
        return result
    return value


def _catalog_ids(value: Any, catalog_ids: dict[str, int]) -> Any:
    if isinstance(value, list):
        return [_catalog_ids(item, catalog_ids) for item in value]
    if isinstance(value, dict):
        result: dict[str, Any] = {}
        for key, item in value.items():
            if key == "catalog_item_key":
                result["catalog_item_id"] = catalog_ids.get(
                    item) if isinstance(item, str) else None
            else:
                result[key] = _catalog_ids(item, catalog_ids)
        return result
    return value


def _validate_catalog_keys(value: Any, catalog_keys: set[str]) -> None:
    if isinstance(value, list):
        for item in value:
            _validate_catalog_keys(item, catalog_keys)
    elif isinstance(value, dict):
        for key, item in value.items():
            if key == "catalog_item_id":
                raise ValueError(
                    "Catalog references must use versioned export keys")
            if key == "catalog_item_key" and item is not None and (
                    not isinstance(item, str) or item not in catalog_keys):
                raise ValueError(
                    "A journal entry refers to a missing catalog item")
            _validate_catalog_keys(item, catalog_keys)


def _build_export_manifest(
    db: Session,
    user: User,
    storage_path: str,
    *,
    include_photo_files: bool,
) -> tuple[dict[str, Any], dict[str, bytes]]:
    profile = db.scalar(select(UserProfile).where(
        UserProfile.user_id == user.id))
    if profile is None:
        raise ValueError("Account profile is missing")

    medications = db.scalars(select(Medication).where(
        Medication.user_id == user.id).order_by(Medication.id)).all()
    medication_keys = {row.id: f"med-{index:06d}" for index,
                       row in enumerate(medications)}
    catalog_items = db.scalars(select(CatalogItem).where(
        CatalogItem.user_id == user.id).order_by(CatalogItem.id)).all()
    catalog_keys = {row.id: f"catalog-{index:06d}" for index,
                    row in enumerate(catalog_items)}

    doses = db.scalars(select(Dose).where(
        Dose.medication_id.in_(medication_keys.keys())).order_by(Dose.id)).all() if medications else []
    weights = db.scalars(select(WeightMeasurement).where(
        WeightMeasurement.user_id == user.id).order_by(WeightMeasurement.id)).all()
    measurements = db.scalars(select(BodyMeasurement).where(
        BodyMeasurement.user_id == user.id).order_by(BodyMeasurement.id)).all()
    entries = db.scalars(select(JournalEntry).where(
        JournalEntry.user_id == user.id).order_by(JournalEntry.id)).all()
    photos = db.scalars(select(PhotoRecord).where(
        PhotoRecord.user_id == user.id).order_by(PhotoRecord.id)).all()

    manifest: dict[str, Any] = {
        "format": EXPORT_FORMAT,
        "version": EXPORT_VERSION,
        "account_email": user.email,
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "profile": {
            "birth_date": profile.birth_date,
            "height_cm": profile.height_cm,
            "initial_weight_kg": profile.initial_weight_kg,
            "timezone": profile.timezone,
            "reminder_time": profile.reminder_time,
        },
        "medications": [],
        "doses": [],
        "weights": [],
        "body_measurements": [],
        "journal_entries": [],
        "catalog_items": [],
        "photos": [],
    }
    for row in medications:
        manifest["medications"].append({
            "key": medication_keys[row.id], "name": row.name, "active": row.active,
            "route": row.route,
            "concentration_mg": row.concentration_mg,
            "concentration_volume_ml": row.concentration_volume_ml,
            "units_per_ml": row.units_per_ml, "dosing_interval": row.dosing_interval,
            "notes": row.notes,
            "created_at": _iso(row.created_at),
        })
    for row in doses:
        medication_key = medication_keys.get(row.medication_id)
        if medication_key is None:
            raise ValueError("A dose refers to a missing medication")
        manifest["doses"].append({
            "medication_key": medication_key,
            "administered_at": _iso(row.administered_at),
            "dose_mg": row.dose_mg, "dose_amount": row.dose_amount,
            "dose_unit": row.dose_unit,
            "calculated_volume_ml": row.calculated_volume_ml,
            "calculated_u100_units": row.calculated_u100_units,
            "injection_site": row.injection_site, "notes": row.notes,
            "created_at": _iso(row.created_at),
        })
    for row in weights:
        manifest["weights"].append({
            "measured_at": _iso(row.measured_at), "weight_kg": row.weight_kg,
            "body_fat_percent": row.body_fat_percent, "fat_free_mass_kg": row.fat_free_mass_kg,
            "subcutaneous_fat_percent": row.subcutaneous_fat_percent,
            "visceral_fat_index": row.visceral_fat_index, "body_water_percent": row.body_water_percent,
            "skeletal_muscle_percent": row.skeletal_muscle_percent, "muscle_mass_kg": row.muscle_mass_kg,
            "bone_mass_kg": row.bone_mass_kg, "protein_percent": row.protein_percent,
            "bmr_kcal": row.bmr_kcal, "metabolic_age": row.metabolic_age,
            "source": row.source, "notes": row.notes, "created_at": _iso(row.created_at),
        })
    for row in measurements:
        manifest["body_measurements"].append({
            "measured_at": _iso(row.measured_at), "waist_cm": row.waist_cm,
            "neck_cm": row.neck_cm, "chest_cm": row.chest_cm, "abdomen_cm": row.abdomen_cm,
            "hip_cm": row.hip_cm, "arm_cm": row.arm_cm, "thigh_cm": row.thigh_cm,
            "notes": row.notes,
        })
    for row in entries:
        manifest["journal_entries"].append({
            "module": row.module, "occurred_at": _iso(row.occurred_at), "title": row.title,
            "data": _json_catalog_keys(row.data or {}, catalog_keys), "notes": row.notes,
            "created_at": _iso(row.created_at), "updated_at": _iso(row.updated_at),
        })
    for row in catalog_items:
        manifest["catalog_items"].append({
            "key": catalog_keys[row.id], "category": row.category, "name": row.name,
            "unit": row.unit, "symptom_category": row.symptom_category,
            "is_blood_pressure": row.is_blood_pressure, "normal_min": row.normal_min,
            "normal_max": row.normal_max, "diastolic_normal_min": row.diastolic_normal_min,
            "diastolic_normal_max": row.diastolic_normal_max, "sort_order": row.sort_order,
            "created_at": _iso(row.created_at),
        })

    photo_directory = Path(storage_path) / "photos" / str(user.id)
    photo_files: dict[str, bytes] = {}
    for index, row in enumerate(photos):
        photo_key = f"photo-{index:06d}"
        photo_metadata = {
            "key": photo_key,
            "content_type": row.content_type,
            "caption": row.caption,
            "taken_at": _iso(row.taken_at),
            "created_at": _iso(row.created_at),
        }
        if include_photo_files:
            source = photo_directory / row.file_key
            if source.parent != photo_directory or not source.is_file():
                raise ValueError("A photo file is missing")
            content = source.read_bytes()
            if len(content) > MAX_PHOTO_BYTES:
                raise ValueError("A photo exceeds the export size limit")
            file_path = f"photos/{photo_key}"
            photo_metadata.update(
                file=file_path, sha256=sha256(content).hexdigest())
            photo_files[file_path] = content
        manifest["photos"].append(photo_metadata)
    return manifest, photo_files


def build_export(db: Session, user: User, storage_path: str) -> bytes:
    manifest, photo_files = _build_export_manifest(
        db, user, storage_path, include_photo_files=True)
    archive_buffer = BytesIO()
    with ZipFile(archive_buffer, "w", compression=ZIP_DEFLATED) as archive:
        for file_path, content in photo_files.items():
            archive.writestr(file_path, content)
        archive.writestr("manifest.json", json.dumps(
            manifest, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))
    result = archive_buffer.getvalue()
    if len(result) > MAX_ARCHIVE_BYTES:
        raise ValueError("The account export exceeds the download size limit")
    return result


def build_json_export(db: Session, user: User, storage_path: str) -> bytes:
    document, _photo_files = _build_export_manifest(
        db, user, storage_path, include_photo_files=False)
    document["format"] = JSON_EXPORT_FORMAT
    document["media_files_included"] = False
    document["photos"] = [
        {key: value for key, value in photo.items() if key not in {
            "file", "sha256"}}
        for photo in document["photos"]
    ]
    result = json.dumps(document, ensure_ascii=False, indent=2).encode("utf-8")
    if len(result) > MAX_UNCOMPRESSED_BYTES:
        raise ValueError(
            "The JSON account export exceeds the download size limit")
    return result


def _model_data(model: type[_Model], row: Any, extra_keys: set[str] = frozenset()) -> _Model:
    if not isinstance(row, dict):
        raise ValueError("Every record must be an object")
    unknown = set(row) - set(model.model_fields) - extra_keys
    if unknown:
        raise ValueError("A record contains unsupported fields")
    return model.model_validate({key: value for key, value in row.items() if key in model.model_fields})


def _parse_datetime(value: Any, field: str, *, optional: bool = False) -> datetime | None:
    if value is None and optional:
        return None
    if not isinstance(value, str):
        raise ValueError(f"{field} must be an ISO date and time")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        raise ValueError(f"{field} must be an ISO date and time") from None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _validate_rows(name: str, value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list) or len(value) > MAX_ROWS_PER_COLLECTION:
        raise ValueError(
            f"{name} must be a list with at most {MAX_ROWS_PER_COLLECTION} records")
    return value


def parse_export(content: bytes, expected_email: str) -> ParsedExport:
    if len(content) > MAX_ARCHIVE_BYTES:
        raise ValueError("The export file exceeds the upload size limit")
    try:
        archive = ZipFile(BytesIO(content))
        infos = archive.infolist()
        names = [info.filename for info in infos]
        if len(infos) > MAX_ARCHIVE_FILES or len(names) != len(set(names)):
            raise ValueError("The export contains too many or duplicate files")
        if sum(info.file_size for info in infos) > MAX_UNCOMPRESSED_BYTES:
            raise ValueError("The export expands beyond the allowed size")
        if any(info.is_dir() for info in infos) or "manifest.json" not in names:
            raise ValueError("The export archive is not valid")
        manifest_info = archive.getinfo("manifest.json")
        if manifest_info.file_size > 20 * 1024 * 1024:
            raise ValueError("The export manifest is too large")
        manifest = json.loads(archive.read("manifest.json"))
    except (BadZipFile, KeyError, UnicodeDecodeError, json.JSONDecodeError, RuntimeError):
        raise ValueError("The export archive is not valid") from None

    expected_fields = {
        "format", "version", "account_email", "exported_at", "profile", "medications", "doses",
        "weights", "body_measurements", "journal_entries", "catalog_items", "photos",
    }
    if not isinstance(manifest, dict) or set(manifest) != expected_fields:
        raise ValueError("The export has an unsupported structure")
    if manifest["format"] != EXPORT_FORMAT or manifest["version"] != EXPORT_VERSION:
        raise ValueError("This export version is not supported")
    if not isinstance(manifest["account_email"], str) or manifest["account_email"].lower() != expected_email.lower():
        raise ValueError("This export belongs to a different account")
    _parse_datetime(manifest["exported_at"], "exported_at")

    profile = _model_data(ProfileUpdate, manifest["profile"])
    manifest["profile"] = profile.model_dump(mode="python")

    medications = _validate_rows("medications", manifest["medications"])
    medication_keys: set[str] = set()
    normalized_medications: list[dict[str, Any]] = []
    for row in medications:
        if not isinstance(row, dict) or set(row) - (set(MedicationCreate.model_fields) | {"key", "created_at"}):
            raise ValueError("A medication record contains unsupported fields")
        key = row.get("key")
        if not isinstance(key, str) or not _KEY_PATTERN.fullmatch(key) or not key.startswith("med-") or key in medication_keys:
            raise ValueError("A medication reference is invalid")
        medication_keys.add(key)
        model = _model_data(MedicationCreate, row, {"key", "created_at"})
        normalized = model.model_dump(mode="python")
        normalized.update(key=key, created_at=_parse_datetime(
            row.get("created_at"), "created_at", optional=True))
        normalized_medications.append(normalized)
    manifest["medications"] = normalized_medications
    medication_routes = {
        row["key"]: row["route"] for row in normalized_medications
    }

    catalog_items = _validate_rows("catalog_items", manifest["catalog_items"])
    catalog_keys: set[str] = set()
    normalized_catalog: list[dict[str, Any]] = []
    for row in catalog_items:
        if not isinstance(row, dict) or set(row) - (set(CatalogItemCreate.model_fields) | {"key", "is_blood_pressure", "sort_order", "created_at"}):
            raise ValueError("A catalog record contains unsupported fields")
        key = row.get("key")
        if not isinstance(key, str) or not _KEY_PATTERN.fullmatch(key) or not key.startswith("catalog-") or key in catalog_keys:
            raise ValueError("A catalog reference is invalid")
        if not isinstance(row.get("is_blood_pressure", False), bool):
            raise ValueError(
                "A catalog record has an invalid blood pressure flag")
        sort_order = row.get("sort_order", 0)
        if isinstance(sort_order, bool) or not isinstance(sort_order, int) or sort_order < 0:
            raise ValueError("A catalog record has an invalid sort order")
        catalog_keys.add(key)
        model = _model_data(CatalogItemCreate, row, {
                            "key", "is_blood_pressure", "sort_order", "created_at"})
        normalized = model.model_dump(mode="python")
        is_blood_pressure = row.get("is_blood_pressure", False)
        if is_blood_pressure and (
                normalized["category"] != "lab" or normalized["name"] != "Presión arterial"):
            raise ValueError(
                "The built-in blood pressure catalog entry is invalid")
        if not is_blood_pressure and (
                normalized["diastolic_normal_min"] is not None or normalized["diastolic_normal_max"] is not None):
            raise ValueError(
                "Diastolic thresholds only apply to blood pressure")
        normalized.update(
            key=key, is_blood_pressure=is_blood_pressure, sort_order=sort_order,
            created_at=_parse_datetime(
                row.get("created_at"), "created_at", optional=True),
        )
        normalized_catalog.append(normalized)
    manifest["catalog_items"] = normalized_catalog

    normalized_doses: list[dict[str, Any]] = []
    for row in _validate_rows("doses", manifest["doses"]):
        if not isinstance(row, dict) or set(row) - (set(DoseCreate.model_fields) | {"medication_key", "calculated_volume_ml", "calculated_u100_units", "created_at"}):
            raise ValueError("A dose record contains unsupported fields")
        key = row.get("medication_key")
        if key not in medication_keys:
            raise ValueError("A dose refers to a missing medication")
        model_row = {**row, "medication_id": 1}
        model = _model_data(DoseCreate, model_row, {
                            "medication_key", "calculated_volume_ml", "calculated_u100_units", "created_at"})
        normalized = model.model_dump(mode="python")
        if normalized["administered_at"] is None:
            raise ValueError("A dose is missing its recorded date")
        normalized.update(
            medication_key=key,
            calculated_volume_ml=row.get("calculated_volume_ml"),
            calculated_u100_units=row.get("calculated_u100_units"),
            created_at=_parse_datetime(
                row.get("created_at"), "created_at", optional=True),
        )
        route = medication_routes[key]
        if route == "injectable":
            if normalized["dose_unit"] != "mg":
                raise ValueError("An injectable dose must use mg")
            volume = normalized["calculated_volume_ml"]
            if isinstance(volume, bool) or not isinstance(volume, (int, float)) or volume <= 0:
                raise ValueError("A dose has an invalid calculated volume")
        elif normalized["calculated_volume_ml"] is not None:
            raise ValueError("An oral dose cannot contain an injection volume")
        units = normalized["calculated_u100_units"]
        if units is not None and (isinstance(units, bool) or not isinstance(units, (int, float)) or units <= 0):
            raise ValueError("A dose has invalid calculated units")
        if route == "oral" and units is not None:
            raise ValueError("An oral dose cannot contain U-100 units")
        normalized_doses.append(normalized)
    manifest["doses"] = normalized_doses

    normalized_weights: list[dict[str, Any]] = []
    for row in _validate_rows("weights", manifest["weights"]):
        model = _model_data(WeightCreate, row, {"created_at"})
        normalized = model.model_dump(mode="python")
        if normalized["measured_at"] is None:
            raise ValueError("A weight record is missing its recorded date")
        normalized["created_at"] = _parse_datetime(
            row.get("created_at"), "created_at", optional=True)
        normalized_weights.append(normalized)
    manifest["weights"] = normalized_weights

    normalized_measurements: list[dict[str, Any]] = []
    for row in _validate_rows("body_measurements", manifest["body_measurements"]):
        model = _model_data(BodyMeasurementCreate, row)
        normalized = model.model_dump(mode="python")
        if normalized["measured_at"] is None:
            raise ValueError("A body measurement is missing its recorded date")
        normalized_measurements.append(normalized)
    manifest["body_measurements"] = normalized_measurements

    normalized_entries: list[dict[str, Any]] = []
    for row in _validate_rows("journal_entries", manifest["journal_entries"]):
        model = _model_data(JournalEntryCreate, row, {
                            "created_at", "updated_at"})
        normalized = model.model_dump(mode="python")
        if normalized["occurred_at"] is None:
            raise ValueError("A journal entry is missing its recorded date")
        _validate_catalog_keys(normalized["data"], catalog_keys)
        normalized["created_at"] = _parse_datetime(
            row.get("created_at"), "created_at", optional=True)
        normalized["updated_at"] = _parse_datetime(
            row.get("updated_at"), "updated_at", optional=True)
        normalized_entries.append(normalized)
    manifest["journal_entries"] = normalized_entries

    photos = _validate_rows("photos", manifest["photos"])
    photo_files: dict[str, bytes] = {}
    expected_files = {"manifest.json"}
    normalized_photos: list[dict[str, Any]] = []
    for row in photos:
        expected_photo_fields = {
            "key", "file", "content_type", "caption", "taken_at", "created_at", "sha256"}
        if not isinstance(row, dict) or set(row) != expected_photo_fields:
            raise ValueError("A photo record has an unsupported structure")
        key = row["key"]
        path = row["file"]
        if not isinstance(key, str) or not _KEY_PATTERN.fullmatch(key) or not key.startswith("photo-") or path != f"photos/{key}" or path in expected_files:
            raise ValueError("A photo file reference is invalid")
        media_type = row["content_type"]
        if media_type not in _PHOTO_TYPES:
            raise ValueError("A photo has an unsupported image type")
        if not isinstance(row["caption"], (str, type(None))) or (row["caption"] is not None and len(row["caption"]) > 300):
            raise ValueError("A photo caption is invalid")
        row["taken_at"] = _parse_datetime(row["taken_at"], "taken_at")
        row["created_at"] = _parse_datetime(
            row["created_at"], "created_at", optional=True)
        if row["taken_at"] > datetime.now(timezone.utc):
            raise ValueError("A photo date cannot be in the future")
        info = archive.getinfo(path)
        if info.file_size > MAX_PHOTO_BYTES:
            raise ValueError("A photo exceeds the size limit")
        try:
            photo_content = archive.read(path)
        except (BadZipFile, KeyError, RuntimeError):
            raise ValueError(
                "A photo in the export archive is invalid") from None
        extension, signature = _PHOTO_TYPES[media_type]
        matches = photo_content.startswith(signature)
        if media_type == "image/webp":
            matches = matches and photo_content[8:12] == b"WEBP"
        if not matches or len(photo_content) > MAX_PHOTO_BYTES:
            raise ValueError("Photo content does not match its media type")
        if not isinstance(row["sha256"], str) or sha256(photo_content).hexdigest() != row["sha256"]:
            raise ValueError("A photo failed its integrity check")
        photo_files[key] = photo_content
        expected_files.add(path)
        normalized_photos.append({**row, "extension": extension})
    if set(names) != expected_files:
        raise ValueError("The export archive contains unexpected files")
    manifest["photos"] = normalized_photos
    return ParsedExport(manifest, photo_files)


def preview_export(parsed: ParsedExport) -> dict[str, Any]:
    manifest = parsed.manifest
    names = ("medications", "doses", "weights", "body_measurements",
             "journal_entries", "catalog_items", "photos")
    return {
        "format_version": EXPORT_VERSION,
        "exported_at": manifest["exported_at"],
        "account_email": manifest["account_email"],
        "counts": {name: len(manifest[name]) for name in names},
        "replaces_existing_data": True,
        "notices": ["Telegram must be linked again after restoring.", "Persistent sessions will be revoked."],
    }


def restore_export(db: Session, user: User, parsed: ParsedExport, storage_path: str) -> dict[str, Any]:
    manifest = parsed.manifest
    photo_directory = Path(storage_path) / "photos" / str(user.id)
    old_photo_keys = db.scalars(select(PhotoRecord.file_key).where(
        PhotoRecord.user_id == user.id)).all()
    staged_directory: Path | None = None
    installed_files: list[Path] = []
    staged_files: list[tuple[Path, Path]] = []
    try:
        if parsed.photo_files:
            photo_directory.mkdir(parents=True, exist_ok=True, mode=0o700)
            photo_directory.chmod(0o700)
            staged_directory = Path(tempfile.mkdtemp(
                prefix=".restore-", dir=photo_directory))

        old_medication_ids = select(Medication.id).where(
            Medication.user_id == user.id)
        db.execute(delete(Dose).where(
            Dose.medication_id.in_(old_medication_ids)))
        for model in (WeightMeasurement, BodyMeasurement, JournalEntry, PhotoRecord, CatalogItem, Medication):
            db.execute(delete(model).where(model.user_id == user.id))
        db.execute(delete(TelegramConnection).where(
            TelegramConnection.user_id == user.id))

        profile_values = manifest["profile"]
        profile = db.scalar(select(UserProfile).where(
            UserProfile.user_id == user.id))
        if profile is None:
            profile = UserProfile(user_id=user.id)
            db.add(profile)
        for key, value in profile_values.items():
            setattr(profile, key, value)
        profile.medications_reviewed_at = None
        profile.medications_reviewed_signature = None

        catalog_ids: dict[str, int] = {}
        for row in manifest["catalog_items"]:
            key = row["key"]
            item = CatalogItem(
                user_id=user.id, category=row["category"], name=row["name"], unit=row["unit"],
                symptom_category=row["symptom_category"], is_blood_pressure=row["is_blood_pressure"],
                normal_min=row["normal_min"], normal_max=row["normal_max"],
                diastolic_normal_min=row["diastolic_normal_min"], diastolic_normal_max=row["diastolic_normal_max"],
                sort_order=row["sort_order"],
            )
            if row["created_at"] is not None:
                item.created_at = row["created_at"]
            db.add(item)
            db.flush()
            catalog_ids[key] = item.id

        medication_ids: dict[str, int] = {}
        for row in manifest["medications"]:
            medication = Medication(
                user_id=user.id, name=row["name"], active=row["active"],
                route=row["route"],
                concentration_mg=row["concentration_mg"],
                concentration_volume_ml=row["concentration_volume_ml"],
                units_per_ml=row["units_per_ml"], dosing_interval=row["dosing_interval"],
                notes=row["notes"],
            )
            if row["created_at"] is not None:
                medication.created_at = row["created_at"]
            db.add(medication)
            db.flush()
            medication_ids[row["key"]] = medication.id

        for row in manifest["doses"]:
            dose = Dose(
                medication_id=medication_ids[row["medication_key"]],
                administered_at=row["administered_at"], dose_mg=row["dose_mg"],
                dose_amount=row["dose_amount"], dose_unit=row["dose_unit"],
                calculated_volume_ml=row["calculated_volume_ml"],
                calculated_u100_units=row["calculated_u100_units"],
                injection_site=row["injection_site"], notes=row["notes"],
            )
            if row["created_at"] is not None:
                dose.created_at = row["created_at"]
            db.add(dose)

        for row in manifest["weights"]:
            values = {key: value for key, value in row.items() if key !=
                      "created_at"}
            weight = WeightMeasurement(user_id=user.id, **values)
            if row["created_at"] is not None:
                weight.created_at = row["created_at"]
            db.add(weight)
        for row in manifest["body_measurements"]:
            db.add(BodyMeasurement(user_id=user.id, **row))
        for row in manifest["journal_entries"]:
            values = {key: value for key, value in row.items() if key not in {
                "created_at", "updated_at"}}
            values["data"] = _catalog_ids(values["data"], catalog_ids)
            entry = JournalEntry(user_id=user.id, **values)
            if row["created_at"] is not None:
                entry.created_at = row["created_at"]
            if row["updated_at"] is not None:
                entry.updated_at = row["updated_at"]
            db.add(entry)

        for row in manifest["photos"]:
            content = parsed.photo_files[row["key"]]
            file_key = f"{uuid4().hex}{row['extension']}"
            staged_path = staged_directory / \
                file_key if staged_directory else photo_directory / file_key
            staged_path.write_bytes(content)
            staged_path.chmod(0o600)
            final_path = photo_directory / file_key
            installed_files.append(final_path)
            staged_files.append((staged_path, final_path))
            photo = PhotoRecord(
                user_id=user.id, file_key=file_key, content_type=row["content_type"],
                caption=row["caption"], taken_at=row["taken_at"],
            )
            if row["created_at"] is not None:
                photo.created_at = row["created_at"]
            db.add(photo)

        for session in db.scalars(select(RefreshSession).where(
                RefreshSession.user_id == user.id, RefreshSession.revoked_at.is_(None))).all():
            session.revoked_at = datetime.now(timezone.utc)
        user.auth_version = (user.auth_version or 0) + 1

        db.flush()
        for staged_path, final_path in staged_files:
            final_path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            staged_path.replace(final_path)
        db.commit()
    except Exception:
        db.rollback()
        for path in installed_files:
            path.unlink(missing_ok=True)
        raise
    finally:
        if staged_directory is not None:
            shutil.rmtree(staged_directory, ignore_errors=True)

    for key in old_photo_keys:
        if Path(key).name == key:
            (photo_directory / key).unlink(missing_ok=True)
    if photo_directory.exists():
        for path in photo_directory.iterdir():
            if path.is_file() and path not in installed_files:
                path.unlink(missing_ok=True)

    return preview_export(parsed)
