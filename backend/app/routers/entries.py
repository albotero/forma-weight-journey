from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.automatic_reminders import sync_automatic_reminders
from app.database import get_db
from app.dependencies import current_user
from app.models import JournalEntry, User
from app.schemas import JournalEntryCreate, JournalEntryOut, ReminderToggle
from app.routers.common import utc_datetime, utc_now

router = APIRouter()


@router.get("/entries/{module}", response_model=list[JournalEntryOut])
def list_entries(module: str, limit: int = Query(default=100, ge=1, le=500), offset: int = Query(default=0, ge=0), user: User = Depends(current_user), db: Session = Depends(get_db)) -> list[JournalEntry]:
    if module == "reminders":
        sync_automatic_reminders(db, user)
    statement = select(JournalEntry).where(JournalEntry.user_id == user.id,
                                           JournalEntry.module == module).order_by(JournalEntry.occurred_at.desc(), JournalEntry.id.desc()).offset(offset).limit(limit)
    return list(db.scalars(statement))


@router.patch("/entries/{entry_id}/enabled", response_model=JournalEntryOut)
def toggle_reminder(entry_id: int, payload: ReminderToggle, user: User = Depends(current_user), db: Session = Depends(get_db)) -> JournalEntry:
    entry = db.scalar(select(JournalEntry).where(
        JournalEntry.id == entry_id, JournalEntry.user_id == user.id,
        JournalEntry.module == "reminders",
    ))
    if entry is None:
        raise HTTPException(status_code=404, detail="Reminder not found")
    data = dict(entry.data or {})
    if payload.enabled and data.get("auto_generated") is True:
        scheduled = data.get("reminder_at")
        scheduled_at = None
        if isinstance(scheduled, str):
            try:
                scheduled_at = datetime.fromisoformat(
                    scheduled.replace("Z", "+00:00"))
                scheduled_at = utc_datetime(scheduled_at)
            except ValueError:
                scheduled_at = None
        if scheduled_at is not None and data.get("last_sent_epoch") == int(scheduled_at.timestamp()):
            raise HTTPException(
                status_code=409, detail="This automatic reminder was already sent; it will be recreated after the next record")
        if scheduled_at is not None and scheduled_at <= utc_now():
            scheduled_at = utc_now() + timedelta(seconds=30)
            data["reminder_at"] = scheduled_at.isoformat()
            data["schedule_override"] = True
            entry.occurred_at = scheduled_at
    data["enabled"] = "Sí" if payload.enabled else "No"
    if payload.enabled:
        data.pop("source_missing", None)
        data.pop("user_disabled", None)
        data.pop("system_disabled_reason", None)
    else:
        data["user_disabled"] = True
        data.pop("system_disabled_reason", None)
    entry.data = data
    db.commit()
    db.refresh(entry)
    return entry


@router.post("/entries", response_model=JournalEntryOut, status_code=status.HTTP_201_CREATED)
def create_entry(payload: JournalEntryCreate, user: User = Depends(current_user), db: Session = Depends(get_db)) -> JournalEntry:
    if payload.module == "reminders" and payload.data.get("auto_generated") is True:
        raise HTTPException(
            status_code=422, detail="Automatic reminder metadata is reserved")
    entry = JournalEntry(user_id=user.id, module=payload.module, occurred_at=utc_datetime(payload.occurred_at),
                         title=payload.title, data=payload.data, notes=payload.notes)
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return entry


@router.put("/entries/{entry_id}", response_model=JournalEntryOut)
def update_entry(entry_id: int, payload: JournalEntryCreate, user: User = Depends(current_user), db: Session = Depends(get_db)) -> JournalEntry:
    entry = db.scalar(select(JournalEntry).where(
        JournalEntry.id == entry_id, JournalEntry.user_id == user.id))
    if entry is None or entry.module != payload.module:
        raise HTTPException(status_code=404, detail="Record not found")
    if entry.module == "reminders" and entry.data and entry.data.get("auto_generated") is True:
        raise HTTPException(
            status_code=409, detail="Automatic reminders can only be enabled or disabled")
    if payload.module == "reminders" and payload.data.get("auto_generated") is True:
        raise HTTPException(
            status_code=422, detail="Automatic reminder metadata is reserved")
    entry.occurred_at = utc_datetime(payload.occurred_at)
    entry.title = payload.title
    entry.data = payload.data
    entry.notes = payload.notes
    db.commit()
    db.refresh(entry)
    return entry


@router.delete("/entries/{entry_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_entry(entry_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)) -> Response:
    entry = db.scalar(select(JournalEntry).where(
        JournalEntry.id == entry_id, JournalEntry.user_id == user.id))
    if entry is None:
        raise HTTPException(status_code=404, detail="Record not found")
    if entry.module == "reminders" and entry.data and entry.data.get("auto_generated") is True:
        raise HTTPException(
            status_code=409, detail="Automatic reminders can be disabled, not deleted")
    db.delete(entry)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
