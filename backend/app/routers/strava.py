import hashlib
import hmac
import secrets
from datetime import timedelta
from urllib.parse import urlencode, urlparse

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, ConfigDict, Field, SecretStr
from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.dependencies import current_user
from app.models import JournalEntry, StravaConnection, StravaImport, User
from app.routers.common import limiter, utc_datetime, utc_now
from app.security import verify_password
from app.strava import (API_ROOT, StravaError, access_token, configure_subscription,
                        decrypt, encrypt, public_url, remove_imports, strava_request, token_values)

router = APIRouter()
STATE_COOKIE = "forma_strava_state"


class Credentials(BaseModel):
    client_id: str = Field(pattern=r"^[0-9]{1,20}$")
    client_secret: SecretStr = Field(min_length=8, max_length=256)
    current_password: SecretStr = Field(min_length=1, max_length=128)


class Authorization(BaseModel):
    import_last_30_days: bool = False


class WebhookEvent(BaseModel):
    model_config = ConfigDict(extra="ignore")
    object_type: str = Field(pattern=r"^(activity|athlete)$")
    aspect_type: str = Field(pattern=r"^(create|update|delete)$")
    object_id: int = Field(gt=0, strict=True)
    owner_id: int = Field(gt=0, strict=True)
    subscription_id: int = Field(gt=0, strict=True)
    event_time: int = Field(gt=0, strict=True)
    updates: dict[str, str] = Field(default_factory=dict, max_length=20)


def connection_for(db: Session, user: User) -> StravaConnection:
    connection = db.get(StravaConnection, user.id)
    if connection is None:
        raise HTTPException(400, "Primero guarda las credenciales de tu aplicación Strava.")
    return connection


def ensure_idle(connection: StravaConnection) -> None:
    if connection.lease_until and utc_datetime(connection.lease_until) > utc_now() and connection.lease_until != connection.next_sync_at:
        raise HTTPException(409, "Hay una sincronización de Strava en curso. Inténtalo en unos minutos.")


@router.get("/strava/connection")
def status(user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    connection = db.get(StravaConnection, user.id)
    try:
        base = public_url()
        configuration_error = None
    except StravaError as reason:
        base = ""
        configuration_error = str(reason)
    return {
        "configured": connection is not None, "client_id": connection.client_id if connection else "",
        "linked": bool(connection and connection.tokens and connection.athlete_id),
        "callback_url": f"{base}/api/strava/callback" if base else "",
        "callback_domain": urlparse(base).hostname if base else "",
        "configuration_error": configuration_error,
        "last_sync_at": connection.last_sync_at if connection else None,
        "last_error": connection.last_error if connection else None,
        "webhook_active": bool(connection and connection.subscription_id),
        "webhook_error": connection.webhook_error if connection else None,
        "imported_count": db.scalar(select(func.count()).select_from(StravaImport).where(
            StravaImport.user_id == user.id, StravaImport.entry_id.is_not(None))) or 0,
        "pending_count": db.scalar(select(func.count()).select_from(StravaImport).where(
            StravaImport.user_id == user.id, StravaImport.pending.is_(True))) or 0,
        "failed_count": db.scalar(select(func.count()).select_from(StravaImport).where(
            StravaImport.user_id == user.id, StravaImport.last_error.is_not(None))) or 0,
        "import_error": db.scalar(select(StravaImport.last_error).where(
            StravaImport.user_id == user.id, StravaImport.last_error.is_not(None)).limit(1)),
    }


@router.put("/strava/credentials")
@limiter.limit("5/minute")
def save_credentials(request: Request, payload: Credentials, user: User = Depends(current_user),
                     db: Session = Depends(get_db)) -> dict[str, bool]:
    if not verify_password(payload.current_password.get_secret_value(), user.password_hash):
        raise HTTPException(400, "La contraseña actual no es correcta.")
    try:
        public_url()
    except StravaError as reason:
        raise HTTPException(503, str(reason)) from None
    connection = db.get(StravaConnection, user.id)
    if connection is not None:
        ensure_idle(connection)
        if connection.tokens or connection.subscription_id:
            raise HTTPException(409, "Desconecta y elimina la configuración anterior antes de cambiar las credenciales.")
        connection.client_id = payload.client_id
        connection.client_secret = encrypt(payload.client_secret.get_secret_value())
        connection.state_hash = None
        connection.last_error = None
    else:
        db.add(StravaConnection(
            user_id=user.id, client_id=payload.client_id,
            client_secret=encrypt(payload.client_secret.get_secret_value()),
            webhook_key=secrets.token_urlsafe(32), verify_token=secrets.token_urlsafe(32),
        ))
    try:
        db.flush()
        # Reattach restored Strava records without creating another copy on connection.
        for entry in db.scalars(select(JournalEntry).where(JournalEntry.user_id == user.id, JournalEntry.module == "activity")):
            activity_id = entry.data.get("strava_activity_id")
            if entry.data.get("source") != "strava" or not isinstance(activity_id, int) or isinstance(activity_id, bool) or activity_id <= 0:
                continue
            if db.scalar(select(StravaImport).where(StravaImport.user_id == user.id, StravaImport.activity_id == activity_id)) is None:
                db.add(StravaImport(user_id=user.id, activity_id=activity_id, entry_id=entry.id))
                db.flush()
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "Esta aplicación Strava ya está configurada en otra cuenta Forma.") from None
    return {"saved": True}


@router.post("/strava/authorize")
@limiter.limit("5/minute")
def authorize(request: Request, payload: Authorization, response: Response,
              user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict[str, str]:
    connection = connection_for(db, user)
    ensure_idle(connection)
    if connection.tokens:
        raise HTTPException(409, "Desconecta Strava antes de volver a conectar.")
    try:
        base = public_url()
    except StravaError as reason:
        raise HTTPException(503, str(reason)) from None
    state = secrets.token_urlsafe(32)
    connection.state_hash = hashlib.sha256(state.encode()).hexdigest()
    connection.state_expires_at = utc_now() + timedelta(minutes=10)
    connection.state_auth_version = user.auth_version
    connection.import_history = payload.import_last_30_days
    db.commit()
    response.set_cookie(STATE_COOKIE, state, max_age=600, httponly=True, secure=settings.cookie_secure,
                        samesite="lax", path="/api/strava")
    return {"authorization_url": "https://www.strava.com/oauth/authorize?" + urlencode({
        "client_id": connection.client_id, "redirect_uri": f"{base}/api/strava/callback",
        "response_type": "code", "approval_prompt": "force", "scope": "read,activity:read_all", "state": state,
    })}


@router.get("/strava/callback")
async def callback(request: Request, state: str = Query(max_length=128), code: str | None = Query(default=None, max_length=512),
                   scope: str = Query(default="", max_length=500), error: str | None = Query(default=None, max_length=128),
                   db: Session = Depends(get_db)) -> Response:
    cookie = request.cookies.get(STATE_COOKIE, "")
    if not cookie or not hmac.compare_digest(cookie, state):
        raise HTTPException(400, "La autorización Strava no pertenece a este navegador o ha caducado.")
    connection = db.scalar(select(StravaConnection).where(
        StravaConnection.state_hash == hashlib.sha256(state.encode()).hexdigest()).with_for_update())
    if connection is None or connection.state_expires_at is None or utc_datetime(connection.state_expires_at) <= utc_now():
        raise HTTPException(400, "La autorización Strava ha caducado. Vuelve a conectar.")
    user = db.get(User, connection.user_id)
    if user is None or user.auth_version != connection.state_auth_version:
        raise HTTPException(400, "La sesión de Forma cambió. Vuelve a conectar Strava.")
    connection.state_hash = None
    connection.state_expires_at = None
    db.commit()
    result = "error"
    try:
        if error or not code:
            raise StravaError("No autorizaste la conexión con Strava.")
        if "activity:read_all" not in scope.split(","):
            raise StravaError("Concede acceso a todas tus actividades para sincronizar también las privadas.")
        async with httpx.AsyncClient(timeout=12, follow_redirects=False) as client:
            payload = await strava_request(client, "POST", "https://www.strava.com/oauth/token", data={
                "client_id": connection.client_id, "client_secret": decrypt(connection.client_secret),
                "code": code, "grant_type": "authorization_code",
            })
            tokens, expiry = token_values(payload)
            athlete = payload.get("athlete", {}).get("id")
            if not isinstance(athlete, int) or isinstance(athlete, bool):
                raise StravaError("Strava no devolvió el atleta autorizado.")
            if db.scalar(select(StravaConnection).where(StravaConnection.athlete_id == athlete,
                                                        StravaConnection.user_id != user.id)):
                raise StravaError("Ese atleta ya está conectado a otra cuenta Forma.")
            now = utc_now()
            connection.tokens, connection.expires_at, connection.athlete_id = tokens, expiry, athlete
            connection.linked_at = now
            connection.scan_after = int((now - timedelta(days=30) if connection.import_history else now).timestamp())
            connection.scan_page = 1
            connection.next_sync_at = now
            connection.lease_until = None
            connection.last_error = None
            db.commit()
            try:
                await configure_subscription(db, connection, client)
            except StravaError as reason:
                connection.webhook_error = str(reason)
                db.commit()
            result = "connected"
    except StravaError as reason:
        connection.last_error = str(reason)
        db.commit()
    response = RedirectResponse(f"{public_url()}/perfil?strava={result}", status_code=303)
    response.delete_cookie(STATE_COOKIE, path="/api/strava")
    return response


@router.post("/strava/sync")
@limiter.limit("5/minute")
def queue_sync(request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict[str, bool]:
    connection = connection_for(db, user)
    if not connection.tokens:
        raise HTTPException(400, "Primero conecta tu cuenta de Strava.")
    ensure_idle(connection)
    if connection.lease_until and utc_datetime(connection.lease_until) > utc_now():
        raise HTTPException(429, "Espera a que termine el intervalo de reintento de Strava.")
    db.execute(update(StravaImport).where(StravaImport.user_id == user.id, StravaImport.last_error.is_not(None))
               .values(pending=True, generation=StravaImport.generation + 1))
    connection.next_sync_at = utc_now()
    db.commit()
    return {"queued": True}


@router.post("/strava/webhook-setup")
@limiter.limit("3/minute")
async def setup(request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict[str, bool]:
    connection = connection_for(db, user)
    if not connection.tokens:
        raise HTTPException(400, "Primero conecta tu cuenta de Strava.")
    try:
        async with httpx.AsyncClient(timeout=12, follow_redirects=False) as client:
            await configure_subscription(db, connection, client)
    except StravaError as reason:
        connection.webhook_error = str(reason)
        db.commit()
        raise HTTPException(502, str(reason)) from None
    return {"configured": True}


@router.delete("/strava/connection", status_code=204)
@limiter.limit("3/minute")
async def disconnect(request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)) -> Response:
    connection = db.get(StravaConnection, user.id)
    if connection is None:
        return Response(status_code=204)
    ensure_idle(connection)
    try:
        async with httpx.AsyncClient(timeout=12, follow_redirects=False) as client:
            if connection.tokens:
                try:
                    token = await access_token(db, connection, client)
                    await strava_request(client, "POST", "https://www.strava.com/oauth/deauthorize",
                                         data={"access_token": token})
                except StravaError as reason:
                    if not reason.unauthorized:
                        raise
            if connection.subscription_id:
                await strava_request(client, "DELETE", f"{API_ROOT}/push_subscriptions/{connection.subscription_id}",
                                     params={"client_id": connection.client_id, "client_secret": decrypt(connection.client_secret)})
    except StravaError as reason:
        raise HTTPException(502, str(reason)) from None
    remove_imports(db, user.id)
    db.delete(connection)
    db.commit()
    return Response(status_code=204)


@router.get("/strava/webhook/{key}")
def verify_webhook(key: str, mode: str = Query(alias="hub.mode", max_length=30),
                   token: str = Query(alias="hub.verify_token", max_length=128),
                   challenge: str = Query(alias="hub.challenge", max_length=256),
                   db: Session = Depends(get_db)) -> dict[str, str]:
    connection = db.scalar(select(StravaConnection).where(StravaConnection.webhook_key == key))
    if mode != "subscribe" or not connection or not hmac.compare_digest(token, connection.verify_token):
        raise HTTPException(403, "Verificación de Strava no válida.")
    return {"hub.challenge": challenge}


@router.post("/strava/webhook/{key}")
@limiter.limit("120/minute")
def webhook(key: str, payload: WebhookEvent, request: Request, db: Session = Depends(get_db)) -> dict[str, bool]:
    connection = db.scalar(select(StravaConnection).where(StravaConnection.webhook_key == key))
    if not connection or not connection.tokens or connection.subscription_id != payload.subscription_id or connection.athlete_id != payload.owner_id:
        raise HTTPException(403, "Evento de Strava no válido.")
    if payload.event_time > int(utc_now().timestamp()) + 300:
        raise HTTPException(400, "Evento Strava con fecha futura.")
    if payload.object_type == "athlete":
        if payload.object_id != connection.athlete_id:
            raise HTTPException(403, "Atleta de Strava no válido.")
        if payload.updates.get("authorized") == "false":
            # Confirm revocation with Strava rather than trusting an unsigned event.
            connection.expires_at = utc_now()
            connection.next_sync_at = utc_now()
            db.commit()
    else:
        item = db.scalar(select(StravaImport).where(StravaImport.user_id == connection.user_id,
                                                    StravaImport.activity_id == payload.object_id))
        if item is None:
            item = StravaImport(user_id=connection.user_id, activity_id=payload.object_id, event_time=payload.event_time)
            db.add(item)
        elif payload.event_time >= item.event_time:
            db.execute(update(StravaImport).where(StravaImport.id == item.id).values(
                event_time=payload.event_time, pending=True, generation=StravaImport.generation + 1))
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            # Another event created the same durable job concurrently.
            item = db.scalar(select(StravaImport).where(StravaImport.user_id == connection.user_id,
                                                        StravaImport.activity_id == payload.object_id))
            if item is None:
                raise
            db.execute(update(StravaImport).where(StravaImport.id == item.id).values(
                pending=True, event_time=max(item.event_time, payload.event_time), generation=StravaImport.generation + 1))
            db.commit()
    return {"received": True}
