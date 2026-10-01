import logging
import os
from datetime import datetime
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.dependencies import current_user
from app.models import PhotoRecord, User
from app.schemas import PhotoRecordOut, PhotoUpdate
from app.routers.common import utc_datetime, utc_now

router = APIRouter()
logger = logging.getLogger(__name__)


@router.get("/photos", response_model=list[PhotoRecordOut])
def list_photos(user: User = Depends(current_user), db: Session = Depends(get_db)) -> list[PhotoRecord]:
    return list(db.scalars(select(PhotoRecord).where(PhotoRecord.user_id == user.id).order_by(PhotoRecord.taken_at.desc(), PhotoRecord.id.desc())))


@router.post("/photos", response_model=PhotoRecordOut, status_code=status.HTTP_201_CREATED)
def upload_photo(file: UploadFile = File(...), caption: str | None = Form(default=None), taken_at: datetime | None = Form(default=None),
                 user: User = Depends(current_user), db: Session = Depends(get_db)) -> PhotoRecord:
    extensions = {"image/jpeg": ".jpg",
                  "image/png": ".png", "image/webp": ".webp"}
    if file.content_type not in extensions:
        raise HTTPException(
            status_code=415, detail="Only JPEG, PNG, or WebP images are supported")
    content = file.file.read(10 * 1024 * 1024 + 1)
    if len(content) > 10 * 1024 * 1024:
        raise HTTPException(
            status_code=413, detail="Image must be 10 MB or smaller")
    signature_matches = {
        "image/jpeg": content.startswith(b"\xff\xd8\xff"),
        "image/png": content.startswith(b"\x89PNG\r\n\x1a\n"),
        "image/webp": content.startswith(b"RIFF") and content[8:12] == b"WEBP",
    }
    if not signature_matches[file.content_type]:
        raise HTTPException(
            status_code=415, detail="Image content does not match its media type")
    photo_taken_at = utc_datetime(taken_at)
    if photo_taken_at > utc_now():
        raise HTTPException(
            status_code=422, detail="Photo date cannot be in the future")
    key = f"{uuid4().hex}{extensions[file.content_type]}"
    directory = Path(settings.storage_path) / "photos" / str(user.id)
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(directory, 0o700)
    file_path = directory / key
    try:
        file_path.write_bytes(content)
        os.chmod(file_path, 0o600)
        photo = PhotoRecord(user_id=user.id, file_key=key, content_type=file.content_type,
                            caption=caption, taken_at=photo_taken_at)
        db.add(photo)
        db.commit()
    except Exception:
        db.rollback()
        file_path.unlink(missing_ok=True)
        raise
    db.refresh(photo)
    return photo


@router.put("/photos/{photo_id}", response_model=PhotoRecordOut)
def update_photo(photo_id: int, payload: PhotoUpdate, user: User = Depends(current_user), db: Session = Depends(get_db)) -> PhotoRecord:
    photo = db.scalar(select(PhotoRecord).where(
        PhotoRecord.id == photo_id, PhotoRecord.user_id == user.id))
    if photo is None:
        raise HTTPException(status_code=404, detail="Photo not found")
    photo.caption = payload.caption
    photo.taken_at = utc_datetime(payload.taken_at)
    db.commit()
    db.refresh(photo)
    return photo


@router.get("/photos/{photo_id}/image")
def get_photo(photo_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)) -> FileResponse:
    photo = db.scalar(select(PhotoRecord).where(
        PhotoRecord.id == photo_id, PhotoRecord.user_id == user.id))
    if photo is None:
        raise HTTPException(status_code=404, detail="Photo not found")
    path = Path(settings.storage_path) / "photos" / \
        str(user.id) / photo.file_key
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Photo file not found")
    return FileResponse(path, media_type=photo.content_type, headers={"Cache-Control": "private, no-store"})


@router.delete("/photos/{photo_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_photo(photo_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)) -> Response:
    photo = db.scalar(select(PhotoRecord).where(
        PhotoRecord.id == photo_id, PhotoRecord.user_id == user.id))
    if photo is None:
        raise HTTPException(status_code=404, detail="Photo not found")
    path = Path(settings.storage_path) / "photos" / \
        str(user.id) / photo.file_key
    tombstone = path.with_name(f".{photo.file_key}.deleting")
    moved_file = path.is_file()
    if moved_file:
        os.replace(path, tombstone)
    db.delete(photo)
    try:
        db.commit()
    except Exception:
        db.rollback()
        if moved_file and tombstone.is_file():
            os.replace(tombstone, path)
        raise
    if moved_file:
        try:
            tombstone.unlink(missing_ok=True)
        except OSError:
            logger.warning(
                "Could not remove deleted photo file for record %s", photo_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
