from email.message import EmailMessage
from email.utils import format_datetime, make_msgid
import logging
import smtplib
import ssl
from datetime import datetime, timezone
from urllib.parse import quote

from app.config import settings

logger = logging.getLogger(__name__)


def send_password_reset_email(recipient: str, token: str) -> None:
    reset_link = f"{settings.public_app_url.rstrip('/')}/#reset?token={quote(token, safe='')}"
    message = EmailMessage()
    message["Subject"] = "Restablece tu contraseña de Forma"
    message["From"] = settings.smtp_from_email
    message["To"] = recipient
    message["Date"] = format_datetime(datetime.now(timezone.utc), usegmt=True)
    message["Message-ID"] = make_msgid()
    message.set_content(
        "Se solicitó restablecer la contraseña de tu cuenta de Forma.\n\n"
        f"Abre este enlace en los próximos {settings.password_reset_token_minutes} minutos:\n"
        f"{reset_link}\n\n"
        "El enlace se puede usar una sola vez. Si no solicitaste el cambio, ignora este correo."
    )

    try:
        if settings.smtp_use_ssl:
            connection = smtplib.SMTP_SSL(
                settings.smtp_host, settings.smtp_port, timeout=10,
                context=ssl.create_default_context(),
            )
        else:
            connection = smtplib.SMTP(
                settings.smtp_host, settings.smtp_port, timeout=10)
        with connection as server:
            if not settings.smtp_use_ssl:
                server.starttls(context=ssl.create_default_context())
            if settings.smtp_username:
                server.login(settings.smtp_username, settings.smtp_password)
            server.send_message(message)
    except Exception:
        logger.warning("Password reset email delivery failed")
