import asyncio
import json
import logging
from datetime import timedelta
from types import SimpleNamespace
from urllib.parse import parse_qs, urlparse

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import strava
from app.config import settings
from app.database import Base, get_db
from app.main import app
from app.models import JournalEntry, StravaConnection, StravaImport, User, UserProfile
from app.routers.common import utc_now
from app.security import create_access_token, hash_password


@pytest.fixture
def integration(monkeypatch):
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    @event.listens_for(engine, "connect")
    def foreign_keys(connection, _):
        connection.execute("PRAGMA foreign_keys=ON")
    Base.metadata.create_all(engine)
    sessions = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    monkeypatch.setattr(settings, "secret_key", "test-strava-key-not-a-production-secret-00000")
    monkeypatch.setattr(settings, "public_app_url", "https://forma.example.com")
    monkeypatch.setattr(strava, "SessionLocal", sessions)
    with sessions() as db:
        db.add_all([User(id=1, email="strava-one@example.com", password_hash=hash_password("test-password-123")),
                    User(id=2, email="strava-two@example.com", password_hash=hash_password("test-password-123"))])
        db.commit()
        db.add(UserProfile(user_id=1))
        db.commit()
    def database():
        with sessions() as db:
            yield db
    previous_overrides = dict(app.dependency_overrides)
    app.dependency_overrides[get_db] = database
    limiter_enabled = app.state.limiter.enabled
    app.state.limiter.enabled = False
    client = TestClient(app, base_url="https://testserver")
    client.headers["Authorization"] = f"Bearer {create_access_token('1')}"
    calls = []
    now = int(utc_now().timestamp())
    state = SimpleNamespace(activities=[{"id": 101}], token_error=None, activity_error=None,
                            streams_error=None, subscriptions=[], athlete=42, detail={
        "id": 101, "athlete": {"id": 42}, "sport_type": "Ride",
        "start_date": "2026-11-13T12:00:00Z", "elapsed_time": 3600, "moving_time": 3000,
        "distance": 20000, "total_elevation_gain": 123.456, "calories": 456.789,
    })
    def provider(request):
        calls.append(request)
        path = request.url.path
        if path == "/oauth/token":
            if state.token_error:
                return httpx.Response(state.token_error, json={"message": "provider-secret-must-not-leak"})
            return httpx.Response(200, json={"access_token": "test-provider-access", "refresh_token": "test-provider-refresh",
                                            "expires_at": now + 3600, "athlete": {"id": state.athlete}})
        if path == "/api/v3/push_subscriptions":
            if request.method == "GET":
                return httpx.Response(200, json=state.subscriptions)
            return httpx.Response(201, json={"id": 7})
        if path.startswith("/api/v3/push_subscriptions/") or path == "/oauth/deauthorize":
            return httpx.Response(204)
        if path == "/api/v3/athlete/activities":
            page = int(request.url.params.get("page", "1"))
            return httpx.Response(200, json=state.activities[(page - 1) * 30:page * 30])
        if path.endswith("/streams"):
            if state.streams_error:
                return httpx.Response(state.streams_error)
            return httpx.Response(200, json={"latlng": {"data": [[0, 0], [0, 0.001], [0, 0.002]]},
                                            "altitude": {"data": [100, 125, 100]}, "time": {"data": [0, 20, 40]}})
        if path == "/api/v3/activities/101":
            if state.activity_error:
                return httpx.Response(state.activity_error)
            return httpx.Response(200, json=state.detail)
        raise AssertionError(f"Unexpected mocked Strava request: {request.method} {path}")
    original_client = httpx.AsyncClient
    monkeypatch.setattr(httpx, "AsyncClient", lambda **kwargs: original_client(transport=httpx.MockTransport(provider), **kwargs))
    yield SimpleNamespace(client=client, sessions=sessions, calls=calls, provider=state)
    client.close()
    app.dependency_overrides.clear()
    app.dependency_overrides.update(previous_overrides)
    app.state.limiter.enabled = limiter_enabled
    engine.dispose()


def credentials(integration, client_id="123"):
    return integration.client.put("/api/strava/credentials", json={
        "client_id": client_id, "client_secret": "test-client-secret", "current_password": "test-password-123",
    })


def connect(integration, history=False):
    assert credentials(integration).status_code == 200
    response = integration.client.post("/api/strava/authorize", json={"import_last_30_days": history})
    assert response.status_code == 200
    params = parse_qs(urlparse(response.json()["authorization_url"]).query)
    result = integration.client.get("/api/strava/callback", params={
        "state": params["state"][0], "code": "test-provider-code", "scope": "read,activity:read_all",
    }, follow_redirects=False)
    assert result.status_code == 303
    assert result.headers["location"].endswith("strava=connected")
    return params


def webhook_event(integration, **overrides):
    with integration.sessions() as db:
        connection = db.get(StravaConnection, 1)
        key = connection.webhook_key
    event = {"object_type": "activity", "aspect_type": "create", "object_id": 101, "owner_id": 42,
             "subscription_id": 7, "event_time": int(utc_now().timestamp()), "updates": {}}
    return integration.client.post(f"/api/strava/webhook/{key}", json={**event, **overrides})


def test_credentials_require_password_are_encrypted_and_never_returned(integration):
    rejected = integration.client.put("/api/strava/credentials", json={
        "client_id": "123", "client_secret": "test-client-secret", "current_password": "wrong",
    })
    assert rejected.status_code == 400
    assert credentials(integration).status_code == 200
    with integration.sessions() as db:
        connection = db.get(StravaConnection, 1)
        assert connection.client_secret != "test-client-secret"
        assert strava.decrypt(connection.client_secret) == "test-client-secret"
    status = integration.client.get("/api/strava/connection")
    assert status.json()["client_id"] == "123"
    assert "secret" not in json.dumps(status.json()).lower()
    other = integration.client.get("/api/strava/connection", headers={"Authorization": f"Bearer {create_access_token('2')}"})
    assert other.json()["configured"] is False
    assert integration.client.put("/api/strava/credentials", headers={"Authorization": f"Bearer {create_access_token('2')}"},
        json={"client_id": "123", "client_secret": "test-client-secret", "current_password": "test-password-123"}).status_code == 409
    invalid = integration.client.put("/api/strava/credentials", json={
        "client_id": "123", "client_secret": "tiny", "current_password": "test-password-123",
    })
    assert invalid.status_code == 422
    assert "tiny" not in invalid.text
    assert "test-password-123" not in invalid.text


@pytest.mark.parametrize("history", [False, True])
def test_oauth_is_browser_bound_single_use_and_retains_history_choice(integration, history):
    params = connect(integration, history)
    assert params["scope"] == ["read,activity:read_all"]
    assert params["redirect_uri"] == ["https://forma.example.com/api/strava/callback"]
    assert "client_secret" not in params
    with integration.sessions() as db:
        connection = db.get(StravaConnection, 1)
        assert connection.state_hash is None
        assert connection.athlete_id == 42
        assert connection.subscription_id == 7
        expected = int((utc_now() - timedelta(days=30) if history else utc_now()).timestamp())
        assert abs(connection.scan_after - expected) < 3
        assert "test-provider-access" not in connection.tokens
    replay = integration.client.get("/api/strava/callback", params={
        "state": params["state"][0], "code": "test-provider-code", "scope": "activity:read_all",
    })
    assert replay.status_code == 400


@pytest.mark.parametrize("failure", ["cookie", "state", "expired", "denied", "scope", "auth_version"])
def test_oauth_rejects_csrf_expiry_denial_missing_scope_and_revoked_session(integration, failure):
    assert credentials(integration).status_code == 200
    started = integration.client.post("/api/strava/authorize", json={})
    state = parse_qs(urlparse(started.json()["authorization_url"]).query)["state"][0]
    with integration.sessions() as db:
        connection = db.get(StravaConnection, 1)
        if failure == "expired":
            connection.state_expires_at = utc_now() - timedelta(seconds=1)
        if failure == "auth_version":
            db.get(User, 1).auth_version += 1
        db.commit()
    if failure == "cookie":
        integration.client.cookies.clear()
    response = integration.client.get("/api/strava/callback", params={
        "state": "forged" if failure == "state" else state,
        "code": "test-provider-code", "scope": "read" if failure == "scope" else "activity:read_all",
        **({"error": "access_denied"} if failure == "denied" else {}),
    }, follow_redirects=False)
    assert response.status_code == (303 if failure in ("denied", "scope") else 400)
    assert not any(request.url.path == "/oauth/token" for request in integration.calls)


def test_webhook_challenge_and_events_are_account_scoped_and_fast(integration):
    connect(integration)
    with integration.sessions() as db:
        connection = db.get(StravaConnection, 1)
        url = f"/api/strava/webhook/{connection.webhook_key}"
        token = connection.verify_token
    assert integration.client.get(url, params={"hub.mode": "subscribe", "hub.challenge": "example",
                                              "hub.verify_token": token}).json() == {"hub.challenge": "example"}
    assert integration.client.get(url, params={"hub.mode": "subscribe", "hub.challenge": "example",
                                              "hub.verify_token": "wrong"}).status_code == 403
    before = len(integration.calls)
    assert webhook_event(integration, owner_id=99).status_code == 403
    assert webhook_event(integration, subscription_id=8).status_code == 403
    assert webhook_event(integration).status_code == 200
    assert webhook_event(integration).status_code == 200
    assert len(integration.calls) == before
    with integration.sessions() as db:
        jobs = list(db.scalars(select(StravaImport)))
        assert len(jobs) == 1
        assert jobs[0].pending
        assert jobs[0].generation == 1


def test_parallel_webhook_during_import_is_not_dropped(integration, monkeypatch):
    connect(integration)
    original = strava.strava_request
    updated = False
    async def request(client, method, url, **kwargs):
        nonlocal updated
        response = await original(client, method, url, **kwargs)
        if url.endswith("/streams") and not updated:
            updated = True
            assert webhook_event(integration, aspect_type="update").status_code == 200
        return response
    monkeypatch.setattr(strava, "strava_request", request)
    asyncio.run(strava.dispatch_strava_sync())
    with integration.sessions() as db:
        assert db.scalar(select(StravaImport)).pending
    asyncio.run(strava.dispatch_strava_sync())
    with integration.sessions() as db:
        assert not db.scalar(select(StravaImport)).pending


def test_local_delete_during_provider_fetch_is_not_resurrected(integration, monkeypatch):
    connect(integration)
    asyncio.run(strava.dispatch_strava_sync())
    assert webhook_event(integration, aspect_type="update").status_code == 200
    original = strava.strava_request
    async def request(client, method, url, **kwargs):
        response = await original(client, method, url, **kwargs)
        if url.endswith("/streams"):
            with integration.sessions() as db:
                entry_id = db.scalar(select(StravaImport)).entry_id
            assert integration.client.delete(f"/api/entries/{entry_id}").status_code == 204
        return response
    monkeypatch.setattr(strava, "strava_request", request)
    asyncio.run(strava.dispatch_strava_sync())
    with integration.sessions() as db:
        assert db.scalar(select(JournalEntry)) is None
        assert db.scalar(select(StravaImport)).suppressed


@pytest.mark.parametrize("provider_calories", [0, None])
def test_worker_treats_unavailable_strava_calories_as_missing(integration, provider_calories):
    integration.provider.detail["calories"] = provider_calories
    connect(integration)
    asyncio.run(strava.dispatch_strava_sync())
    with integration.sessions() as db:
        entry = db.scalar(select(JournalEntry))
        assert entry.data["calories_kcal"] is None
        assert entry.data["elevation_gain_m"] == 123.46
        assert entry.data["moving_duration_min"] == 50
        assert entry.data["distance_km"] == 20


def test_worker_imports_once_preserves_ascent_and_remote_calories_and_updates(integration):
    connect(integration, True)
    asyncio.run(strava.dispatch_strava_sync())
    with integration.sessions() as db:
        entry = db.scalar(select(JournalEntry))
        assert entry.data["distance_km"] == 20
        assert entry.data["duration_min"] == 60
        assert entry.data["moving_duration_min"] == 50
        assert entry.data["elevation_gain_m"] == 123.46
        assert entry.data["calories_kcal"] == 456.79
        assert len(entry.data["route"]) == 3
        entry_id = entry.id
    assert webhook_event(integration, aspect_type="update").status_code == 200
    integration.provider.detail["distance"] = 22000
    asyncio.run(strava.dispatch_strava_sync())
    with integration.sessions() as db:
        entries = list(db.scalars(select(JournalEntry)))
        assert len(entries) == 1
        assert entries[0].id == entry_id
        assert entries[0].data["distance_km"] == 22
        assert db.get(StravaConnection, 1).last_error is None
    status = integration.client.get("/api/strava/connection").json()
    assert status["imported_count"] == 1
    assert status["pending_count"] == 0


def test_history_pagination_preserves_window_and_advances_watermark(integration, monkeypatch):
    connect(integration, True)
    integration.provider.activities = [{"id": number} for number in range(101, 136)]
    async def skip_import(db, connection, item, client, token):
        item.pending = False
        db.commit()
    monkeypatch.setattr(strava, "import_activity", skip_import)
    asyncio.run(strava.dispatch_strava_sync())
    with integration.sessions() as db:
        connection = db.get(StravaConnection, 1)
        assert connection.scan_page == 2
        assert connection.scan_before > 0
        first_before = connection.scan_before
        connection.next_sync_at = utc_now()
        db.commit()
    asyncio.run(strava.dispatch_strava_sync())
    with integration.sessions() as db:
        connection = db.get(StravaConnection, 1)
        assert len(list(db.scalars(select(StravaImport)))) == 35
        assert connection.scan_page == 1
        assert connection.scan_before == first_before
        assert connection.scan_after == first_before - 60
    queries = [request.url.params for request in integration.calls if request.url.path.endswith("/athlete/activities")]
    assert queries[0]["before"] == queries[1]["before"]
    assert queries[0]["after"] == queries[1]["after"]
    assert queries[1]["page"] == "2"


def test_invalid_activity_does_not_block_others_and_has_explicit_retry(integration):
    connect(integration)
    integration.provider.detail["elapsed_time"] = 90000
    asyncio.run(strava.dispatch_strava_sync())
    status = integration.client.get("/api/strava/connection").json()
    assert status["failed_count"] == 1
    assert "24 horas" in status["import_error"]
    assert status["pending_count"] == 0
    integration.provider.detail["elapsed_time"] = 3600
    assert integration.client.post("/api/strava/sync").status_code == 200
    asyncio.run(strava.dispatch_strava_sync())
    status = integration.client.get("/api/strava/connection").json()
    assert status["failed_count"] == 0
    assert status["imported_count"] == 1


def test_foreign_activity_owner_cannot_be_imported(integration):
    connect(integration)
    integration.provider.detail["athlete"] = {"id": 99}
    asyncio.run(strava.dispatch_strava_sync())
    with integration.sessions() as db:
        assert db.scalar(select(JournalEntry)) is None
        assert "atleta" in db.get(StravaConnection, 1).last_error


def test_account_export_excludes_strava_credentials_and_tokens(integration):
    connect(integration)
    response = integration.client.get("/api/account/export/json")
    assert response.status_code == 200
    for secret in ("test-client-secret", "test-provider-access", "test-provider-refresh", "client_secret", "strava_connections"):
        assert secret not in response.text


def test_restore_disables_tokens_and_reattaches_records_without_duplicates(integration):
    connect(integration)
    asyncio.run(strava.dispatch_strava_sync())
    exported = integration.client.get("/api/account/export")
    assert exported.status_code == 200
    restored = integration.client.post("/api/account/import", files={"file": ("backup.zip", exported.content, "application/zip")})
    assert restored.status_code == 200
    with integration.sessions() as db:
        connection = db.get(StravaConnection, 1)
        assert connection.tokens is None
        assert connection.athlete_id is None
        assert connection.subscription_id == 7
        assert db.scalar(select(StravaImport)).entry_id == db.scalar(select(JournalEntry)).id
    integration.client.headers["Authorization"] = f"Bearer {create_access_token('1', auth_version=1)}"
    response = integration.client.post("/api/strava/authorize", json={"import_last_30_days": True})
    assert response.status_code == 200


def test_provider_and_callback_logs_redact_query_secrets():
    filter = strava.StravaLogFilter()
    record = logging.LogRecord("httpx", logging.INFO, "", 1, "%s %s",
        ("GET", "https://www.strava.com/api/v3/push_subscriptions?client_secret=test-secret"), None)
    assert filter.filter(record)
    assert "test-secret" not in record.getMessage()
    access = logging.LogRecord("uvicorn.access", logging.INFO, "", 1, "%s %s",
        ("GET", "/api/strava/callback?code=test-code&state=test-state"), None)
    filter.filter(access)
    assert access.getMessage() == "GET /api/strava/callback"


@pytest.mark.parametrize("streams", [{"latlng": None}, {"altitude": []}, {"time": "invalid"}])
def test_malformed_stream_shapes_are_permanent_activity_errors(streams):
    with pytest.raises(strava.StravaError) as error:
        strava.activity_route(streams)
    assert error.value.permanent


def test_refresh_rotates_encrypted_tokens_and_rate_limits_remain_durable(integration):
    connect(integration)
    with integration.sessions() as db:
        db.get(StravaConnection, 1).expires_at = utc_now() - timedelta(minutes=1)
        db.commit()
    integration.provider.activity_error = 429
    asyncio.run(strava.dispatch_strava_sync())
    with integration.sessions() as db:
        connection = db.get(StravaConnection, 1)
        assert "límite" in connection.last_error
        assert db.scalar(select(StravaImport)).pending
        assert connection.tokens and strava.decrypt(connection.tokens)
    refresh_requests = [request for request in integration.calls if request.url.path == "/oauth/token"]
    assert b"grant_type=refresh_token" in refresh_requests[-1].content
    before = len(integration.calls)
    asyncio.run(strava.dispatch_strava_sync())
    assert len(integration.calls) == before
    assert integration.client.post("/api/strava/sync").status_code == 429


def test_local_delete_suppresses_reimport_and_remote_delete_removes_copy(integration):
    connect(integration)
    asyncio.run(strava.dispatch_strava_sync())
    with integration.sessions() as db:
        entry = db.scalar(select(JournalEntry))
        entry_id = entry.id
        payload = {"module": "activity", "title": entry.title, "data": entry.data}
    assert integration.client.put(f"/api/entries/{entry_id}", json=payload).status_code == 409
    assert integration.client.delete(f"/api/entries/{entry_id}").status_code == 204
    assert webhook_event(integration).status_code == 200
    asyncio.run(strava.dispatch_strava_sync())
    with integration.sessions() as db:
        assert db.scalar(select(JournalEntry)) is None
        assert db.scalar(select(StravaImport)).suppressed
        item = db.scalar(select(StravaImport))
        item.suppressed = False
        item.pending = True
        db.commit()
    asyncio.run(strava.dispatch_strava_sync())
    integration.provider.activity_error = 404
    assert webhook_event(integration, aspect_type="delete").status_code == 200
    asyncio.run(strava.dispatch_strava_sync())
    with integration.sessions() as db:
        assert db.scalar(select(JournalEntry)) is None


def test_deauthorization_removes_imports_but_never_manual_entries(integration):
    connect(integration)
    asyncio.run(strava.dispatch_strava_sync())
    with integration.sessions() as db:
        db.add(JournalEntry(user_id=1, module="activity", title="Manual", occurred_at=utc_now(), data={}))
        db.commit()
    assert webhook_event(integration, object_type="athlete", object_id=42, aspect_type="update",
                         updates={"authorized": "false"}).status_code == 200
    integration.provider.token_error = 400
    asyncio.run(strava.dispatch_strava_sync())
    with integration.sessions() as db:
        connection = db.get(StravaConnection, 1)
        assert connection.tokens is None
        assert [entry.title for entry in db.scalars(select(JournalEntry))] == ["Manual"]
        assert db.scalar(select(StravaImport)) is None


def test_disconnect_revokes_provider_and_deletes_secrets_and_imports(integration):
    connect(integration)
    asyncio.run(strava.dispatch_strava_sync())
    assert integration.client.delete("/api/strava/connection").status_code == 204
    assert any(request.url.path == "/oauth/deauthorize" for request in integration.calls)
    assert any(request.method == "DELETE" and "push_subscriptions" in request.url.path for request in integration.calls)
    with integration.sessions() as db:
        assert db.get(StravaConnection, 1) is None
        assert db.scalar(select(StravaImport)) is None
        assert db.scalar(select(JournalEntry)) is None


def test_foreign_webhook_is_not_replaced_and_polling_still_imports(integration):
    integration.provider.subscriptions = [{"id": 99, "callback_url": "https://other.example.com/callback"}]
    connect(integration)
    status = integration.client.get("/api/strava/connection").json()
    assert status["linked"] and not status["webhook_active"]
    assert "otro servicio" in status["webhook_error"]
    asyncio.run(strava.dispatch_strava_sync())
    assert integration.client.get("/api/strava/connection").json()["imported_count"] == 1


@pytest.mark.parametrize("sport,expected", [("Walk", "Caminata"), ("Hike", "Caminata"), ("Run", "Correr"),
                                           ("TrailRun", "Correr"), ("Ride", "Bicicleta"), ("GravelRide", "Bicicleta"),
                                           ("EBikeRide", None), ("VirtualRide", None), ("Swim", None)])
def test_supported_activity_types(sport, expected):
    detail = {"sport_type": sport, "start_date": "2026-11-13T12:00:00Z", "elapsed_time": 3600,
              "moving_time": 3000, "distance": 20000, "total_elevation_gain": 100}
    payload = strava.activity_payload(detail, {}, 101)
    assert (payload.data["activity_type"] if payload else None) == expected


def test_routes_limit_precision_and_never_link_gaps_as_measured():
    streams = {"latlng": {"data": [[0, index * 0.000001123456] for index in range(11000)]},
               "altitude": {"data": [100.12345] * 11000}, "time": {"data": [index * 40 for index in range(11000)]}}
    route = strava.activity_route(streams)
    assert len(route) <= 5000
    assert route[0]["longitude"] == 0
    assert route[-1]["longitude"] == round(10999 * 0.000001123456, 8)
    assert route[0]["altitude_m"] == 100.12
    assert route[-1]["segment"] <= 5000


def test_cipher_cannot_be_read_after_server_key_change(monkeypatch):
    encrypted = strava.encrypt("test-value")
    monkeypatch.setattr(settings, "secret_key", "different-server-test-key-not-production")
    with pytest.raises(strava.StravaError, match="descifrar"):
        strava.decrypt(encrypted)
