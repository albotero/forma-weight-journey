from collections.abc import Generator

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
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
client = TestClient(app)


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
        owner_headers = {
            "Authorization": f"Bearer {owner.json()['access_token']}"}
        other_headers = {
            "Authorization": f"Bearer {other.json()['access_token']}"}
        medication = client.get(
            "/api/medications", headers=owner_headers).json()[0]
        changed = client.put(f"/api/medications/{medication['id']}", headers=owner_headers, json={
                             "name": "Tirzepatida", "active": True, "concentration_mg": 10, "concentration_volume_ml": 0.4, "units_per_ml": 100})
        assert changed.status_code == 200
        assert changed.json()["concentration_mg"] / \
            changed.json()["concentration_volume_ml"] == 25
        dose = client.post(f"/api/doses", headers=owner_headers,
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
