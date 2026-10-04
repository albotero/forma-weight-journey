import asyncio
from collections.abc import Generator
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from urllib.parse import parse_qs, urlparse
from zoneinfo import ZoneInfo

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.config import settings
from app.main import app
from app.models import JournalEntry, PasswordResetToken, RefreshSession, TelegramConnection, User
from app.password_reset_email import send_email_verification_email, send_password_reset_email
from app.security import hash_password_reset_token
from app.routers import auth as auth_routes

engine = create_engine(
    "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
TestingSession = sessionmaker(
    bind=engine, autoflush=False, expire_on_commit=False)
Base.metadata.create_all(engine)


def override_get_db() -> Generator[Session, None, None]:
    session = TestingSession()
    try:
        yield session
    finally:
        session.close()


app.dependency_overrides[get_db] = override_get_db
settings.smtp_host = "smtp.test.example"
settings.smtp_from_email = "noreply@example.com"
settings.public_app_url = "https://forma.example.com"
verification_emails: dict[str, tuple[str, str]] = {}


def capture_verification_email(email: str, token: str, purpose: str) -> None:
    verification_emails[email] = (token, purpose)


auth_routes.send_email_verification_email = capture_verification_email


class VerificationAwareTestClient(TestClient):
    def raw_post(self, url: str, *args, **kwargs):
        return super().post(url, *args, **kwargs)

    def post(self, url: str, *args, **kwargs):
        response = super().post(url, *args, **kwargs)
        if url != "/api/auth/register" or response.status_code != 202:
            return response
        account = kwargs["json"]
        email = account["email"].lower()
        token, purpose = verification_emails.pop(email)
        assert purpose == "signup"
        confirmed = super().post(
            "/api/auth/email-verification/confirm", json={"token": token})
        assert confirmed.status_code == 200
        return super().post("/api/auth/login", data={
            "username": email, "password": account["password"],
        })


client = VerificationAwareTestClient(app, base_url="https://testserver")
app.state.limiter.enabled = False


def test_weight_records_are_isolated_per_account() -> None:
    first = client.post(
        "/api/auth/register", json={"email": "first@example.com", "password": "a-safe-password-123"})
    second = client.post("/api/auth/register", json={
                         "email": "second@example.com", "password": "another-safe-password-456"})
    assert first.status_code == 200
    assert second.status_code == 200
    first_token = first.json()["access_token"]
    second_token = second.json()["access_token"]

    added = client.post(
        "/api/weights", headers={"Authorization": f"Bearer {first_token}"}, json={"weight_kg": 101.8})
    assert added.status_code == 201
    first_read = client.get(
        "/api/weights", headers={"Authorization": f"Bearer {first_token}"})
    second_read = client.get(
        "/api/weights", headers={"Authorization": f"Bearer {second_token}"})
    assert len(first_read.json()) == 1
    assert second_read.json() == []


def test_dose_requires_medication_owned_by_user() -> None:
    created = client.post(
        "/api/auth/register", json={"email": "owner@example.com", "password": "yet-another-password-789"})
    token = created.json()["access_token"]
    response = client.post(
        "/api/doses", headers={"Authorization": f"Bearer {token}"}, json={"medication_id": 99999, "dose_mg": 5})
    assert response.status_code == 404


def test_signup_requires_email_verification_and_tokens_are_single_use() -> None:
    email = "verify-signup@example.com"
    password = "verify-signup-password-123"
    registration = client.raw_post("/api/auth/register", json={
        "email": email, "password": password,
    })
    assert registration.status_code == 202
    assert "access_token" not in registration.json()
    assert client.post("/api/auth/login", data={
        "username": email, "password": password,
    }).status_code == 403
    recovery = client.raw_post("/api/auth/password-reset/request", json={
        "email": email,
    })
    assert recovery.status_code == 202
    with TestingSession() as db:
        user = db.scalar(select(User).where(User.email == email))
        assert user is not None
        assert db.scalar(select(PasswordResetToken).where(
            PasswordResetToken.user_id == user.id)) is None

    first_token, _ = verification_emails[email]
    resent = client.raw_post("/api/auth/email-verification/request", json={
        "email": email,
    })
    assert resent.status_code == 202
    second_token, _ = verification_emails[email]
    assert first_token != second_token
    assert client.raw_post("/api/auth/email-verification/confirm", json={
        "token": first_token,
    }).status_code == 400
    verified = client.raw_post("/api/auth/email-verification/confirm", json={
        "token": second_token,
    })
    assert verified.status_code == 200
    assert client.raw_post("/api/auth/email-verification/confirm", json={
        "token": second_token,
    }).status_code == 400
    assert client.post("/api/auth/login", data={
        "username": email, "password": password,
    }).status_code == 200
    unknown = client.raw_post("/api/auth/email-verification/request", json={
        "email": "unknown-verify@example.com",
    })
    assert unknown.status_code == 202
    assert unknown.json() == resent.json()


def test_email_change_requires_password_and_confirmation_and_revokes_sessions() -> None:
    old_email = "email-change-old@example.com"
    new_email = "email-change-new@example.com"
    password = "email-change-password-123"
    registered = client.post("/api/auth/register", json={
        "email": old_email, "password": password,
    })
    headers = {"Authorization": f"Bearer {registered.json()['access_token']}"}
    invalid = client.post("/api/auth/email-change/request", headers=headers, json={
        "current_password": "wrong-current-password", "new_email": new_email,
    })
    assert invalid.status_code == 400

    requested = client.post("/api/auth/email-change/request", headers=headers, json={
        "current_password": password, "new_email": new_email,
    })
    assert requested.status_code == 202
    account = client.get("/api/account", headers=headers).json()
    assert account["email"] == old_email
    assert account["pending_email"] == new_email
    verification_token, purpose = verification_emails[new_email]
    assert purpose == "email-change"

    confirmed = client.raw_post("/api/auth/email-verification/confirm", json={
        "token": verification_token,
    })
    assert confirmed.status_code == 200
    assert client.get("/api/account", headers=headers).status_code == 401
    assert client.post("/api/auth/login", data={
        "username": old_email, "password": password,
    }).status_code == 401
    new_login = client.post("/api/auth/login", data={
        "username": new_email, "password": password,
    })
    assert new_login.status_code == 200
    new_headers = {
        "Authorization": f"Bearer {new_login.json()['access_token']}"}
    changed_account = client.get("/api/account", headers=new_headers).json()
    assert changed_account["email"] == new_email
    assert changed_account["pending_email"] is None


def test_registration_starts_without_assuming_medication_and_dose_is_calculated() -> None:
    created = client.post("/api/auth/register", json={
                          "email": "dose-owner@example.com", "password": "dose-owner-password-123"})
    token = created.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    medications = client.get("/api/medications", headers=headers).json()
    assert medications == []
    medication = client.post("/api/medications", headers=headers, json={
        "name": "Medicamento de prueba", "concentration_mg": 10,
        "concentration_volume_ml": 0.5, "units_per_ml": 100,
    }).json()
    assert medication["is_primary"] is True
    assert medication["dosing_interval"] is None

    recorded = client.post("/api/doses", headers=headers,
                           json={"medication_id": medication["id"], "dose_mg": 5})
    assert recorded.status_code == 201
    assert recorded.json()["calculated_volume_ml"] == 0.25
    assert recorded.json()["calculated_u100_units"] == 25


def test_oral_medication_and_doses_keep_their_unit_without_injection_math() -> None:
    created = client.post("/api/auth/register", json={
        "email": "oral-medication@example.com", "password": "oral-medication-password-123"})
    headers = {"Authorization": f"Bearer {created.json()['access_token']}"}
    medication = client.post("/api/medications", headers=headers, json={
        "name": "Vitamina D3", "route": "oral", "dosing_interval": "weekly",
        "notes": "Reposición indicada por profesional de salud",
    })
    assert medication.status_code == 201
    assert medication.json()["route"] == "oral"
    assert medication.json()["dosing_interval"] == "weekly"
    assert medication.json()["concentration_mg"] is None
    assert medication.json()["concentration_volume_ml"] is None

    dose = client.post("/api/doses", headers=headers, json={
        "medication_id": medication.json()["id"],
        "dose_amount": 2000,
        "dose_unit": "UI",
    })
    assert dose.status_code == 201
    assert dose.json()["dose_amount"] == 2000
    assert dose.json()["dose_unit"] == "UI"
    assert dose.json()["dose_mg"] is None
    assert dose.json()["calculated_volume_ml"] is None
    assert dose.json()["calculated_u100_units"] is None


def test_medication_concentration_can_be_changed_and_is_user_scoped() -> None:
    owner = client.post("/api/auth/register", json={
                        "email": "concentration-owner@example.com", "password": "concentration-owner-123"})
    other = client.post("/api/auth/register", json={
                        "email": "concentration-other@example.com", "password": "concentration-other-123"})
    owner_headers = {"Authorization": f"Bearer {owner.json()['access_token']}"}
    other_headers = {"Authorization": f"Bearer {other.json()['access_token']}"}
    medication = client.post("/api/medications", headers=owner_headers, json={
        "name": "Medicamento de prueba", "concentration_mg": 10,
        "concentration_volume_ml": 0.5, "units_per_ml": 100,
    }).json()
    changed = client.put(f"/api/medications/{medication['id']}", headers=owner_headers, json={
        "name": "Tirzepatida", "active": True, "concentration_mg": 10, "concentration_volume_ml": 0.4, "units_per_ml": 100})
    assert changed.status_code == 200
    assert changed.json()["concentration_mg"] / \
        changed.json()["concentration_volume_ml"] == 25
    dose = client.post("/api/doses", headers=owner_headers,
                       json={"medication_id": medication["id"], "dose_mg": 5})
    assert dose.json()["calculated_volume_ml"] == 0.2
    assert dose.json()["calculated_u100_units"] == 20
    forbidden = client.put(f"/api/medications/{medication['id']}", headers=other_headers, json={
        "name": "Tirzepatida", "active": True, "concentration_mg": 5, "concentration_volume_ml": 0.5, "units_per_ml": 100})
    assert forbidden.status_code == 404


def test_primary_medication_is_unique_and_replaced_when_archived() -> None:
    created = client.post("/api/auth/register", json={
        "email": "primary-medication@example.com", "password": "primary-medication-password-123"})
    headers = {"Authorization": f"Bearer {created.json()['access_token']}"}
    first = client.post("/api/medications", headers=headers, json={
        "name": "Liraglutida", "concentration_mg": 6, "concentration_volume_ml": 3,
    }).json()
    second = client.post("/api/medications", headers=headers, json={
        "name": "Vitamina D3", "route": "oral",
    }).json()
    assert first["is_primary"] is True
    assert second["is_primary"] is False

    selected = client.patch(
        f"/api/medications/{second['id']}/primary", headers=headers)
    assert selected.status_code == 200
    medications = client.get("/api/medications", headers=headers).json()
    assert {item["id"]
            for item in medications if item["is_primary"]} == {second["id"]}

    assert client.delete(
        f"/api/medications/{second['id']}", headers=headers).status_code == 204
    medications = client.get("/api/medications", headers=headers).json()
    assert next(item for item in medications if item["id"] == first["id"])[
        "is_primary"] is True


def test_medication_dosing_interval_is_optional_and_validated() -> None:
    created = client.post("/api/auth/register", json={
                          "email": "cadence-owner@example.com", "password": "cadence-password-123"})
    headers = {"Authorization": f"Bearer {created.json()['access_token']}"}
    payload = {"name": "Medicamento", "concentration_mg": 10,
               "concentration_volume_ml": 0.5, "dosing_interval": "weekly"}
    saved = client.post("/api/medications", headers=headers, json=payload)
    assert saved.status_code == 201
    assert saved.json()["dosing_interval"] == "weekly"
    assert client.get("/api/medications",
                      headers=headers).json()[0]["dosing_interval"] == "weekly"
    updated = client.put(f"/api/medications/{saved.json()['id']}", headers=headers,
                         json={**payload, "dosing_interval": "daily"})
    assert updated.status_code == 200
    assert updated.json()["dosing_interval"] == "daily"
    invalid = client.put(f"/api/medications/{saved.json()['id']}", headers=headers,
                         json={**payload, "dosing_interval": "hourly"})
    assert invalid.status_code == 422


def test_medication_can_be_permanently_deleted_with_its_doses() -> None:
    owner = client.post("/api/auth/register", json={
                        "email": "delete-owner@example.com", "password": "delete-owner-password-123"})
    other = client.post("/api/auth/register", json={
                        "email": "delete-other@example.com", "password": "delete-other-password-123"})
    owner_headers = {"Authorization": f"Bearer {owner.json()['access_token']}"}
    other_headers = {"Authorization": f"Bearer {other.json()['access_token']}"}
    medication = client.post("/api/medications", headers=owner_headers, json={
        "name": "Medicamento a eliminar", "concentration_mg": 10,
        "concentration_volume_ml": 0.5, "units_per_ml": 100,
    }).json()
    dose = client.post("/api/doses", headers=owner_headers,
                       json={"medication_id": medication["id"], "dose_mg": 5})
    assert dose.status_code == 201

    forbidden = client.delete(
        f"/api/medications/{medication['id']}/permanent", headers=other_headers)
    assert forbidden.status_code == 404

    deleted = client.delete(
        f"/api/medications/{medication['id']}/permanent", headers=owner_headers)
    assert deleted.status_code == 204
    assert client.get("/api/medications", headers=owner_headers).json() == []
    assert client.get("/api/doses", headers=owner_headers).json() == []
    assert client.delete(
        f"/api/medications/{medication['id']}/permanent", headers=owner_headers).status_code == 404


def test_protected_endpoints_require_authentication() -> None:
    assert client.get("/api/weights").status_code == 401


def test_account_export_preview_and_restore_round_trip(monkeypatch, tmp_path) -> None:
    monkeypatch.setattr(settings, "storage_path", str(tmp_path))
    registered = client.post("/api/auth/register", json={
        "email": "data-transfer@example.com", "password": "data-transfer-password-123"})
    other = client.post("/api/auth/register", json={
        "email": "data-transfer-other@example.com", "password": "data-transfer-other-password-123"})
    headers = {"Authorization": f"Bearer {registered.json()['access_token']}"}
    other_headers = {"Authorization": f"Bearer {other.json()['access_token']}"}
    medication = client.post("/api/medications", headers=headers, json={
        "name": "Registro de prueba", "concentration_mg": 10,
        "concentration_volume_ml": 0.5, "units_per_ml": 100,
        "dosing_interval": "weekly",
    }).json()
    oral_medication_response = client.post("/api/medications", headers=headers, json={
        "name": "Vitamina D3", "route": "oral", "dosing_interval": "daily",
    })
    assert oral_medication_response.status_code == 201
    oral_medication = oral_medication_response.json()
    assert medication["is_primary"] is True
    assert oral_medication["is_primary"] is False
    client.post("/api/medications", headers=other_headers, json={
        "name": "Otro medicamento", "concentration_mg": 10,
        "concentration_volume_ml": 0.5, "units_per_ml": 100,
    })
    dose = client.post("/api/doses", headers=headers, json={
        "medication_id": medication["id"], "dose_mg": 2.5,
    })
    assert dose.status_code == 201
    oral_dose = client.post("/api/doses", headers=headers, json={
        "medication_id": oral_medication["id"], "dose_amount": 2000, "dose_unit": "UI",
    })
    assert oral_dose.status_code == 201
    original_weight = client.post("/api/weights", headers=headers, json={
        "weight_kg": 82.5,
    })
    assert original_weight.status_code == 201
    catalog = client.post("/api/catalog", headers=headers, json={
        "category": "lab", "name": "Glucosa", "unit": "mg/dL",
        "normal_min": 70, "normal_max": 100,
    })
    assert catalog.status_code == 201
    entry = client.post("/api/entries", headers=headers, json={
        "module": "labs", "title": "Glucosa", "data": {
            "results": [{"catalog_item_id": catalog.json()["id"], "name": "Glucosa", "value": 95}],
        },
    })
    assert entry.status_code == 201
    taken_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    photo_bytes = b"\xff\xd8\xffforma-test-image"
    photo = client.post("/api/photos", headers=headers, data={"caption": "Foto de prueba", "taken_at": taken_at},
                        files={"file": ("progress.jpg", photo_bytes, "image/jpeg")})
    assert photo.status_code == 201

    exported = client.get("/api/account/export", headers=headers)
    assert exported.status_code == 200
    assert exported.headers["content-type"] == "application/zip"
    json_export = client.get("/api/account/export/json", headers=headers)
    assert json_export.status_code == 200
    assert json_export.headers["content-type"].startswith("application/json")
    json_document = json_export.json()
    assert json_document["format"] == "forma-account-json-export"
    assert json_document["weights"][0]["weight_kg"] == 82.5
    exported_oral = next(
        item for item in json_document["medications"] if item["name"] == "Vitamina D3")
    assert exported_oral["route"] == "oral"
    assert exported_oral["is_primary"] is False
    exported_oral_dose = next(
        item for item in json_document["doses"] if item["medication_key"] == exported_oral["key"])
    assert exported_oral_dose["dose_amount"] == 2000
    assert exported_oral_dose["dose_unit"] == "UI"
    assert json_document["media_files_included"] is False
    assert "file" not in json_document["photos"][0]
    assert "sha256" not in json_document["photos"][0]
    upload = {"file": ("forma-account-export.zip",
                       exported.content, "application/zip")}
    preview = client.post("/api/account/import/preview",
                          headers=headers, files=upload)
    assert preview.status_code == 200
    assert preview.json()["counts"]["weights"] == 1
    assert preview.json()["counts"]["photos"] == 1

    wrong_account = client.post(
        "/api/account/import/preview", headers=other_headers, files=upload)
    assert wrong_account.status_code == 422
    client.post("/api/weights", headers=headers, json={"weight_kg": 79.5})

    restored = client.post("/api/account/import",
                           headers=headers, files=upload)
    assert restored.status_code == 200
    assert restored.json()["replaces_existing_data"] is True
    assert client.get("/api/account", headers=headers).status_code == 401
    login = client.post("/api/auth/login", data={
        "username": "data-transfer@example.com", "password": "data-transfer-password-123"})
    headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
    weights = client.get("/api/weights", headers=headers).json()
    assert len(weights) == 1 and weights[0]["weight_kg"] == 82.5
    restored_medications = client.get(
        "/api/medications", headers=headers).json()
    restored_medication = next(
        item for item in restored_medications if item["name"] == "Registro de prueba")
    assert restored_medication["dosing_interval"] == "weekly"
    restored_oral = next(
        item for item in restored_medications if item["name"] == "Vitamina D3")
    assert restored_oral["route"] == "oral"
    assert restored_medication["is_primary"] is True
    restored_doses = client.get("/api/doses", headers=headers).json()
    restored_dose = next(
        item for item in restored_doses if item["medication_id"] == restored_medication["id"])
    assert restored_dose["medication_id"] == restored_medication["id"]
    restored_oral_dose = next(
        item for item in restored_doses if item["medication_id"] == restored_oral["id"])
    assert restored_oral_dose["dose_amount"] == 2000
    assert restored_oral_dose["dose_unit"] == "UI"
    assert restored_oral_dose["calculated_volume_ml"] is None
    restored_entry = client.get("/api/entries/labs", headers=headers).json()[0]
    restored_catalog = client.get("/api/catalog/lab", headers=headers).json()
    custom_item = next(
        item for item in restored_catalog if item["name"] == "Glucosa")
    assert custom_item["normal_min"] == 70 and custom_item["normal_max"] == 100
    assert restored_entry["data"]["results"][0]["catalog_item_id"] == custom_item["id"]
    restored_photos = client.get("/api/photos", headers=headers).json()
    image = client.get(
        f"/api/photos/{restored_photos[0]['id']}/image", headers=headers)
    assert image.status_code == 200 and image.content == photo_bytes


def test_password_reset_is_generic_hashed_single_use_and_revokes_sessions(monkeypatch) -> None:
    monkeypatch.setattr(settings, "smtp_host", "smtp.example.com")
    monkeypatch.setattr(settings, "smtp_from_email", "noreply@example.com")
    monkeypatch.setattr(settings, "public_app_url",
                        "https://forma.example.com")
    sent: list[tuple[str, str]] = []
    monkeypatch.setattr(
        "app.routers.auth.send_password_reset_email",
        lambda email, token: sent.append((email, token)),
    )
    old_password = "recovery-old-password-123"
    new_password = "recovery-new-password-456"
    registered = client.post("/api/auth/register", json={
        "email": "password-reset@example.com", "password": old_password})
    request = client.post("/api/auth/password-reset/request", json={
        "email": "password-reset@example.com"})
    assert request.status_code == 202
    assert request.json()["message"].startswith("Si existe una cuenta")
    assert sent and sent[0][0] == "password-reset@example.com"

    with TestingSession() as db:
        user = db.scalar(select(User).where(
            User.email == "password-reset@example.com"))
        assert user is not None
        reset = db.scalar(select(PasswordResetToken).where(
            PasswordResetToken.user_id == user.id))
        assert reset is not None
        assert reset.token_hash == hash_password_reset_token(sent[0][1])
        assert sent[0][1] != reset.token_hash
        user_id = user.id

    reset_response = client.post("/api/auth/password-reset/confirm", json={
        "token": sent[0][1], "new_password": new_password})
    assert reset_response.status_code == 200
    old_access_headers = {
        "Authorization": f"Bearer {registered.json()['access_token']}"}
    assert client.get(
        "/api/account", headers=old_access_headers).status_code == 401
    with TestingSession() as db:
        sessions = db.scalars(select(RefreshSession).where(
            RefreshSession.user_id == user_id)).all()
        assert sessions and all(
            session.revoked_at is not None for session in sessions)
    assert client.post("/api/auth/login", data={
        "username": "password-reset@example.com", "password": old_password}).status_code == 401
    assert client.post("/api/auth/login", data={
        "username": "password-reset@example.com", "password": new_password}).status_code == 200
    assert client.post("/api/auth/password-reset/confirm", json={
        "token": sent[0][1], "new_password": "replayed-reset-password-789"}).status_code == 400

    unknown = client.post("/api/auth/password-reset/request", json={
        "email": "unknown-reset@example.com"})
    assert unknown.status_code == 202
    assert unknown.json() == request.json()


def test_password_reset_rejects_expired_token_and_requires_mail_configuration(monkeypatch) -> None:
    monkeypatch.setattr(settings, "smtp_host", "smtp.example.com")
    monkeypatch.setattr(settings, "smtp_from_email", "noreply@example.com")
    monkeypatch.setattr(settings, "public_app_url",
                        "https://forma.example.com")
    sent: list[str] = []
    monkeypatch.setattr(
        "app.routers.auth.send_password_reset_email",
        lambda _email, token: sent.append(token),
    )
    client.post("/api/auth/register", json={
        "email": "expired-reset@example.com", "password": "expired-reset-password-123"})
    assert client.post("/api/auth/password-reset/request", json={
        "email": "expired-reset@example.com"}).status_code == 202
    with TestingSession() as db:
        reset = db.scalar(select(PasswordResetToken).where(
            PasswordResetToken.token_hash == hash_password_reset_token(sent[0])))
        assert reset is not None
        reset.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
        db.commit()
    expired = client.post("/api/auth/password-reset/confirm", json={
        "token": sent[0], "new_password": "expired-new-password-123"})
    assert expired.status_code == 400

    monkeypatch.setattr(settings, "smtp_host", "")
    unavailable = client.post("/api/auth/password-reset/request", json={
        "email": "expired-reset@example.com"})
    assert unavailable.status_code == 503


def test_password_reset_email_uses_tls_and_keeps_token_in_url_fragment(monkeypatch) -> None:
    monkeypatch.setattr(settings, "smtp_host", "smtp.example.com")
    monkeypatch.setattr(settings, "smtp_port", 587)
    monkeypatch.setattr(settings, "smtp_username", "")
    monkeypatch.setattr(settings, "smtp_from_email", "noreply@example.com")
    monkeypatch.setattr(settings, "smtp_use_ssl", False)
    monkeypatch.setattr(settings, "public_app_url",
                        "https://forma.example.com")
    sent = []

    class FakeSMTP:
        def __init__(self, *_args, **_kwargs):
            self.tls_enabled = False

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def starttls(self, *, context):
            self.tls_enabled = context is not None

        def send_message(self, message):
            sent.append((self.tls_enabled, message))

    monkeypatch.setattr("app.password_reset_email.smtplib.SMTP", FakeSMTP)
    send_password_reset_email("reset@example.com", "secret+/token")

    assert sent and sent[0][0]
    message = sent[0][1]
    email_date = parsedate_to_datetime(message["Date"])
    assert abs((datetime.now(timezone.utc) - email_date).total_seconds()) < 10
    assert message["Message-ID"].startswith("<")
    body = message.get_content()
    assert "https://forma.example.com/#reset?token=secret%2B%2Ftoken" in body
    assert "?token=" not in body.split("#", maxsplit=1)[0]


def test_verification_email_contains_expiring_fragment_link_and_date(monkeypatch) -> None:
    monkeypatch.setattr(settings, "smtp_host", "smtp.example.com")
    monkeypatch.setattr(settings, "smtp_port", 587)
    monkeypatch.setattr(settings, "smtp_username", "")
    monkeypatch.setattr(settings, "smtp_from_email", "noreply@example.com")
    monkeypatch.setattr(settings, "smtp_use_ssl", False)
    monkeypatch.setattr(settings, "public_app_url",
                        "https://forma.example.com")
    sent = []

    class FakeSMTP:
        def __init__(self, *_args, **_kwargs):
            self.tls_enabled = False

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def starttls(self, *, context):
            self.tls_enabled = context is not None

        def send_message(self, message):
            sent.append((self.tls_enabled, message))

    monkeypatch.setattr("app.password_reset_email.smtplib.SMTP", FakeSMTP)
    send_email_verification_email(
        "verify@example.com", "verify+/token", "signup")

    assert sent and sent[0][0]
    message = sent[0][1]
    assert abs((datetime.now(timezone.utc) -
               parsedate_to_datetime(message["Date"])).total_seconds()) < 10
    assert "https://forma.example.com/#verify?token=verify%2B%2Ftoken" in message.get_content()


def test_profile_rejects_unknown_timezone() -> None:
    created = client.post("/api/auth/register", json={
                          "email": "timezone-owner@example.com", "password": "timezone-owner-password-123"})
    headers = {"Authorization": f"Bearer {created.json()['access_token']}"}
    response = client.put("/api/profile", headers=headers, json={
                          "height_cm": 180, "initial_weight_kg": 106, "timezone": "Not/A_Timezone"})
    assert response.status_code == 422


def test_profile_and_measurements_reject_invalid_future_dates() -> None:
    registered = client.post("/api/auth/register", json={
        "email": "future-dates@example.com", "password": "future-dates-password-123"})
    headers = {"Authorization": f"Bearer {registered.json()['access_token']}"}
    future = (datetime.now(timezone.utc) + timedelta(days=2)).isoformat()
    assert client.post("/api/weights", headers=headers, json={
        "weight_kg": 80, "measured_at": future}).status_code == 422
    assert client.put("/api/profile", headers=headers, json={
        "height_cm": 180, "initial_weight_kg": 106, "timezone": "UTC",
        "birth_date": "2099-01-01",
    }).status_code == 422
    assert client.put("/api/profile", headers=headers, json={
        "height_cm": 180, "initial_weight_kg": 106, "timezone": "UTC",
        "birth_date": "not-a-date",
    }).status_code == 422


def test_account_settings_and_password_change_revoke_refresh_sessions() -> None:
    old_password = "account-settings-old-password-123"
    new_password = "account-settings-new-password-456"
    registered = client.post("/api/auth/register", json={
        "email": "account-settings@example.com", "password": old_password})
    headers = {"Authorization": f"Bearer {registered.json()['access_token']}"}
    account = client.get("/api/account", headers=headers)
    assert account.status_code == 200
    assert account.json()["email"] == "account-settings@example.com"

    wrong_current = client.put("/api/auth/password", headers=headers, json={
        "current_password": "wrong-current-password", "new_password": new_password})
    assert wrong_current.status_code == 400
    unchanged = client.put("/api/auth/password", headers=headers, json={
        "current_password": old_password, "new_password": old_password})
    assert unchanged.status_code == 422
    changed = client.put("/api/auth/password", headers=headers, json={
        "current_password": old_password, "new_password": new_password})
    assert changed.status_code == 204
    assert client.get("/api/account", headers=headers).status_code == 401

    with TestingSession() as db:
        user = db.scalar(select(User).where(
            User.email == "account-settings@example.com"))
        assert user is not None
        sessions = db.scalars(select(RefreshSession).where(
            RefreshSession.user_id == user.id)).all()
        assert sessions and all(
            session.revoked_at is not None for session in sessions)
    old_login = client.post(
        "/api/auth/login", data={"username": "account-settings@example.com", "password": old_password})
    new_login = client.post(
        "/api/auth/login", data={"username": "account-settings@example.com", "password": new_password})
    assert old_login.status_code == 401
    assert new_login.status_code == 200


def test_scale_composition_fields_round_trip_and_validate() -> None:
    registered = client.post(
        "/api/auth/register", json={"email": "scale@example.com", "password": "scale-password-123"})
    headers = {"Authorization": f"Bearer {registered.json()['access_token']}"}
    values = {
        "weight_kg": 80.5, "body_fat_percent": 24.1, "fat_free_mass_kg": 61.1,
        "subcutaneous_fat_percent": 20.3, "visceral_fat_index": 8,
        "body_water_percent": 55.2, "skeletal_muscle_percent": 41.2,
        "muscle_mass_kg": 57.7, "bone_mass_kg": 3.1, "protein_percent": 18.2,
        "bmr_kcal": 1680, "metabolic_age": 34,
    }
    created = client.post("/api/weights", headers=headers, json=values)
    assert created.status_code == 201
    assert {key: created.json()[key] for key in values} == values
    assert client.post("/api/weights", headers=headers,
                       json={"weight_kg": 80, "body_fat_percent": 101}).status_code == 422


def test_numeric_inputs_allow_two_decimals_and_reject_more() -> None:
    registered = client.post("/api/auth/register", json={
        "email": "precision@example.com", "password": "precision-password-123"})
    headers = {"Authorization": f"Bearer {registered.json()['access_token']}"}
    accepted = client.post("/api/weights", headers=headers, json={
        "weight_kg": 80.25, "body_fat_percent": 24.12})
    assert accepted.status_code == 201
    assert accepted.json()["weight_kg"] == 80.25
    assert client.post("/api/weights", headers=headers, json={
        "weight_kg": 80.253}).status_code == 422
    assert client.post("/api/body-measurements", headers=headers, json={
        "waist_cm": 80.25}).status_code == 201
    assert client.post("/api/body-measurements", headers=headers, json={
        "waist_cm": 80.253}).status_code == 422
    entry = client.post("/api/entries", headers=headers, json={
        "module": "activity", "title": "Caminata", "data": {"distance_km": 2.25}})
    assert entry.status_code == 201
    assert client.post("/api/entries", headers=headers, json={
        "module": "activity", "title": "Caminata", "data": {"distance_km": 2.253}}).status_code == 422


def test_activity_entries_support_single_activities_and_weekly_stats() -> None:
    registered = client.post("/api/auth/register", json={
        "email": "activity-types@example.com", "password": "activity-types-password-123"})
    headers = {"Authorization": f"Bearer {registered.json()['access_token']}"}
    single = client.post("/api/entries", headers=headers, json={
        "module": "activity", "title": "Bicicleta", "data": {
            "entry_type": "single", "activity_type": "Bicicleta",
            "duration_min": 45, "distance_km": 12.5, "calories_kcal": 320,
        },
    })
    assert single.status_code == 201
    assert single.json()["data"]["activity_type"] == "Bicicleta"

    other = client.post("/api/entries", headers=headers, json={
        "module": "activity", "title": "Senderismo", "data": {
            "entry_type": "single", "activity_type": "Otro",
            "other_activity": "Senderismo", "duration_min": 90,
        },
    })
    assert other.status_code == 201

    weekly = client.post("/api/entries", headers=headers, json={
        "module": "activity", "title": "Resumen semanal", "data": {
            "entry_type": "weekly", "weekly_calories_kcal": 2100,
            "weekly_steps": 56000, "weekly_distance_km": 35.25,
        },
    })
    assert weekly.status_code == 201
    assert weekly.json()["data"]["weekly_steps"] == 56000

    assert client.post("/api/entries", headers=headers, json={
        "module": "activity", "title": "Vacío", "data": {"entry_type": "weekly"},
    }).status_code == 422
    assert client.post("/api/entries", headers=headers, json={
        "module": "activity", "title": "Negativo", "data": {
            "entry_type": "weekly", "weekly_steps": -1,
        },
    }).status_code == 422


def test_composition_readings_are_returned_newest_first() -> None:
    registered = client.post("/api/auth/register", json={
        "email": "composition-order@example.com", "password": "composition-order-password-123"})
    headers = {"Authorization": f"Bearer {registered.json()['access_token']}"}
    client.post("/api/weights", headers=headers, json={
        "weight_kg": 90, "measured_at": "2025-01-01T12:00:00Z", "body_fat_percent": 30})
    client.post("/api/weights", headers=headers, json={
        "weight_kg": 89, "measured_at": "2025-02-01T12:00:00Z", "body_fat_percent": 29})
    readings = client.get("/api/weights", headers=headers).json()
    assert [record["weight_kg"] for record in readings] == [89, 90]


def test_records_with_matching_timestamp_are_ordered_by_newest_id_first() -> None:
    registered = client.post("/api/auth/register", json={
        "email": "same-time-order@example.com", "password": "same-time-order-password-123"})
    headers = {"Authorization": f"Bearer {registered.json()['access_token']}"}
    timestamp = "2026-01-15T12:00:00Z"
    older = client.post("/api/weights", headers=headers, json={
        "weight_kg": 82, "measured_at": timestamp}).json()
    newer = client.post("/api/weights", headers=headers, json={
        "weight_kg": 81, "measured_at": timestamp}).json()
    records = client.get("/api/weights", headers=headers).json()
    assert [record["id"] for record in records] == [newer["id"], older["id"]]


def test_telegram_connection_requires_a_valid_webhook_secret(monkeypatch) -> None:
    registered = client.post("/api/auth/register", json={
        "email": "telegram-security@example.com", "password": "telegram-security-password-123"})
    headers = {"Authorization": f"Bearer {registered.json()['access_token']}"}
    monkeypatch.setattr(
        settings, "telegram_webhook_secret", "secret-for-tests")
    assert client.post("/api/telegram/webhook", json={"message": {
                       "text": "/start invalid", "chat": {"id": 42}}}).status_code == 403
    response = client.post("/api/telegram/webhook", headers={
        "X-Telegram-Bot-Api-Secret-Token": "secret-for-tests"},
        json={"message": {"text": "/start invalid", "chat": {"id": 42}}})
    assert response.status_code == 200
    assert client.get("/api/telegram/connection",
                      headers=headers).json()["linked"] is False


def test_telegram_pairing_links_private_chat_once(monkeypatch) -> None:
    async def fake_send(_chat_id: str, _text: str) -> bool:
        return True

    monkeypatch.setattr(settings, "telegram_bot_token", "bot-token-for-tests")
    monkeypatch.setattr(settings, "telegram_bot_username", "forma_test_bot")
    monkeypatch.setattr(settings, "telegram_webhook_secret", "pairing-secret")
    monkeypatch.setattr(
        "app.routers.telegram.send_telegram_message", fake_send)
    registered = client.post("/api/auth/register", json={
        "email": "telegram-pairing@example.com", "password": "telegram-pairing-password-123"})
    headers = {"Authorization": f"Bearer {registered.json()['access_token']}"}
    pairing = client.post("/api/telegram/connection", headers=headers)
    assert pairing.status_code == 200
    code = parse_qs(urlparse(pairing.json()["start_url"]).query)["start"][0]
    webhook_headers = {"X-Telegram-Bot-Api-Secret-Token": "pairing-secret"}
    payload = {"message": {"text": f"/start {code}",
                           "chat": {"id": 24680, "type": "private"}}}
    assert client.post("/api/telegram/webhook",
                       headers=webhook_headers, json=payload).status_code == 200
    assert client.get("/api/telegram/connection",
                      headers=headers).json()["linked"] is True
    assert client.post("/api/telegram/webhook",
                       headers=webhook_headers, json=payload).status_code == 200
    status_response = client.get("/api/telegram/connection", headers=headers)
    assert status_response.json()["linked"] is True


def test_due_telegram_reminder_is_sent_and_disabled(monkeypatch) -> None:
    sent: list[tuple[str, str, datetime]] = []
    followups: list[tuple[str, list[int], int]] = []

    async def fake_send(chat_id: str, text: str, scheduled_at: datetime) -> bool:
        sent.append((chat_id, text, scheduled_at))
        return True

    async def fake_answer(_callback_id: str, _text: str) -> bool:
        return True

    async def fake_followup(chat_id: str, occurrence: int) -> bool:
        followups.append((chat_id, occurrence))
        return True

    monkeypatch.setattr(settings, "telegram_bot_token", "bot-token-for-tests")
    monkeypatch.setattr(settings, "telegram_webhook_secret", "due-secret")
    monkeypatch.setattr("app.telegram.SessionLocal", TestingSession)
    monkeypatch.setattr("app.telegram.send_reminder_message", fake_send)
    monkeypatch.setattr(
        "app.routers.telegram.send_reminder_followup", fake_followup)
    monkeypatch.setattr(
        "app.routers.telegram.answer_callback_query", fake_answer)
    registered = client.post("/api/auth/register", json={
        "email": "telegram-due@example.com", "password": "telegram-due-password-123"})
    token = registered.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    due_time = (datetime.now(timezone.utc) - timedelta(seconds=30)).isoformat()
    reminder = client.post("/api/entries", headers=headers, json={
        "module": "reminders", "title": "Recordar cita", "occurred_at": due_time,
        "data": {
            "reminder_at": due_time,
            "repeat": "No repetir",
            "enabled": "Sí",
            "source_recorded_at": "2026-09-30T11:45:00+00:00",
        },
    })
    assert reminder.status_code == 201
    second_reminder = client.post("/api/entries", headers=headers, json={
        "module": "reminders", "title": "Recordar control", "occurred_at": due_time,
        "data": {"reminder_at": due_time, "repeat": "No repetir", "enabled": "Sí"},
    })
    assert second_reminder.status_code == 201
    with TestingSession() as db:
        user = db.scalar(select(User).where(
            User.email == "telegram-due@example.com"))
        assert user is not None
        db.add(TelegramConnection(user_id=user.id, chat_id="13579"))
        db.commit()

    from app.telegram import dispatch_due_reminders

    asyncio.run(dispatch_due_reminders())
    assert len(sent) == 1 and sent[0][0] == "13579"
    assert "Recordar cita" in sent[0][1] and "Recordar control" in sent[0][1]
    assert "Último registro: 30/09/2026 06:45" in sent[0][1]
    occurrence = int(sent[0][2].timestamp())
    entry_ids = [reminder.json()["id"], second_reminder.json()["id"]]
    callback = {"callback_query": {
        "id": "callback-123",
        "data": f"done:{occurrence}",
        "message": {"chat": {"id": 13579, "type": "private"}},
    }}
    response = client.post("/api/telegram/webhook", headers={
        "X-Telegram-Bot-Api-Secret-Token": "due-secret"}, json=callback)
    assert response.status_code == 200
    with TestingSession() as db:
        for entry_id in entry_ids:
            saved = db.get(JournalEntry, entry_id)
            assert saved is not None and saved.data["enabled"] == "No"
            assert saved.data["completed_reminder_epoch"] == occurrence
            assert saved.data["completed_at"]
    assert followups == [("13579", occurrence)]


def test_due_telegram_reminders_can_be_snoozed_as_a_group(monkeypatch) -> None:
    sent: list[tuple[str, str, datetime]] = []
    answers: list[str] = []

    async def fake_send(chat_id: str, text: str, scheduled_at: datetime) -> bool:
        sent.append((chat_id, text, scheduled_at))
        return True

    async def fake_answer(_callback_id: str, text: str) -> bool:
        answers.append(text)
        return True

    monkeypatch.setattr(settings, "telegram_bot_token", "bot-token-for-tests")
    monkeypatch.setattr(settings, "telegram_webhook_secret", "snooze-secret")
    monkeypatch.setattr("app.telegram.SessionLocal", TestingSession)
    monkeypatch.setattr("app.telegram.send_reminder_message", fake_send)
    monkeypatch.setattr(
        "app.routers.telegram.answer_callback_query", fake_answer)
    registered = client.post("/api/auth/register", json={
        "email": "telegram-snooze@example.com", "password": "telegram-snooze-password-123"})
    headers = {"Authorization": f"Bearer {registered.json()['access_token']}"}
    due_time = (datetime.now(timezone.utc) - timedelta(seconds=30)).isoformat()
    reminder_ids = []
    for title in ("Recordar cita", "Registrar peso"):
        reminder = client.post("/api/entries", headers=headers, json={
            "module": "reminders", "title": title, "occurred_at": due_time,
            "data": {"reminder_at": due_time, "repeat": "No repetir", "enabled": "Sí"},
        })
        assert reminder.status_code == 201
        reminder_ids.append(reminder.json()["id"])
    with TestingSession() as db:
        user = db.scalar(select(User).where(
            User.email == "telegram-snooze@example.com"))
        assert user is not None
        db.add(TelegramConnection(user_id=user.id, chat_id="987654321"))
        db.commit()

    from app.telegram import dispatch_due_reminders

    asyncio.run(dispatch_due_reminders())
    assert len(sent) == 1
    occurrence = int(sent[0][2].timestamp())
    webhook_headers = {"X-Telegram-Bot-Api-Secret-Token": "snooze-secret"}

    def send_callback(action: str) -> None:
        response = client.post("/api/telegram/webhook", headers=webhook_headers, json={
            "callback_query": {
                "id": f"callback-{len(answers)}",
                "data": action,
                "message": {"chat": {"id": 987654321, "type": "private"}},
            },
        })
        assert response.status_code == 200

    send_callback(f"snooze:900:{occurrence}")
    with TestingSession() as db:
        snoozed_until = None
        for reminder_id in reminder_ids:
            reminder = db.get(JournalEntry, reminder_id)
            assert reminder is not None
            assert reminder.data["snoozed_from_epoch"] == occurrence
            assert reminder.data.get("completed_reminder_epoch") is None
            if snoozed_until is None:
                snoozed_until = reminder.data["reminder_at"]
            assert reminder.data["reminder_at"] == snoozed_until
        assert snoozed_until is not None
        remaining = datetime.fromisoformat(
            snoozed_until).timestamp() - datetime.now(timezone.utc).timestamp()
        assert 890 <= remaining <= 900

    send_callback(f"done:{occurrence}")
    assert answers[-1] == "Este aviso fue pospuesto; espera el nuevo horario."
    send_callback(f"snooze:900:{occurrence}")
    assert answers[-1] == "Este aviso ya no se puede posponer."


def test_automatic_reminders_track_records_and_can_be_disabled_without_deleting() -> None:
    registered = client.post("/api/auth/register", json={
        "email": "automatic-reminders@example.com", "password": "automatic-reminders-password-123"})
    headers = {"Authorization": f"Bearer {registered.json()['access_token']}"}
    forged_auto = client.post("/api/entries", headers=headers, json={
        "module": "reminders", "title": "Manual", "data": {"auto_generated": True},
    })
    assert forged_auto.status_code == 422
    medication = client.post("/api/medications", headers=headers, json={
        "name": "Medicamento de prueba", "concentration_mg": 10,
        "concentration_volume_ml": 0.5, "units_per_ml": 100,
    }).json()
    dose = client.post("/api/doses", headers=headers, json={
        "medication_id": medication["id"], "dose_mg": 2.5,
    })
    assert dose.status_code == 201
    weight = client.post("/api/weights", headers=headers, json={
        "weight_kg": 80, "body_fat_percent": 25,
    })
    assert weight.status_code == 201
    measurements = client.post("/api/body-measurements", headers=headers, json={
        "waist_cm": 85,
    })
    assert measurements.status_code == 201

    listed = client.get("/api/entries/reminders", headers=headers)
    assert listed.status_code == 200
    automatic = {entry["data"]["auto_key"]: entry for entry in listed.json(
    ) if entry["data"].get("auto_generated")}
    assert set(automatic) == {
        "dose", "weight", "composition", "measurements", "blood_pressure",
        "symptoms", "activity",
    }
    assert automatic["dose"]["data"]["source_record_id"] == dose.json()["id"]
    assert automatic["dose"]["data"]["source_recorded_at"].startswith(dose.json()[
                                                                      "administered_at"])
    assert automatic["weight"]["data"]["source_record_id"] == weight.json()[
        "id"]
    assert automatic["composition"]["data"]["source_record_id"] == weight.json()[
        "id"]
    assert automatic["measurements"]["data"]["source_record_id"] == measurements.json()[
        "id"]
    assert automatic["blood_pressure"]["data"]["source_signature"] == "pending"
    assert automatic["symptoms"]["data"]["source_signature"] == "pending"
    original_reminder_id = automatic["weight"]["id"]
    original_date = automatic["weight"]["data"]["reminder_at"]
    composition_reminder = automatic["composition"]
    correct_composition_date = composition_reminder["data"]["reminder_at"]
    with TestingSession() as db:
        stale_composition_reminder = db.get(
            JournalEntry, composition_reminder["id"])
        assert stale_composition_reminder is not None
        stale_data = dict(stale_composition_reminder.data)
        stale_data["reminder_at"] = "2026-11-14T18:00:00+00:00"
        stale_composition_reminder.data = stale_data
        stale_composition_reminder.occurred_at = datetime(
            2026, 11, 14, 18, tzinfo=timezone.utc)
        db.commit()

    corrected_entries = client.get(
        "/api/entries/reminders", headers=headers).json()
    corrected_composition = next(
        entry for entry in corrected_entries if entry["id"] == composition_reminder["id"])
    assert corrected_composition["data"]["reminder_at"] == correct_composition_date

    disabled = client.patch(
        f"/api/entries/{original_reminder_id}/enabled", headers=headers, json={"enabled": False})
    assert disabled.status_code == 200
    assert disabled.json()["data"]["enabled"] == "No"
    assert client.put(f"/api/entries/{original_reminder_id}", headers=headers, json={
        "module": "reminders", "title": "Renombrar automático", "data": disabled.json()["data"],
    }).status_code == 409
    assert client.delete(
        f"/api/entries/{original_reminder_id}", headers=headers).status_code == 409

    latest_weight = client.post(
        "/api/weights", headers=headers, json={"weight_kg": 79.5})
    refreshed = client.get("/api/entries/reminders", headers=headers).json()
    weight_reminder = next(
        entry for entry in refreshed if entry["data"].get("auto_key") == "weight")
    assert weight_reminder["id"] == original_reminder_id
    assert weight_reminder["data"]["enabled"] == "Sí"
    assert weight_reminder["data"]["source_record_id"] == latest_weight.json()[
        "id"]
    assert weight_reminder["data"]["reminder_at"] == original_date


def test_lab_results_accept_text_values_alongside_numeric_ones() -> None:
    registered = client.post("/api/auth/register", json={
        "email": "lab-text-value@example.com", "password": "lab-text-value-password-123"})
    headers = {"Authorization": f"Bearer {registered.json()['access_token']}"}
    entry = client.post("/api/entries", headers=headers, json={
        "module": "labs", "title": "Panel de laboratorio", "data": {
            "results": [
                {"catalog_item_id": 1, "name": "Glucosa", "unit": "mg/dL",
                 "value": 95.5, "text_value": None},
                {"catalog_item_id": 2, "name": "Antígeno", "unit": None,
                 "value": None, "text_value": "Negativo"},
            ],
        },
    })
    assert entry.status_code == 201
    results = entry.json()["data"]["results"]
    assert results[0]["value"] == 95.5 and results[0]["text_value"] is None
    assert results[1]["value"] is None and results[1]["text_value"] == "Negativo"


def test_automatic_reminder_tracks_latest_blood_pressure_lab_entry() -> None:
    registered = client.post("/api/auth/register", json={
        "email": "blood-pressure-reminder@example.com", "password": "blood-pressure-password-123"})
    headers = {"Authorization": f"Bearer {registered.json()['access_token']}"}

    without_bp = client.get("/api/entries/reminders", headers=headers)
    pending_bp = next(
        entry for entry in without_bp.json() if entry["data"].get("auto_key") == "blood_pressure")
    assert pending_bp["data"]["source_signature"] == "pending"
    assert pending_bp["data"]["source_record_id"] is None

    lab_entry = client.post("/api/entries", headers=headers, json={
        "module": "labs", "title": "Presión arterial", "data": {
            "results": [{"catalog_item_id": 1, "name": "Presión arterial", "unit": "mmHg",
                        "systolic": 120, "diastolic": 80, "mean": 100}],
        },
    })
    assert lab_entry.status_code == 201

    listed = client.get("/api/entries/reminders", headers=headers)
    automatic = {entry["data"]["auto_key"]: entry for entry in listed.json(
    ) if entry["data"].get("auto_generated")}
    assert "blood_pressure" in automatic
    assert automatic["blood_pressure"]["data"]["source_record_id"] == lab_entry.json()[
        "id"]
    assert automatic["blood_pressure"]["data"]["source_signature"] != "pending"


def test_automatic_reminder_resync_updates_timezone_without_undoing_user_disable() -> None:
    registered = client.post("/api/auth/register", json={
        "email": "resync-timezone@example.com", "password": "resync-timezone-password-123"})
    headers = {"Authorization": f"Bearer {registered.json()['access_token']}"}
    medication = client.post("/api/medications", headers=headers, json={
        "name": "Medicamento de prueba", "concentration_mg": 10,
        "concentration_volume_ml": 0.5, "units_per_ml": 100,
    }).json()
    dose = client.post("/api/doses", headers=headers, json={
        "medication_id": medication["id"], "dose_mg": 2.5,
        "administered_at": "2026-03-01T17:30:00Z",
    })
    assert dose.status_code == 201
    original_reminders = client.get(
        "/api/entries/reminders", headers=headers).json()
    dose_reminder = next(
        entry for entry in original_reminders if entry["data"].get("auto_key") == "dose")

    assert client.delete(
        f"/api/medications/{medication['id']}", headers=headers).status_code == 204
    paused = client.get("/api/entries/reminders", headers=headers).json()
    paused_reminder = next(
        entry for entry in paused if entry["id"] == dose_reminder["id"])
    assert paused_reminder["data"]["enabled"] == "No"
    assert paused_reminder["data"]["source_missing"] is True

    explicitly_disabled = client.patch(
        f"/api/entries/{dose_reminder['id']}/enabled", headers=headers, json={"enabled": False})
    assert explicitly_disabled.status_code == 200

    profile = client.get("/api/profile", headers=headers).json()
    changed_profile = client.put("/api/profile", headers=headers, json={
        "height_cm": profile["height_cm"],
        "initial_weight_kg": profile["initial_weight_kg"],
        "timezone": "America/New_York",
        "reminder_time": "07:30",
        "birth_date": profile["birth_date"],
    })
    assert changed_profile.status_code == 200
    assert changed_profile.json()["reminder_time"] == "07:30"
    reactivated = client.put(f"/api/medications/{medication['id']}", headers=headers, json={
        "name": medication["name"], "active": True,
        "concentration_mg": medication["concentration_mg"],
        "concentration_volume_ml": medication["concentration_volume_ml"],
        "units_per_ml": medication["units_per_ml"],
    })
    assert reactivated.status_code == 200

    resynced = client.get("/api/entries/reminders", headers=headers).json()
    dose_reminder_after = next(
        entry for entry in resynced if entry["id"] == dose_reminder["id"])
    assert dose_reminder_after["data"]["enabled"] == "No"
    assert dose_reminder_after["data"]["reminder_at"] == "2026-03-08T11:30:00+00:00"
    assert dose_reminder_after["data"].get("source_missing") is None


def test_linked_telegram_chat_can_record_weight_and_symptom(monkeypatch) -> None:
    sent_messages = []

    async def fake_send(_chat_id: str, _text: str) -> bool:
        sent_messages.append(_text)
        return True

    monkeypatch.setattr(settings, "telegram_webhook_secret", "command-secret")
    monkeypatch.setattr(
        "app.routers.telegram.send_telegram_message", fake_send)
    monkeypatch.setattr("app.telegram.send_telegram_message", fake_send)
    registered = client.post("/api/auth/register", json={
        "email": "telegram-commands@example.com", "password": "telegram-commands-password-123"})
    token = registered.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    client.post("/api/medications", headers=headers, json={
        "name": "Medicamento de prueba", "concentration_mg": 10,
        "concentration_volume_ml": 0.5, "units_per_ml": 100,
    })
    with TestingSession() as db:
        user = db.scalar(select(User).where(
            User.email == "telegram-commands@example.com"))
        assert user is not None
        db.add(TelegramConnection(user_id=user.id, chat_id="86420"))
        db.commit()

    webhook_headers = {"X-Telegram-Bot-Api-Secret-Token": "command-secret"}

    def send_command(text: str) -> None:
        result = client.post("/api/telegram/webhook", headers=webhook_headers, json={
            "message": {"text": text, "chat": {"id": 86420, "type": "private"}}})
        assert result.status_code == 200

    send_command("/peso 82.35")
    send_command("/composicion 81.8 grasa=24.5 masa_libre=60 grasa_subcutanea=18 grasa_visceral=7 agua=52 musculo_esqueletico=39 masa_muscular=50 masa_osea=3 proteina=16 metabolismo_basal=1600 edad_metabolica=39")
    send_command("/composicion 81.7 desconocida=2")
    send_command("/sintoma 5 náuseas")
    send_command("/dosis 2.5")
    send_command("/cintura 90")
    send_command(
        "/medidas cintura=91 cuello=38 pecho=102 abdomen=95 cadera=100 brazo=31 muslo=55")
    send_command("/medidas cintura=92 desconocida=12")
    send_command("/presion 120/80")
    next_day = (datetime.now(ZoneInfo("America/Bogota")) +
                timedelta(days=1)).replace(second=0, microsecond=0)
    send_command(
        f"/recordatorio {next_day:%Y-%m-%d %H:%M} Cita de seguimiento")
    weights = client.get("/api/weights", headers=headers).json()
    assert weights[0]["weight_kg"] == 81.8 and weights[0]["source"] == "Telegram"
    assert weights[0]["body_fat_percent"] == 24.5
    assert weights[0]["fat_free_mass_kg"] == 60
    assert weights[0]["subcutaneous_fat_percent"] == 18
    assert weights[0]["visceral_fat_index"] == 7
    assert weights[0]["body_water_percent"] == 52
    assert weights[0]["skeletal_muscle_percent"] == 39
    assert weights[0]["muscle_mass_kg"] == 50
    assert weights[0]["bone_mass_kg"] == 3
    assert weights[0]["protein_percent"] == 16
    assert weights[0]["bmr_kcal"] == 1600
    assert weights[0]["metabolic_age"] == 39
    assert weights[1]["weight_kg"] == 82.35
    assert len(weights) == 2
    assert any(
        "Campo de composición desconocido" in message for message in sent_messages)
    doses = client.get("/api/doses", headers=headers).json()
    assert doses[0]["dose_mg"] == 2.5
    measurements = client.get("/api/body-measurements", headers=headers).json()
    assert measurements[0]["waist_cm"] == 91
    assert measurements[0]["neck_cm"] == 38
    assert measurements[0]["chest_cm"] == 102
    assert measurements[0]["abdomen_cm"] == 95
    assert measurements[0]["hip_cm"] == 100
    assert measurements[0]["arm_cm"] == 31
    assert measurements[0]["thigh_cm"] == 55
    assert measurements[1]["waist_cm"] == 90
    assert len(measurements) == 2
    assert any("Medida desconocida" in message for message in sent_messages)
    symptoms = client.get("/api/entries/symptoms", headers=headers).json()
    assert symptoms[0]["title"] == "náuseas" and symptoms[0]["data"]["severity"] == 5
    labs = client.get("/api/entries/labs", headers=headers).json()
    assert labs[0]["data"]["systolic_pressure"] == 120
    reminders = client.get("/api/entries/reminders", headers=headers).json()
    assert any(entry["title"] == "Cita de seguimiento" for entry in reminders)


def test_weight_records_can_be_edited_and_deleted_only_by_owner() -> None:
    owner = client.post("/api/auth/register", json={
                        "email": "weightcrud@example.com", "password": "weight-crud-password-123"})
    other = client.post("/api/auth/register", json={
                        "email": "weightother@example.com", "password": "weight-other-password-123"})
    owner_headers = {"Authorization": f"Bearer {owner.json()['access_token']}"}
    other_headers = {"Authorization": f"Bearer {other.json()['access_token']}"}
    record = client.post("/api/weights", headers=owner_headers,
                         json={"weight_kg": 90}).json()
    payload = {"weight_kg": 89,
               "measured_at": "2025-01-02T10:30:00-05:00", "body_fat_percent": 22}
    assert client.put(
        f"/api/weights/{record['id']}", headers=owner_headers, json=payload).json()["weight_kg"] == 89
    assert client.put(
        f"/api/weights/{record['id']}", headers=other_headers, json=payload).status_code == 404
    assert client.delete(
        f"/api/weights/{record['id']}", headers=other_headers).status_code == 404
    assert client.delete(
        f"/api/weights/{record['id']}", headers=owner_headers).status_code == 204


def test_body_measurement_and_dose_crud_and_medication_archival() -> None:
    owner = client.post("/api/auth/register", json={
                        "email": "registrycrud@example.com", "password": "registry-crud-password-123"})
    other = client.post("/api/auth/register", json={
                        "email": "registryother@example.com", "password": "registry-other-password-123"})
    headers = {"Authorization": f"Bearer {owner.json()['access_token']}"}
    other_headers = {"Authorization": f"Bearer {other.json()['access_token']}"}
    measurement = client.post("/api/body-measurements",
                              headers=headers, json={"waist_cm": 82}).json()
    changed = client.put(
        f"/api/body-measurements/{measurement['id']}", headers=headers, json={"waist_cm": 80, "hip_cm": 100})
    assert changed.status_code == 200 and changed.json()["waist_cm"] == 80
    assert client.delete(
        f"/api/body-measurements/{measurement['id']}", headers=other_headers).status_code == 404
    medication = client.post("/api/medications", headers=headers, json={
        "name": "Medicamento de prueba", "concentration_mg": 10,
        "concentration_volume_ml": 0.5, "units_per_ml": 100,
    }).json()
    dose = client.post("/api/doses", headers=headers,
                       json={"medication_id": medication["id"], "dose_mg": 5}).json()
    updated_dose = client.put(f"/api/doses/{dose['id']}", headers=headers, json={
                              "medication_id": medication["id"], "dose_mg": 2.5, "administered_at": "2025-02-01T12:00:00Z"})
    assert updated_dose.status_code == 200 and updated_dose.json()[
        "calculated_volume_ml"] == 0.125
    assert client.put(f"/api/doses/{dose['id']}", headers=other_headers, json={
                      "medication_id": medication["id"], "dose_mg": 2}).status_code == 404
    assert client.delete(
        f"/api/medications/{medication['id']}", headers=headers).status_code == 204
    assert client.get(
        "/api/doses", headers=headers).json()[0]["id"] == dose["id"]
    assert client.delete(
        f"/api/doses/{dose['id']}", headers=headers).status_code == 204


def test_photo_metadata_can_be_updated_by_owner(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(settings, "storage_path", str(tmp_path))
    registered = client.post("/api/auth/register", json={
                             "email": "photoupdate@example.com", "password": "photo-update-password-123"})
    headers = {"Authorization": f"Bearer {registered.json()['access_token']}"}
    png = b"\x89PNG\r\n\x1a\n" + b"image"
    created = client.post("/api/photos", headers=headers,
                          files={"file": ("test.png", png, "image/png")})
    photo_id = created.json()["id"]
    updated = client.put(f"/api/photos/{photo_id}", headers=headers, json={
                         "caption": "Updated", "taken_at": "2025-03-01T10:00:00Z"})
    assert updated.status_code == 200 and updated.json()[
        "caption"] == "Updated"


def test_journal_module_crud_is_scoped() -> None:
    owner = client.post(
        "/api/auth/register", json={"email": "journal@example.com", "password": "journal-password-123"})
    other = client.post("/api/auth/register", json={
                        "email": "journalother@example.com", "password": "journal-other-password-123"})
    owner_headers = {"Authorization": f"Bearer {owner.json()['access_token']}"}
    other_headers = {"Authorization": f"Bearer {other.json()['access_token']}"}
    payload = {"module": "symptoms", "title": "Nausea", "data": {
        "severity": 3}, "occurred_at": "2025-01-02T09:00:00Z"}
    record = client.post("/api/entries", headers=owner_headers, json=payload)
    assert record.status_code == 201
    assert len(client.get("/api/entries/symptoms",
               headers=owner_headers).json()) == 1
    assert client.get("/api/entries/symptoms",
                      headers=other_headers).json() == []
    changed = {**payload, "title": "Headache"}
    assert client.put(
        f"/api/entries/{record.json()['id']}", headers=owner_headers, json=changed).json()["title"] == "Headache"
    assert client.delete(
        f"/api/entries/{record.json()['id']}", headers=other_headers).status_code == 404
    assert client.delete(
        f"/api/entries/{record.json()['id']}", headers=owner_headers).status_code == 204


def test_refresh_cookie_rotates_and_logout_revokes_session() -> None:
    registered = client.post(
        "/api/auth/register", json={"email": "refresh@example.com", "password": "refresh-password-123"})
    assert registered.status_code == 200
    cookie_header = registered.headers["set-cookie"].lower()
    assert "httponly" in cookie_header and "secure" in cookie_header and "samesite=strict" in cookie_header
    old_refresh = client.cookies.get("forma_refresh")
    refreshed = client.post("/api/auth/refresh")
    assert refreshed.status_code == 200
    assert refreshed.json()["access_token"]
    new_refresh = client.cookies.get("forma_refresh")
    assert old_refresh != new_refresh
    replay = client.post("/api/auth/refresh",
                         cookies={"forma_refresh": old_refresh})
    assert replay.status_code == 401
    client.cookies.set("forma_refresh", new_refresh,
                       domain="testserver", path="/api/auth")
    assert client.post("/api/auth/logout").status_code == 204
    assert client.post("/api/auth/refresh").status_code == 401


def test_photo_files_are_private_and_owner_scoped(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(settings, "storage_path", str(tmp_path))
    owner = client.post(
        "/api/auth/register", json={"email": "photo@example.com", "password": "photo-password-123"})
    other = client.post("/api/auth/register", json={
                        "email": "photoother@example.com", "password": "photo-other-password-123"})
    owner_headers = {"Authorization": f"Bearer {owner.json()['access_token']}"}
    other_headers = {"Authorization": f"Bearer {other.json()['access_token']}"}
    png = b"\x89PNG\r\n\x1a\n" + b"valid-test-image"
    response = client.post("/api/photos", headers=owner_headers, data={
                           "caption": "Progress", "taken_at": "2025-01-02T10:00:00Z"}, files={"file": ("test.png", png, "image/png")})
    assert response.status_code == 201
    photo_id = response.json()["id"]
    assert client.get(
        f"/api/photos/{photo_id}/image", headers=owner_headers).content == png
    assert client.get(
        f"/api/photos/{photo_id}/image", headers=other_headers).status_code == 404
    photo_path = next((tmp_path / "photos").glob("*/*"))
    assert photo_path.stat().st_mode & 0o777 == 0o600
    assert photo_path.parent.stat().st_mode & 0o777 == 0o700
    assert client.delete(
        f"/api/photos/{photo_id}", headers=owner_headers).status_code == 204


def test_medications_review_toggle_tracks_active_medication_changes() -> None:
    registered = client.post("/api/auth/register", json={
        "email": "med-review@example.com", "password": "med-review-password-123"})
    headers = {"Authorization": f"Bearer {registered.json()['access_token']}"}
    client.put("/api/profile", headers=headers, json={
        "height_cm": 180, "initial_weight_kg": 90, "timezone": "UTC"})
    medication = client.post("/api/medications", headers=headers, json={
        "name": "Tirzepatida", "concentration_mg": 10,
        "concentration_volume_ml": 0.5, "units_per_ml": 100,
    }).json()

    initial = client.get("/api/profile", headers=headers)
    assert initial.json()["medications_reviewed"] is False

    confirmed = client.patch("/api/profile/medications-review",
                             headers=headers, json={"reviewed": True})
    assert confirmed.status_code == 200
    assert confirmed.json()["medications_reviewed"] is True

    still_confirmed = client.get("/api/profile", headers=headers)
    assert still_confirmed.json()["medications_reviewed"] is True

    client.put(f"/api/medications/{medication['id']}", headers=headers, json={
        "name": "Tirzepatida", "active": True, "concentration_mg": 12.5,
        "concentration_volume_ml": 0.5, "units_per_ml": 100,
    })
    invalidated = client.get("/api/profile", headers=headers)
    assert invalidated.json()["medications_reviewed"] is False

    unconfirmed = client.patch(
        "/api/profile/medications-review", headers=headers, json={"reviewed": False})
    assert unconfirmed.json()["medications_reviewed"] is False


def test_catalog_items_are_user_scoped_and_blood_pressure_is_protected() -> None:
    owner = client.post("/api/auth/register", json={
        "email": "catalog-owner@example.com", "password": "catalog-owner-password-123"})
    other = client.post("/api/auth/register", json={
        "email": "catalog-other@example.com", "password": "catalog-other-password-123"})
    owner_headers = {"Authorization": f"Bearer {owner.json()['access_token']}"}
    other_headers = {"Authorization": f"Bearer {other.json()['access_token']}"}

    labs = client.get("/api/catalog/lab", headers=owner_headers)
    assert labs.status_code == 200
    assert [item["name"] for item in labs.json()] == ["Presión arterial"]
    assert labs.json()[0]["is_blood_pressure"] is True

    created = client.post("/api/catalog", headers=owner_headers, json={
        "category": "lab", "name": "Glucosa", "unit": "mg/dL"})
    assert created.status_code == 201

    duplicate = client.post("/api/catalog", headers=owner_headers, json={
        "category": "lab", "name": "glucosa"})
    assert duplicate.status_code == 409

    other_labs = client.get("/api/catalog/lab", headers=other_headers)
    assert [item["name"] for item in other_labs.json()] == ["Presión arterial"]

    protected = client.delete(
        f"/api/catalog/{labs.json()[0]['id']}", headers=owner_headers)
    assert protected.status_code == 409

    removable = client.delete(
        f"/api/catalog/{created.json()['id']}", headers=owner_headers)
    assert removable.status_code == 204

    forbidden = client.get("/api/catalog/unknown", headers=owner_headers)
    assert forbidden.status_code == 422


def test_catalog_item_normal_thresholds_can_be_set_and_updated() -> None:
    owner = client.post("/api/auth/register", json={
        "email": "catalog-thresholds-owner@example.com", "password": "catalog-thresholds-owner-123"})
    other = client.post("/api/auth/register", json={
        "email": "catalog-thresholds-other@example.com", "password": "catalog-thresholds-other-123"})
    owner_headers = {"Authorization": f"Bearer {owner.json()['access_token']}"}
    other_headers = {"Authorization": f"Bearer {other.json()['access_token']}"}

    created = client.post("/api/catalog", headers=owner_headers, json={
        "category": "lab", "name": "Glucosa", "unit": "mg/dL",
        "normal_min": 70, "normal_max": 100,
    })
    assert created.status_code == 201
    assert created.json()["normal_min"] == 70 and created.json()[
        "normal_max"] == 100

    inverted = client.post("/api/catalog", headers=owner_headers, json={
        "category": "lab", "name": "Invertido", "normal_min": 10, "normal_max": 1})
    assert inverted.status_code == 422

    wrong_category = client.post("/api/catalog", headers=owner_headers, json={
        "category": "goal", "name": "Meta con umbral", "normal_min": 1})
    assert wrong_category.status_code == 422

    item_id = created.json()["id"]
    updated = client.patch(f"/api/catalog/{item_id}/thresholds", headers=owner_headers, json={
        "normal_min": None, "normal_max": 126})
    assert updated.status_code == 200
    assert updated.json()["normal_min"] is None and updated.json()[
        "normal_max"] == 126

    invalid_update = client.patch(f"/api/catalog/{item_id}/thresholds", headers=owner_headers, json={
        "normal_min": 200, "normal_max": 100})
    assert invalid_update.status_code == 422

    forbidden = client.patch(f"/api/catalog/{item_id}/thresholds", headers=other_headers, json={
        "normal_min": 1, "normal_max": 2})
    assert forbidden.status_code == 404

    diastolic_rejected = client.patch(f"/api/catalog/{item_id}/thresholds", headers=owner_headers, json={
        "diastolic_normal_min": 60, "diastolic_normal_max": 80})
    assert diastolic_rejected.status_code == 422

    blood_pressure = client.get(
        "/api/catalog/lab", headers=owner_headers).json()[0]
    assert blood_pressure["normal_min"] == 90 and blood_pressure["normal_max"] == 120
    assert blood_pressure["diastolic_normal_min"] == 60 and blood_pressure["diastolic_normal_max"] == 80

    bp_updated = client.patch(f"/api/catalog/{blood_pressure['id']}/thresholds", headers=owner_headers, json={
        "normal_min": 95, "normal_max": 125, "diastolic_normal_min": 65, "diastolic_normal_max": 85})
    assert bp_updated.status_code == 200
    assert bp_updated.json()["normal_min"] == 95 and bp_updated.json()[
        "normal_max"] == 125
    assert bp_updated.json()["diastolic_normal_min"] == 65 and bp_updated.json()[
        "diastolic_normal_max"] == 85


def test_catalog_items_can_be_reordered_and_order_is_user_scoped() -> None:
    owner = client.post("/api/auth/register", json={
        "email": "catalog-order-owner@example.com", "password": "catalog-order-owner-123"})
    other = client.post("/api/auth/register", json={
        "email": "catalog-order-other@example.com", "password": "catalog-order-other-123"})
    owner_headers = {"Authorization": f"Bearer {owner.json()['access_token']}"}
    other_headers = {"Authorization": f"Bearer {other.json()['access_token']}"}

    glucose = client.post("/api/catalog", headers=owner_headers, json={
        "category": "lab", "name": "Glucosa"}).json()
    cholesterol = client.post("/api/catalog", headers=owner_headers, json={
        "category": "lab", "name": "Colesterol"}).json()
    blood_pressure = client.get(
        "/api/catalog/lab", headers=owner_headers).json()[0]

    default_order = client.get(
        "/api/catalog/lab", headers=owner_headers).json()
    assert [item["name"] for item in default_order] == [
        "Presión arterial", "Glucosa", "Colesterol"]

    reordered = client.put("/api/catalog/lab/order", headers=owner_headers, json={
        "item_ids": [blood_pressure["id"], glucose["id"], cholesterol["id"]]})
    assert reordered.status_code == 200
    assert [item["name"] for item in reordered.json()] == [
        "Presión arterial", "Glucosa", "Colesterol"]

    incomplete = client.put("/api/catalog/lab/order", headers=owner_headers, json={
        "item_ids": [glucose["id"]]})
    assert incomplete.status_code == 422

    forbidden = client.put("/api/catalog/lab/order", headers=other_headers, json={
        "item_ids": [glucose["id"], cholesterol["id"], blood_pressure["id"]]})
    assert forbidden.status_code == 422
