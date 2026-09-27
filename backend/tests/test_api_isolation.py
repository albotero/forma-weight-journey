from collections.abc import Generator

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.config import settings
from app.main import app

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
client = TestClient(app, base_url="https://testserver")
app.state.limiter.enabled = False


def test_weight_records_are_isolated_per_account() -> None:
    first = client.post(
        "/api/auth/register", json={"email": "first@example.com", "password": "a-safe-password-123"})
    second = client.post("/api/auth/register", json={
                         "email": "second@example.com", "password": "another-safe-password-456"})
    assert first.status_code == 201
    assert second.status_code == 201
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


def test_registration_seeds_default_medication_and_dose_is_calculated() -> None:
    created = client.post("/api/auth/register", json={
                          "email": "dose-owner@example.com", "password": "dose-owner-password-123"})
    token = created.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    medications = client.get("/api/medications", headers=headers).json()
    assert len(medications) == 1
    assert medications[0]["concentration_mg"] == 10
    assert medications[0]["concentration_volume_ml"] == 0.5

    recorded = client.post("/api/doses", headers=headers,
                           json={"medication_id": medications[0]["id"], "dose_mg": 5})
    assert recorded.status_code == 201
    assert recorded.json()["calculated_volume_ml"] == 0.25
    assert recorded.json()["calculated_u100_units"] == 25


def test_medication_concentration_can_be_changed_and_is_user_scoped() -> None:
    owner = client.post("/api/auth/register", json={
                        "email": "concentration-owner@example.com", "password": "concentration-owner-123"})
    other = client.post("/api/auth/register", json={
                        "email": "concentration-other@example.com", "password": "concentration-other-123"})
    owner_headers = {"Authorization": f"Bearer {owner.json()['access_token']}"}
    other_headers = {"Authorization": f"Bearer {other.json()['access_token']}"}
    medication = client.get(
        "/api/medications", headers=owner_headers).json()[0]
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


def test_protected_endpoints_require_authentication() -> None:
    assert client.get("/api/weights").status_code == 401


def test_profile_rejects_unknown_timezone() -> None:
    created = client.post("/api/auth/register", json={
                          "email": "timezone-owner@example.com", "password": "timezone-owner-password-123"})
    headers = {"Authorization": f"Bearer {created.json()['access_token']}"}
    response = client.put("/api/profile", headers=headers, json={
                          "height_cm": 180, "initial_weight_kg": 106, "timezone": "Not/A_Timezone"})
    assert response.status_code == 422


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
    meds = client.get("/api/medications", headers=headers).json()
    medication = meds[0]
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
    assert registered.status_code == 201
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
