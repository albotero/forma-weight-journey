from datetime import datetime, timezone

from fastapi import Request
from slowapi import Limiter
from slowapi.util import get_remote_address

def rate_limit_client_address(request: Request) -> str:
    # The API is private behind Nginx, which overwrites X-Real-IP with $remote_addr.
    return request.headers.get("x-real-ip") or get_remote_address(request)


limiter = Limiter(key_func=rate_limit_client_address)


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def utc_datetime(value: datetime | None) -> datetime:
    result = value or utc_now()
    return result.replace(tzinfo=timezone.utc) if result.tzinfo is None else result.astimezone(timezone.utc)
