import hashlib
import hmac
import secrets
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.dependencies import current_user
from app.models import JournalEntry, TelegramConnection, User
from app.telegram import (
    answer_callback_query,
    connection_status,
    handle_telegram_command,
    send_reminder_followup,
    send_telegram_message,
)
from app.routers.common import utc_datetime, utc_now

router = APIRouter()


@router.get("/telegram/connection")
def get_telegram_connection(user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict[str, object]:
    return {
        "configured": bool(settings.telegram_bot_token and settings.telegram_webhook_secret and settings.telegram_bot_username),
        "linked": connection_status(db, user.id),
        "bot_username": settings.telegram_bot_username,
    }


@router.post("/telegram/connection")
def create_telegram_pairing(user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict[str, str]:
    if not (settings.telegram_bot_token and settings.telegram_bot_username and settings.telegram_webhook_secret):
        raise HTTPException(
            status_code=503, detail="Telegram notifications are not configured")
    code = secrets.token_urlsafe(18)
    connection = db.scalar(select(TelegramConnection).where(
        TelegramConnection.user_id == user.id))
    if connection is None:
        connection = TelegramConnection(user_id=user.id)
        db.add(connection)
    connection.chat_id = None
    connection.linked_at = None
    connection.pairing_token_hash = hashlib.sha256(code.encode()).hexdigest()
    connection.pairing_expires_at = utc_now() + timedelta(minutes=15)
    db.commit()
    return {
        "start_url": f"https://t.me/{settings.telegram_bot_username}?start={code}",
        "expires_at": connection.pairing_expires_at.isoformat(),
    }


@router.delete("/telegram/connection", status_code=status.HTTP_204_NO_CONTENT)
def delete_telegram_connection(user: User = Depends(current_user), db: Session = Depends(get_db)) -> Response:
    connection = db.scalar(select(TelegramConnection).where(
        TelegramConnection.user_id == user.id))
    if connection is not None:
        db.delete(connection)
        db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/telegram/webhook")
async def telegram_webhook(request: Request, db: Session = Depends(get_db)) -> dict[str, bool]:
    received_secret = request.headers.get(
        "X-Telegram-Bot-Api-Secret-Token", "")
    if not settings.telegram_webhook_secret or not hmac.compare_digest(received_secret, settings.telegram_webhook_secret):
        raise HTTPException(status_code=403, detail="Invalid webhook secret")
    update = await request.json()
    callback = update.get("callback_query") if isinstance(
        update, dict) else None
    if isinstance(callback, dict):
        callback_id = callback.get("id")
        callback_data = callback.get("data")
        message = callback.get("message")
        callback_chat = message.get(
            "chat") if isinstance(message, dict) else None
        parts = callback_data.split(":") if isinstance(
            callback_data, str) else []
        if (isinstance(callback_id, str) and parts and parts[0] == "dismiss"
                and len(parts) == 2):
            await answer_callback_query(callback_id, "De acuerdo.")
            return {"ok": True}
        if (isinstance(callback_id, str) and parts and parts[0] in {"done", "capture"}
                and (len(parts) == 2 or (parts[0] == "done" and len(parts) == 3))
                and isinstance(callback_chat, dict) and callback_chat.get("type") == "private"):
            try:
                if len(parts) == 2:
                    entry_ids = None
                    occurrence = int(parts[1])
                else:
                    entry_ids = [int(value) for value in parts[1].split(",")]
                    occurrence = int(parts[2])
                chat_id = str(callback_chat["id"])
                if entry_ids is not None and (not entry_ids or len(set(entry_ids)) != len(entry_ids)):
                    raise ValueError
            except (ValueError, KeyError):
                await answer_callback_query(callback_id, "Este botón no es válido.")
                return {"ok": True}
            connection = db.scalar(select(TelegramConnection).where(
                TelegramConnection.chat_id == chat_id))
            if connection is None:
                await answer_callback_query(callback_id, "Este chat no está vinculado a Forma.")
                return {"ok": True}
            reminder_query = select(JournalEntry).where(
                JournalEntry.module == "reminders",
                JournalEntry.user_id == connection.user_id,
            )
            if entry_ids is not None:
                reminder_query = reminder_query.where(
                    JournalEntry.id.in_(entry_ids))
            entries = db.scalars(reminder_query).all()
            if entry_ids is None:
                entries = [entry for entry in entries if (
                    entry.data or {}).get("last_sent_epoch") == occurrence]
            entries_by_id = {entry.id: entry for entry in entries}
            if not entries_by_id or (entry_ids is not None and len(entries_by_id) != len(entry_ids)):
                await answer_callback_query(callback_id, "No se encontró este recordatorio vinculado a tu cuenta.")
                return {"ok": True}
            if parts[0] == "done":
                for entry in entries_by_id.values():
                    data = dict(entry.data or {})
                    if data.get("last_sent_epoch") != occurrence:
                        await answer_callback_query(callback_id, "Este aviso ya venció; revisa el recordatorio más reciente.")
                        return {"ok": True}
                    if data.get("completed_reminder_epoch") != occurrence:
                        data["completed_reminder_epoch"] = occurrence
                        data["completed_at"] = utc_now().isoformat()
                        entry.data = data
                db.commit()
                await answer_callback_query(callback_id, "¡Listo! Recordatorios marcados como cumplidos.")
                await send_reminder_followup(chat_id, occurrence)
            else:
                if any((entry.data or {}).get("completed_reminder_epoch") != occurrence for entry in entries_by_id.values()):
                    await answer_callback_query(callback_id, "Confirma primero que ya resolviste el recordatorio.")
                    return {"ok": True}
                keys = {str((entry.data or {}).get("auto_key"))
                        for entry in entries_by_id.values()}
                examples = []
                if "weight" in keys:
                    examples.append("/peso 82.5")
                if "dose" in keys:
                    examples.append("/dosis 2.5")
                if "blood_pressure" in keys:
                    examples.append("/presion 120/80")
                if "measurements" in keys:
                    examples.append("/cintura 90")
                if "composition" in keys:
                    examples.append(
                        "La composición corporal se registra desde la app.")
                if not examples:
                    examples = ["/peso 82.5", "/dosis 2.5",
                                "/cintura 90", "/presion 120/80"]
                await answer_callback_query(callback_id, "Envíame el dato por este chat.")
                await send_telegram_message(chat_id, "Envíame el dato con el comando correspondiente:\n" + "\n".join(examples))
        return {"ok": True}

    message = update.get("message") if isinstance(update, dict) else None
    if not isinstance(message, dict):
        return {"ok": True}
    chat = message.get("chat")
    text = message.get("text")
    if not isinstance(chat, dict) or chat.get("type") != "private" or not isinstance(chat.get("id"), (str, int)) or not isinstance(text, str):
        return {"ok": True}
    chat_id = str(chat["id"])
    parts = text.strip().split(maxsplit=1)
    if parts and parts[0].split("@", maxsplit=1)[0] == "/start" and len(parts) == 2:
        code_hash = hashlib.sha256(parts[1].encode()).hexdigest()
        connection = db.scalar(select(TelegramConnection).where(
            TelegramConnection.pairing_token_hash == code_hash))
        if connection is None or connection.pairing_expires_at is None or utc_datetime(connection.pairing_expires_at) <= utc_now():
            await send_telegram_message(chat_id, "El enlace expiró o no es válido. Genera un nuevo enlace desde Forma.")
            return {"ok": True}
        occupied = db.scalar(select(TelegramConnection).where(
            TelegramConnection.chat_id == chat_id, TelegramConnection.user_id != connection.user_id))
        if occupied is not None:
            await send_telegram_message(chat_id, "Esta cuenta de Telegram ya está vinculada a otra cuenta de Forma.")
            return {"ok": True}
        connection.chat_id = chat_id
        connection.linked_at = utc_now()
        connection.pairing_token_hash = None
        connection.pairing_expires_at = None
        db.commit()
        await send_telegram_message(chat_id, "Telegram quedó vinculado. Recibirás aquí tus recordatorios activos de Forma.")
        await send_telegram_message(chat_id, "Escribe /ayuda para registrar peso, dosis, cintura, presión arterial, síntomas o crear un recordatorio desde Telegram.")
    else:
        connection = db.scalar(select(TelegramConnection).where(
            TelegramConnection.chat_id == chat_id))
        if connection is None:
            await send_telegram_message(chat_id, "Este chat no está vinculado a Forma. Inicia la vinculación desde la sección Recordatorios de la app.")
        else:
            await handle_telegram_command(db, connection.user_id, chat_id, text)
    return {"ok": True}
