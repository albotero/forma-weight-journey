from fastapi import APIRouter

from app.routers import (account, auth, body_measurements, catalog, doses, entries, medications, photos, profile,
                         telegram, weights)
from app.routers.common import limiter

router = APIRouter(prefix="/api")
for module in (telegram, auth, account, profile, catalog, medications, weights, doses, body_measurements, entries,
               photos):
    router.include_router(module.router)

__all__ = ["limiter", "router"]
