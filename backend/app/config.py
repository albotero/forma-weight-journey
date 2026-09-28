from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore")

    database_url: str = "postgresql+psycopg://tracker:tracker@localhost:5432/tracker"
    secret_key: str = Field(
        default="development-only-change-me-before-deploying-please", min_length=32)
    access_token_minutes: int = 30
    refresh_token_days: int = 30
    cookie_secure: bool = True
    cookie_domain: str | None = None
    storage_path: str = "./storage"
    timezone: str = "America/Bogota"
    cors_origins: str = "http://localhost:5173"
    public_app_url: str = ""
    telegram_bot_token: str = ""
    telegram_bot_username: str = ""
    telegram_webhook_secret: str = ""
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_username: str = ""
    smtp_password: str = ""
    smtp_from_email: str = ""
    smtp_use_ssl: bool = False
    password_reset_token_minutes: int = 30
    email_verification_token_hours: int = 24

    @property
    def password_reset_email_configured(self) -> bool:
        return bool(self.smtp_host.strip() and self.smtp_from_email.strip() and self.public_app_url.strip())

    @property
    def smtp_configured(self) -> bool:
        return self.password_reset_email_configured


settings = Settings()
