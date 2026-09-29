from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect, text

from app.config import settings


def test_fresh_database_upgrades_through_all_revisions(tmp_path, monkeypatch) -> None:
    database = tmp_path / "fresh.sqlite"
    monkeypatch.setattr(settings, "database_url", f"sqlite:///{database}")
    backend_dir = Path(__file__).resolve().parents[1]
    config = Config(str(backend_dir / "alembic.ini"))
    config.set_main_option("script_location", str(backend_dir / "migrations"))

    command.upgrade(config, "0006_user_auth_version")

    engine = create_engine(f"sqlite:///{database}")
    try:
        with engine.begin() as connection:
            connection.execute(text(
                "INSERT INTO users (email, password_hash) VALUES (:email, :password_hash)"),
                {"email": "legacy@example.com", "password_hash": "test-hash"},
            )
    finally:
        engine.dispose()

    command.upgrade(config, "head")

    engine = create_engine(f"sqlite:///{database}")
    try:
        inspector = inspect(engine)
        assert "telegram_connections" in inspector.get_table_names()
        assert "password_reset_tokens" in inspector.get_table_names()
        assert "email_verification_tokens" in inspector.get_table_names()
        verification_columns = {column["name"] for column in inspector.get_columns(
            "email_verification_tokens")}
        assert {"user_id", "email", "purpose", "token_hash",
                "expires_at", "used_at"} <= verification_columns
        reset_columns = {column["name"]
                         for column in inspector.get_columns("password_reset_tokens")}
        assert {"user_id", "token_hash",
                "expires_at", "used_at"} <= reset_columns
        user_columns = {column["name"]
                        for column in inspector.get_columns("users")}
        assert {"auth_version", "email_verified_at",
                "pending_email"} <= user_columns
        with engine.connect() as connection:
            legacy = connection.execute(text(
                "SELECT email_verified_at FROM users WHERE email = :email"),
                {"email": "legacy@example.com"},
            ).scalar_one()
        assert legacy is not None
        columns = {column["name"]
                   for column in inspector.get_columns("telegram_connections")}
        assert {"user_id", "chat_id", "pairing_token_hash",
                "pairing_expires_at", "linked_at"} <= columns
        catalog_columns = {column["name"]
                           for column in inspector.get_columns("catalog_items")}
        assert {"normal_min", "normal_max", "diastolic_normal_min",
                "diastolic_normal_max", "sort_order"} <= catalog_columns
    finally:
        engine.dispose()
