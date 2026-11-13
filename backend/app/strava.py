import base64
import hashlib
import json
import logging
import math
from datetime import datetime, timedelta, timezone
from urllib.parse import urlparse

import httpx
from cryptography.fernet import Fernet, InvalidToken
from pydantic import ValidationError
from sqlalchemy import delete, exists, or_, select, update
from sqlalchemy.orm import Session

from app.config import settings
from app.database import SessionLocal
from app.models import JournalEntry, StravaConnection, StravaImport
from app.routers.common import utc_datetime, utc_now
from app.schemas import JournalEntryCreate

logger = logging.getLogger(__name__)
API_ROOT = "https://www.strava.com/api/v3"
ACTIVITY_TYPES = {"Walk": "Caminata", "Hike": "Caminata", "Run": "Correr",
                  "TrailRun": "Correr", "Ride": "Bicicleta",
                  "MountainBikeRide": "Bicicleta", "GravelRide": "Bicicleta"}


class StravaLogFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        if isinstance(record.args, tuple):
            args = list(record.args)
            for index, value in enumerate(args):
                text = str(value)
                if text.startswith("/api/strava/") or text.startswith("https://www.strava.com/"):
                    text = text.split("?", 1)[0]
                    if text.startswith("/api/strava/webhook/"):
                        text = "/api/strava/webhook/[redacted]"
                    args[index] = text
            record.args = tuple(args)
        return True


def install_log_filters() -> None:
    for name in ("uvicorn.access", "httpx"):
        target = logging.getLogger(name)
        if not any(isinstance(item, StravaLogFilter) for item in target.filters):
            target.addFilter(StravaLogFilter())


class StravaError(Exception):
    def __init__(self, message: str, *, retry_seconds: int = 900, unauthorized: bool = False, permanent: bool = False):
        super().__init__(message)
        self.retry_seconds = retry_seconds
        self.unauthorized = unauthorized
        self.permanent = permanent


def public_url() -> str:
    url = settings.public_app_url.rstrip("/")
    parsed = urlparse(url)
    if parsed.scheme != "https" or not parsed.hostname or parsed.query or parsed.fragment or parsed.username:
        raise StravaError("Configura PUBLIC_APP_URL con la URL HTTPS pública de Forma.")
    if settings.secret_key.startswith("development-only"):
        raise StravaError("Configura una SECRET_KEY segura antes de conectar Strava.")
    return url


def cipher() -> Fernet:
    key = hashlib.sha256(b"forma:strava:v1:" + settings.secret_key.encode()).digest()
    return Fernet(base64.urlsafe_b64encode(key))


def encrypt(value: str) -> str:
    return cipher().encrypt(value.encode()).decode()


def decrypt(value: str) -> str:
    try:
        return cipher().decrypt(value.encode()).decode()
    except (InvalidToken, UnicodeDecodeError):
        raise StravaError("No se pudieron descifrar las credenciales de Strava. Reconfigura la conexión.") from None


async def strava_request(client: httpx.AsyncClient, method: str, url: str, **kwargs):
    try:
        response = await client.request(method, url, **kwargs)
    except httpx.RequestError:
        raise StravaError("No se pudo contactar con Strava. Se reintentará automáticamente.") from None
    if response.status_code == 429:
        raise StravaError("Strava alcanzó su límite de solicitudes; se reintentará más tarde.", retry_seconds=3600)
    if response.status_code in (401, 403):
        raise StravaError("Strava rechazó el acceso. Vuelve a conectar y concede acceso a las actividades.", unauthorized=True)
    if response.status_code == 400 and url == "https://www.strava.com/oauth/token":
        raise StravaError("Strava no pudo renovar o autorizar la conexión. Comprueba las credenciales y vuelve a conectar.", unauthorized=True)
    if response.status_code == 404:
        return None
    if response.status_code >= 400:
        raise StravaError(f"Strava rechazó la solicitud (HTTP {response.status_code}).")
    if response.status_code == 204:
        return {}
    try:
        return response.json()
    except ValueError:
        raise StravaError("Strava devolvió una respuesta no válida.") from None


def token_values(payload) -> tuple[str, datetime]:
    if not isinstance(payload, dict) or not all(isinstance(payload.get(key), str) and payload[key]
                                                for key in ("access_token", "refresh_token")):
        raise StravaError("Strava no devolvió los tokens de conexión esperados.")
    expiry = payload.get("expires_at")
    if not isinstance(expiry, int) or isinstance(expiry, bool) or not 0 < expiry < 32503680000:
        raise StravaError("Strava devolvió una caducidad de token no válida.")
    return encrypt(json.dumps({key: payload[key] for key in ("access_token", "refresh_token")})), datetime.fromtimestamp(expiry, timezone.utc)


async def access_token(db: Session, connection: StravaConnection, client: httpx.AsyncClient) -> str:
    if not connection.tokens:
        raise StravaError("Conecta de nuevo tu cuenta de Strava.", unauthorized=True)
    tokens = json.loads(decrypt(connection.tokens))
    if connection.expires_at is None or utc_datetime(connection.expires_at) <= utc_now() + timedelta(minutes=2):
        payload = await strava_request(client, "POST", "https://www.strava.com/oauth/token", data={
            "client_id": connection.client_id, "client_secret": decrypt(connection.client_secret),
            "grant_type": "refresh_token", "refresh_token": tokens["refresh_token"],
        })
        connection.tokens, connection.expires_at = token_values(payload)
        db.commit()
        tokens = json.loads(decrypt(connection.tokens))
    return tokens["access_token"]


def remove_imports(db: Session, user_id: int) -> None:
    ids = select(StravaImport.entry_id).where(StravaImport.user_id == user_id, StravaImport.entry_id.is_not(None))
    db.execute(delete(JournalEntry).where(JournalEntry.user_id == user_id, JournalEntry.id.in_(ids)))
    db.execute(delete(StravaImport).where(StravaImport.user_id == user_id))


async def configure_subscription(db: Session, connection: StravaConnection, client: httpx.AsyncClient) -> None:
    params = {"client_id": connection.client_id, "client_secret": decrypt(connection.client_secret)}
    subscriptions = await strava_request(client, "GET", f"{API_ROOT}/push_subscriptions", params=params)
    if not isinstance(subscriptions, list):
        raise StravaError("Strava no devolvió el estado del webhook.")
    callback = f"{public_url()}/api/strava/webhook/{connection.webhook_key}"
    if subscriptions:
        matching = next((item for item in subscriptions if item.get("callback_url") == callback), None)
        if not matching:
            raise StravaError("Esta app Strava ya tiene un webhook de otro servicio; no se reemplazó. Usa una app dedicada a Forma.")
        subscription = matching
    else:
        subscription = await strava_request(client, "POST", f"{API_ROOT}/push_subscriptions",
                                            data={**params, "callback_url": callback, "verify_token": connection.verify_token})
    if not isinstance(subscription, dict) or not isinstance(subscription.get("id"), int):
        raise StravaError("No se pudo confirmar la suscripción de Strava.")
    connection.subscription_id = subscription["id"]
    connection.webhook_error = None
    db.commit()


def number(value, label: str, *, required: bool = True) -> float | None:
    if value is None and not required:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0:
        raise StravaError(f"Strava devolvió {label} no válido.", permanent=True)
    return float(value)


def activity_route(streams) -> list[dict]:
    if not isinstance(streams, dict):
        raise StravaError("Strava no devolvió los datos de recorrido esperados.", permanent=True)
    if any(not isinstance(streams.get(key, {}), dict) for key in ("latlng", "altitude", "time")):
        raise StravaError("Strava devolvió un recorrido no válido.", permanent=True)
    latlng = streams.get("latlng", {}).get("data", [])
    altitude = streams.get("altitude", {}).get("data", [])
    times = streams.get("time", {}).get("data", [])
    if not isinstance(latlng, list) or not isinstance(altitude, list) or not isinstance(times, list):
        raise StravaError("Strava devolvió un recorrido no válido.", permanent=True)
    route = []
    segment = 0
    for index, coordinates in enumerate(latlng):
        if not isinstance(coordinates, list) or len(coordinates) != 2 or any(
            isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value)
            for value in coordinates
        ) or not -90 <= coordinates[0] <= 90 or not -180 <= coordinates[1] <= 180:
            raise StravaError("Strava devolvió coordenadas no válidas.", permanent=True)
        elevation = altitude[index] if index < len(altitude) else None
        if isinstance(elevation, bool) or not isinstance(elevation, (int, float)) or not math.isfinite(elevation) or not -500 <= elevation <= 10000:
            elevation = None
        gap = index > 0 and index < len(times) and all(
            isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)
            for value in (times[index], times[index - 1])
        ) and times[index] - times[index - 1] > 30
        if gap:
            segment += 1
        route.append({"latitude": round(coordinates[0], 8), "longitude": round(coordinates[1], 8),
                      "altitude_m": round(elevation, 2) if elevation is not None else None, "segment": segment})
    # Strava totals remain authoritative; route reduction never changes those totals.
    while len(route) > 5000:
        route = [point for index, point in enumerate(route) if index % 2 == 0 or index == len(route) - 1]
    segments = {}
    for point in route:
        point["segment"] = segments.setdefault(point["segment"], len(segments))
    return route


def activity_payload(detail: dict, streams: dict, activity_id: int) -> JournalEntryCreate | None:
    activity_type = ACTIVITY_TYPES.get(detail.get("sport_type") or detail.get("type"))
    if not activity_type:
        return None
    try:
        occurred_at = datetime.fromisoformat(detail["start_date"].replace("Z", "+00:00"))
    except (KeyError, AttributeError, ValueError, TypeError):
        raise StravaError("Strava devolvió una fecha de actividad no válida.", permanent=True) from None
    if occurred_at.tzinfo is None:
        raise StravaError("La fecha de Strava no tiene zona horaria.", permanent=True)
    duration = number(detail.get("elapsed_time"), "duración")
    moving = number(detail.get("moving_time"), "tiempo en movimiento")
    distance = number(detail.get("distance"), "distancia")
    elevation = number(detail.get("total_elevation_gain"), "ascenso", required=False)
    calories = number(detail.get("calories"), "calorías", required=False)
    if not 0 < duration <= 86400 or moving > duration or distance > 1000000 or (calories is not None and calories > 100000):
        raise StravaError("La actividad Strava supera los límites admitidos por Forma (24 horas o 1000 km).", permanent=True)
    return JournalEntryCreate(
        module="activity", title=activity_type, occurred_at=occurred_at,
        data={"entry_type": "single", "activity_type": activity_type, "tracking_source": "gps",
              "duration_min": round(duration / 60, 2), "moving_duration_min": round(moving / 60, 2),
              "distance_km": round(distance / 1000, 2), "calories_kcal": round(calories, 2) if calories is not None else None,
              "elevation_gain_m": round(elevation, 2) if elevation is not None else None, "route": activity_route(streams),
              "strava_activity_id": activity_id, "source": "strava"},
    )


async def import_activity(db: Session, connection: StravaConnection, item: StravaImport,
                          client: httpx.AsyncClient, token: str) -> None:
    generation = item.generation
    headers = {"Authorization": f"Bearer {token}"}
    detail = await strava_request(client, "GET", f"{API_ROOT}/activities/{item.activity_id}", headers=headers)
    if detail is not None and (not isinstance(detail, dict) or detail.get("id") != item.activity_id or
                               not isinstance(detail.get("athlete"), dict) or detail["athlete"].get("id") != connection.athlete_id):
        raise StravaError("La actividad Strava no corresponde al atleta conectado.")
    streams = {}
    if detail is not None and not item.suppressed and (detail.get("sport_type") or detail.get("type")) in ACTIVITY_TYPES:
        streams = await strava_request(client, "GET", f"{API_ROOT}/activities/{item.activity_id}/streams",
                                       headers=headers, params={"keys": "latlng,altitude,time", "key_by_type": "true"})
    # Local deletion/restoration may have happened while waiting on Strava.
    item = db.scalar(select(StravaImport).where(StravaImport.id == item.id).with_for_update()
                     .execution_options(populate_existing=True))
    if item is None:
        db.rollback()
        return
    if detail is None:
        if item.entry_id is not None:
            db.execute(delete(JournalEntry).where(JournalEntry.id == item.entry_id, JournalEntry.user_id == connection.user_id))
            item.entry_id = None
    elif not item.suppressed:
        if (detail.get("sport_type") or detail.get("type")) not in ACTIVITY_TYPES:
            payload = None
        else:
            # Indoor/manual activities legitimately have no GPS streams.
            try:
                payload = activity_payload(detail, streams if streams is not None else {}, item.activity_id)
            except ValidationError:
                raise StravaError("La actividad de Strava no cumple el formato de Forma.", permanent=True) from None
        entry = db.get(JournalEntry, item.entry_id) if item.entry_id else None
        if payload is None:
            if entry:
                db.delete(entry)
                item.entry_id = None
        else:
            if entry is None:
                entry = JournalEntry(user_id=connection.user_id)
                db.add(entry)
            entry.module, entry.title, entry.occurred_at, entry.data = payload.module, payload.title, payload.occurred_at, payload.data
            db.flush()
            item.entry_id = entry.id
    db.flush()
    # A webhook arriving during the network calls must not lose its queued update.
    db.execute(update(StravaImport).where(StravaImport.id == item.id, StravaImport.generation == generation).values(pending=False, last_error=None))
    db.commit()


async def sync_connection(db: Session, connection: StravaConnection, client: httpx.AsyncClient) -> None:
    token = await access_token(db, connection, client)
    if connection.next_sync_at is None or utc_datetime(connection.next_sync_at) <= utc_now():
        scan_before = int(utc_now().timestamp()) if connection.scan_page == 1 else connection.scan_before
        activities = await strava_request(client, "GET", f"{API_ROOT}/athlete/activities",
            headers={"Authorization": f"Bearer {token}"},
            params={"after": connection.scan_after, "before": scan_before,
                    "page": connection.scan_page, "per_page": 30})
        db.refresh(connection)
        if not connection.tokens:
            raise StravaError("La conexión Strava se interrumpió durante la sincronización.")
        connection.scan_before = scan_before
        if not isinstance(activities, list):
            raise StravaError("Strava no devolvió la lista de actividades.")
        for activity in activities:
            activity_id = activity.get("id") if isinstance(activity, dict) else None
            if not isinstance(activity_id, int) or isinstance(activity_id, bool):
                raise StravaError("Strava devolvió un identificador de actividad no válido.")
            if db.scalar(select(StravaImport).where(StravaImport.user_id == connection.user_id, StravaImport.activity_id == activity_id)) is None:
                db.add(StravaImport(user_id=connection.user_id, activity_id=activity_id))
                db.flush()
        if len(activities) == 30:
            connection.scan_page += 1
            connection.next_sync_at = utc_now() + timedelta(seconds=30)
        else:
            connection.scan_after = max(connection.scan_after, connection.scan_before - 60)
            connection.scan_page = 1
            connection.next_sync_at = utc_now() + timedelta(minutes=15)
        db.commit()
    pending = list(db.scalars(select(StravaImport).where(
        StravaImport.user_id == connection.user_id, StravaImport.pending.is_(True)).order_by(StravaImport.id).limit(5)))
    for item in pending:
        item_id, generation = item.id, item.generation
        try:
            await import_activity(db, connection, item, client, token)
        except StravaError as reason:
            if not reason.permanent:
                raise
            db.rollback()
            db.execute(update(StravaImport).where(StravaImport.id == item_id, StravaImport.generation == generation)
                       .values(pending=False, last_error=str(reason)))
            db.commit()
            logger.warning("Strava activity could not be imported for connection %s: %s", connection.user_id, reason)
    connection.last_sync_at = utc_now()
    connection.last_error = None
    db.commit()


async def dispatch_strava_sync() -> None:
    with SessionLocal() as db:
        pending = exists().where(StravaImport.user_id == StravaConnection.user_id, StravaImport.pending.is_(True))
        ids = list(db.scalars(select(StravaConnection.user_id).where(
            StravaConnection.tokens.is_not(None),
            or_(StravaConnection.lease_until.is_(None), StravaConnection.lease_until < utc_now()),
            or_(StravaConnection.next_sync_at.is_(None), StravaConnection.next_sync_at <= utc_now(), pending),
        ).limit(20)))
    async with httpx.AsyncClient(timeout=12, follow_redirects=False) as client:
        for user_id in ids:
            with SessionLocal() as db:
                claimed = db.execute(update(StravaConnection).where(
                    StravaConnection.user_id == user_id,
                    or_(StravaConnection.lease_until.is_(None), StravaConnection.lease_until < utc_now()),
                ).values(lease_until=utc_now() + timedelta(minutes=5)))
                db.commit()
                if claimed.rowcount != 1:
                    continue
                connection = db.get(StravaConnection, user_id)
                try:
                    await sync_connection(db, connection, client)
                except StravaError as reason:
                    db.rollback()
                    connection = db.get(StravaConnection, user_id)
                    if connection is not None:
                        connection.last_error = str(reason)
                        connection.next_sync_at = utc_now() + timedelta(seconds=reason.retry_seconds)
                        # The lease also delays queued jobs after rate limits/network failures.
                        connection.lease_until = connection.next_sync_at
                        if reason.unauthorized:
                            remove_imports(db, user_id)
                            connection.tokens = None
                            connection.athlete_id = None
                        db.commit()
                    logger.warning("Strava synchronization failed for connection %s: %s", user_id, reason)
                else:
                    connection.lease_until = None
                    db.commit()
