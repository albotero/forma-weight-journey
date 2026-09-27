from datetime import datetime, timedelta, timezone
from hashlib import sha256
from secrets import token_urlsafe

import jwt
from pwdlib import PasswordHash

from app.config import settings

password_hash = PasswordHash.recommended()
ALGORITHM = "HS256"


def hash_password(password: str) -> str:
    return password_hash.hash(password)


def verify_password(password: str, hashed: str) -> bool:
    return password_hash.verify(password, hashed)


def create_refresh_token() -> str:
    return token_urlsafe(48)


def hash_refresh_token(token: str) -> str:
    return sha256(token.encode("utf-8")).hexdigest()


def create_access_token(subject: str) -> str:
    expires = datetime.now(timezone.utc) + \
        timedelta(minutes=settings.access_token_minutes)
    return jwt.encode({"sub": subject, "exp": expires}, settings.secret_key, algorithm=ALGORITHM)
