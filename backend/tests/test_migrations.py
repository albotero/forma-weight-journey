from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect

from app.config import settings


def test_fresh_database_upgrades_through_all_revisions(tmp_path, monkeypatch) -> None:
    database = tmp_path / "fresh.sqlite"
    monkeypatch.setattr(settings, "database_url", f"sqlite:///{database}")
    backend_dir = Path(__file__).resolve().parents[1]
    config = Config(str(backend_dir / "alembic.ini"))
    config.set_main_option("script_location", str(backend_dir / "migrations"))

    command.upgrade(config, "head")

    engine = create_engine(f"sqlite:///{database}")
    try:
        inspector = inspect(engine)
        assert "telegram_connections" in inspector.get_table_names()
        assert "password_reset_tokens" in inspector.get_table_names()
        reset_columns = {column["name"]
                         for column in inspector.get_columns("password_reset_tokens")}
        assert {"user_id", "token_hash",
                "expires_at", "used_at"} <= reset_columns
        user_columns = {column["name"]
                        for column in inspector.get_columns("users")}
        assert "auth_version" in user_columns
        columns = {column["name"]
                   for column in inspector.get_columns("telegram_connections")}
        assert {"user_id", "chat_id", "pairing_token_hash",
                "pairing_expires_at", "linked_at"} <= columns
    finally:
        engine.dispose()
