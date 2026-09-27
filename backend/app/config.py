from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore")

    database_url: str = "postgresql+psycopg://tracker:tracker@localhost:5432/tracker"
    secret_key: str = Field(
        default="development-only-change-me-before-deploying-please", min_length=32)
    access_token_minutes: int = 30
    timezone: str = "America/Bogota"
    cors_origins: str = "http://localhost:5173"


settings = Settings()
