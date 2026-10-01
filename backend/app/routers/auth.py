import secrets
from datetime import timedelta

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, Response, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.dependencies import current_user
from app.models import EmailVerificationToken, PasswordResetToken, RefreshSession, User, UserProfile
from app.password_reset_email import send_email_verification_email, send_password_reset_email
from app.schemas import EmailChangeRequest, EmailTokenConfirm, PasswordChange, PasswordResetConfirm, PasswordResetRequest, Token, UserCreate
from app.security import create_access_token, create_refresh_token, hash_password, hash_password_reset_token, hash_refresh_token, verify_password
from app.routers.common import limiter, utc_datetime, utc_now

router = APIRouter()


def issue_refresh_session(user: User, response: Response, db: Session) -> None:
    token = create_refresh_token()
    db.add(RefreshSession(
        user_id=user.id,
        token_hash=hash_refresh_token(token),
        expires_at=utc_now() + timedelta(days=settings.refresh_token_days),
    ))
    response.set_cookie(
        "forma_refresh", token, max_age=settings.refresh_token_days * 86400,
        httponly=True, secure=settings.cookie_secure, samesite="strict", path="/api/auth",
        domain=settings.cookie_domain,
    )


def clear_refresh_cookie(response: Response) -> None:
    response.delete_cookie("forma_refresh", httponly=True, secure=settings.cookie_secure,
                           samesite="strict", path="/api/auth", domain=settings.cookie_domain)


def issue_email_verification(user: User, email: str, purpose: str, db: Session) -> str:
    now = utc_now()
    for previous in db.scalars(select(EmailVerificationToken).where(
            EmailVerificationToken.user_id == user.id,
            EmailVerificationToken.purpose == purpose,
            EmailVerificationToken.used_at.is_(None))).all():
        previous.used_at = now
    token = secrets.token_urlsafe(32)
    db.add(EmailVerificationToken(
        user_id=user.id,
        email=email,
        purpose=purpose,
        token_hash=hash_password_reset_token(token),
        expires_at=now +
        timedelta(hours=settings.email_verification_token_hours),
    ))
    return token


def validate_auth_origin(request: Request) -> None:
    origin = request.headers.get("origin")
    allowed = {value.strip() for value in settings.cors_origins.split(",")}
    if origin and origin not in allowed:
        raise HTTPException(status_code=403, detail="Untrusted request origin")


@router.post("/auth/register", status_code=status.HTTP_202_ACCEPTED)
@limiter.limit("10/minute")
def register(request: Request, background_tasks: BackgroundTasks, payload: UserCreate, db: Session = Depends(get_db)) -> dict[str, str]:
    validate_auth_origin(request)
    if not settings.smtp_configured:
        raise HTTPException(
            status_code=503, detail="El registro requiere correo de verificación y el envío no está configurado.")
    email = str(payload.email).lower()
    if db.scalar(select(User).where(User.email == email)):
        raise HTTPException(
            status_code=409, detail="An account with this email already exists")
    user = User(email=email, password_hash=hash_password(payload.password))
    db.add(user)
    db.flush()
    db.add(UserProfile(user_id=user.id, timezone=settings.timezone))
    verification_token = issue_email_verification(user, email, "signup", db)
    db.commit()
    background_tasks.add_task(send_email_verification_email,
                              email, verification_token, "signup")
    return {"message": "Revisa tu correo y confirma la dirección antes de iniciar sesión."}


@router.post("/auth/login", response_model=Token)
@limiter.limit("10/minute")
def login(request: Request, response: Response, form: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)) -> Token:
    user = db.scalar(select(User).where(User.email == form.username.lower()))
    if user is None or not verify_password(form.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Incorrect email or password", headers={
                            "WWW-Authenticate": "Bearer"})
    if user.email_verified_at is None:
        raise HTTPException(
            status_code=403, detail="Confirma tu correo antes de iniciar sesión.")
    issue_refresh_session(user, response, db)
    db.commit()
    return Token(access_token=create_access_token(str(user.id), user.auth_version or 0))


@router.post("/auth/email-verification/request", status_code=status.HTTP_202_ACCEPTED)
@limiter.limit("5/hour")
def request_email_verification(
    request: Request,
    background_tasks: BackgroundTasks,
    payload: PasswordResetRequest,
    db: Session = Depends(get_db),
) -> dict[str, str]:
    validate_auth_origin(request)
    if not settings.smtp_configured:
        raise HTTPException(
            status_code=503, detail="El envío de correo no está configurado.")
    email = str(payload.email).lower()
    user = db.scalar(select(User).where(User.email == email))
    if user is not None and user.email_verified_at is None:
        token = issue_email_verification(user, email, "signup", db)
        db.commit()
        background_tasks.add_task(
            send_email_verification_email, email, token, "signup")
    return {"message": "Si existe una cuenta pendiente con ese correo, enviaremos un enlace de verificación."}


@router.post("/auth/email-verification/confirm")
@limiter.limit("10/hour")
def confirm_email_verification(
    request: Request,
    response: Response,
    payload: EmailTokenConfirm,
    db: Session = Depends(get_db),
) -> dict[str, str]:
    validate_auth_origin(request)
    now = utc_now()
    verification = db.scalar(select(EmailVerificationToken).where(
        EmailVerificationToken.token_hash == hash_password_reset_token(
            payload.token),
        EmailVerificationToken.used_at.is_(None),
        EmailVerificationToken.expires_at > now,
    ).with_for_update())
    if verification is None:
        raise HTTPException(
            status_code=400, detail="El enlace expiró o no es válido. Solicita uno nuevo.")

    claimed = db.execute(update(EmailVerificationToken).where(
        EmailVerificationToken.id == verification.id,
        EmailVerificationToken.used_at.is_(None),
        EmailVerificationToken.expires_at > now,
    ).values(used_at=now).execution_options(synchronize_session=False))
    if claimed.rowcount != 1:
        db.rollback()
        raise HTTPException(
            status_code=400, detail="El enlace expiró o no es válido. Solicita uno nuevo.")

    user = db.get(User, verification.user_id)
    if user is None:
        db.rollback()
        raise HTTPException(
            status_code=400, detail="El enlace expiró o no es válido. Solicita uno nuevo.")
    if verification.purpose == "signup" and user.email == verification.email and user.email_verified_at is None:
        user.email_verified_at = now
        message = "Correo confirmado. Ya puedes iniciar sesión."
    elif verification.purpose == "email-change" and user.pending_email == verification.email:
        existing = db.scalar(select(User.id).where(
            User.email == verification.email, User.id != user.id))
        if existing is not None:
            db.rollback()
            raise HTTPException(
                status_code=409, detail="Ese correo ya pertenece a otra cuenta.")
        user.email = verification.email
        user.pending_email = None
        user.auth_version = (user.auth_version or 0) + 1
        db.execute(update(RefreshSession).where(
            RefreshSession.user_id == user.id,
            RefreshSession.revoked_at.is_(None),
        ).values(revoked_at=now))
        message = "Correo actualizado. Inicia sesión de nuevo."
    else:
        db.rollback()
        raise HTTPException(
            status_code=400, detail="El enlace expiró o no es válido. Solicita uno nuevo.")

    db.commit()
    clear_refresh_cookie(response)
    return {"message": message}


@router.post("/auth/email-change/request", status_code=status.HTTP_202_ACCEPTED)
@limiter.limit("5/hour")
def request_email_change(
    request: Request,
    background_tasks: BackgroundTasks,
    payload: EmailChangeRequest,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> dict[str, str]:
    validate_auth_origin(request)
    if not settings.smtp_configured:
        raise HTTPException(
            status_code=503, detail="El envío de correo no está configurado.")
    if user.email_verified_at is None:
        raise HTTPException(
            status_code=403, detail="Confirma tu correo actual antes de cambiarlo.")
    if not verify_password(payload.current_password, user.password_hash):
        raise HTTPException(
            status_code=400, detail="La contraseña actual no es correcta.")
    new_email = str(payload.new_email).lower()
    if new_email == user.email:
        raise HTTPException(
            status_code=422, detail="El nuevo correo debe ser distinto.")
    existing = db.scalar(select(User.id).where(
        User.email == new_email, User.id != user.id))
    pending = db.scalar(select(User.id).where(
        User.pending_email == new_email, User.id != user.id))
    if existing is not None or pending is not None:
        raise HTTPException(
            status_code=409, detail="Ese correo ya pertenece a otra cuenta o solicitud pendiente.")

    user.pending_email = new_email
    token = issue_email_verification(user, new_email, "email-change", db)
    db.commit()
    background_tasks.add_task(send_email_verification_email,
                              new_email, token, "email-change")
    return {"message": "Enviamos un enlace al nuevo correo. La dirección actual sigue activa hasta que lo confirmes."}


@router.post("/auth/refresh", response_model=Token)
def refresh_session(request: Request, response: Response, db: Session = Depends(get_db)) -> Token:
    validate_auth_origin(request)
    token = request.cookies.get("forma_refresh")
    session = db.scalar(select(RefreshSession).where(
        RefreshSession.token_hash == hash_refresh_token(token or "")))
    if session is None or session.revoked_at is not None or utc_datetime(session.expires_at) <= utc_now():
        clear_refresh_cookie(response)
        raise HTTPException(status_code=401, detail="Session expired")
    user = db.get(User, session.user_id)
    if user is None:
        clear_refresh_cookie(response)
        raise HTTPException(status_code=401, detail="Session expired")
    session.revoked_at = utc_now()
    issue_refresh_session(user, response, db)
    db.commit()
    return Token(access_token=create_access_token(str(user.id), user.auth_version or 0))


@router.post("/auth/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(request: Request, response: Response, db: Session = Depends(get_db)) -> Response:
    validate_auth_origin(request)
    token = request.cookies.get("forma_refresh")
    if token:
        session = db.scalar(select(RefreshSession).where(
            RefreshSession.token_hash == hash_refresh_token(token)))
        if session is not None and session.revoked_at is None:
            session.revoked_at = utc_now()
            db.commit()
    clear_refresh_cookie(response)
    response.status_code = status.HTTP_204_NO_CONTENT
    return response


@router.put("/auth/password", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit("5/minute")
def change_password(request: Request, payload: PasswordChange, user: User = Depends(current_user), db: Session = Depends(get_db)) -> Response:
    if not verify_password(payload.current_password, user.password_hash):
        raise HTTPException(
            status_code=400, detail="La contraseña actual no es correcta")
    if payload.current_password == payload.new_password:
        raise HTTPException(
            status_code=422, detail="La nueva contraseña debe ser distinta")
    user.password_hash = hash_password(payload.new_password)
    user.auth_version = (user.auth_version or 0) + 1
    for session in db.scalars(select(RefreshSession).where(
            RefreshSession.user_id == user.id, RefreshSession.revoked_at.is_(None))).all():
        session.revoked_at = utc_now()
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/auth/password-reset/request", status_code=status.HTTP_202_ACCEPTED)
@limiter.limit("5/hour")
def request_password_reset(
    request: Request,
    background_tasks: BackgroundTasks,
    payload: PasswordResetRequest,
    db: Session = Depends(get_db),
) -> dict[str, str]:
    validate_auth_origin(request)
    if not settings.password_reset_email_configured:
        raise HTTPException(
            status_code=503, detail="El restablecimiento por correo no está configurado.")

    email = str(payload.email).lower()
    user = db.scalar(select(User).where(User.email == email))
    if user is not None and user.email_verified_at is not None:
        now = utc_now()
        for previous in db.scalars(select(PasswordResetToken).where(
                PasswordResetToken.user_id == user.id, PasswordResetToken.used_at.is_(None))).all():
            previous.used_at = now
        token = secrets.token_urlsafe(32)
        db.add(PasswordResetToken(
            user_id=user.id,
            token_hash=hash_password_reset_token(token),
            expires_at=now +
            timedelta(minutes=settings.password_reset_token_minutes),
        ))
        db.commit()
        background_tasks.add_task(send_password_reset_email, email, token)

    return {"message": "Si existe una cuenta con ese correo, recibirás un enlace para restablecer la contraseña."}


@router.post("/auth/password-reset/confirm")
@limiter.limit("10/hour")
def confirm_password_reset(
    request: Request,
    response: Response,
    payload: PasswordResetConfirm,
    db: Session = Depends(get_db),
) -> dict[str, str]:
    validate_auth_origin(request)
    now = utc_now()
    reset = db.scalar(select(PasswordResetToken).where(
        PasswordResetToken.token_hash == hash_password_reset_token(
            payload.token),
        PasswordResetToken.used_at.is_(None),
        PasswordResetToken.expires_at > now,
    ).with_for_update())
    if reset is None:
        raise HTTPException(
            status_code=400, detail="El enlace expiró o no es válido. Solicita uno nuevo.")

    claimed = db.execute(update(PasswordResetToken).where(
        PasswordResetToken.id == reset.id,
        PasswordResetToken.used_at.is_(None),
        PasswordResetToken.expires_at > now,
    ).values(used_at=now).execution_options(synchronize_session=False))
    if claimed.rowcount != 1:
        db.rollback()
        raise HTTPException(
            status_code=400, detail="El enlace expiró o no es válido. Solicita uno nuevo.")

    user = db.get(User, reset.user_id)
    if user is None:
        db.rollback()
        raise HTTPException(
            status_code=400, detail="El enlace expiró o no es válido. Solicita uno nuevo.")
    user.password_hash = hash_password(payload.new_password)
    user.auth_version = (user.auth_version or 0) + 1
    db.execute(update(RefreshSession).where(
        RefreshSession.user_id == user.id,
        RefreshSession.revoked_at.is_(None),
    ).values(revoked_at=now))
    db.execute(update(PasswordResetToken).where(
        PasswordResetToken.user_id == user.id,
        PasswordResetToken.id != reset.id,
        PasswordResetToken.used_at.is_(None),
    ).values(used_at=now))
    db.commit()
    clear_refresh_cookie(response)
    return {"message": "Contraseña actualizada. Inicia sesión con tu nueva contraseña."}
