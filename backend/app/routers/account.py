from typing import Any

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.config import settings
from app.data_transfer import (
    MAX_ARCHIVE_BYTES,
    build_export,
    build_json_export,
    parse_export,
    preview_export,
    restore_export,
)
from app.database import get_db
from app.dependencies import current_user
from app.models import User
from app.schemas import AccountOut
from app.routers.common import limiter

router = APIRouter()


@router.get("/account", response_model=AccountOut)
def get_account(user: User = Depends(current_user)) -> AccountOut:
    return AccountOut(
        email=user.email,
        email_verified=user.email_verified_at is not None,
        pending_email=user.pending_email,
        created_at=user.created_at,
    )


@router.get("/account/export")
@limiter.limit("5/hour")
def export_account_data(request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)) -> StreamingResponse:
    try:
        archive = build_export(db, user, settings.storage_path)
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from None
    return StreamingResponse(
        iter([archive]), media_type="application/zip",
        headers={
            "Content-Disposition": 'attachment; filename="forma-account-export.zip"'},
    )


@router.get("/account/export/json")
@limiter.limit("5/hour")
def export_account_json(request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)) -> StreamingResponse:
    try:
        document = build_json_export(db, user, settings.storage_path)
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from None
    return StreamingResponse(
        iter([document]), media_type="application/json",
        headers={
            "Content-Disposition": 'attachment; filename="forma-account-export.json"'},
    )


@router.post("/account/import/preview")
@limiter.limit("10/hour")
async def preview_account_import(request: Request, file: UploadFile = File(...), user: User = Depends(current_user)) -> dict[str, Any]:
    content = await file.read(MAX_ARCHIVE_BYTES + 1)
    try:
        return preview_export(parse_export(content, user.email))
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from None


@router.post("/account/import")
@limiter.limit("3/hour")
async def import_account_data(request: Request, file: UploadFile = File(...), user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict[str, Any]:
    content = await file.read(MAX_ARCHIVE_BYTES + 1)
    try:
        parsed = parse_export(content, user.email)
        return restore_export(db, user, parsed, settings.storage_path)
    except ValueError as error:
        db.rollback()
        raise HTTPException(status_code=422, detail=str(error)) from None
