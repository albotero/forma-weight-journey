import asyncio
from contextlib import asynccontextmanager, suppress
from collections.abc import Awaitable, Callable

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.exception_handlers import request_validation_exception_handler
from fastapi.middleware.cors import CORSMiddleware
from starlette.responses import JSONResponse, Response
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from sqlalchemy import text

from app.config import settings
from app.database import engine
from app.routers.api import limiter, router
from app.telegram import configure_webhook, dispatch_due_reminders
from app.strava import dispatch_strava_sync, install_log_filters

install_log_filters()


async def reminder_loop() -> None:
    while True:
        try:
            await dispatch_due_reminders()
        except Exception:
            import logging

            logging.getLogger(__name__).exception("Reminder dispatch failed")
        await asyncio.sleep(30)


async def strava_loop() -> None:
    while True:
        try:
            await dispatch_strava_sync()
        except Exception as reason:
            import logging

            # Do not log provider responses, URLs, credentials or activity payloads.
            logging.getLogger(__name__).error("Strava worker failed (%s)", type(reason).__name__)
        await asyncio.sleep(30)


@asynccontextmanager
async def lifespan(_: FastAPI):
    with engine.connect() as connection:
        connection.execute(text("SELECT 1"))
    await configure_webhook()
    task = asyncio.create_task(reminder_loop())
    strava_task = asyncio.create_task(strava_loop())
    try:
        yield
    finally:
        task.cancel()
        strava_task.cancel()
        with suppress(asyncio.CancelledError):
            await task
        with suppress(asyncio.CancelledError):
            await strava_task


app = FastAPI(
    title="Forma · seguimiento personal API",
    description="Private health tracking API. Descriptive organization only; not a diagnostic or prescribing tool.",
    version="0.1.0",
    lifespan=lifespan,
)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip()
                   for origin in settings.cors_origins.split(",")],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    allow_headers=["Authorization", "Content-Type"],
)
app.include_router(router)


@app.exception_handler(RequestValidationError)
async def validation_error(request: Request, error: RequestValidationError) -> Response:
    if request.url.path.startswith("/api/strava/"):
        return JSONResponse(status_code=422, content={"detail": [
            {"loc": list(item["loc"]), "msg": item["msg"], "type": item["type"]}
            for item in error.errors()
        ]})
    return await request_validation_exception_handler(request, error)


@app.middleware("http")
async def security_headers(request: Request, call_next: Callable[[Request], Awaitable[Response]]) -> Response:
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Cache-Control"] = "no-store"
    return response


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
