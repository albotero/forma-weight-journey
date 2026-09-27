"""Add per-user Telegram connections for reminder delivery.

Revision ID: 0003_telegram_reminders
Revises: 0002_modules_sessions
"""
from alembic import op
import sqlalchemy as sa

revision = "0003_telegram_reminders"
down_revision = "0002_modules_sessions"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if "telegram_connections" not in inspector.get_table_names():
        op.create_table(
            "telegram_connections",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("user_id", sa.Integer(), sa.ForeignKey(
                "users.id", ondelete="CASCADE"), nullable=False, unique=True),
            sa.Column("chat_id", sa.String(length=64),
                      nullable=True, unique=True),
            sa.Column("pairing_token_hash", sa.String(
                length=64), nullable=True, unique=True),
            sa.Column("pairing_expires_at", sa.DateTime(
                timezone=True), nullable=True),
            sa.Column("linked_at", sa.DateTime(timezone=True), nullable=True),
        )
        inspector = sa.inspect(op.get_bind())
    indexes = {index["name"]
               for index in inspector.get_indexes("telegram_connections")}
    if "ix_telegram_connections_user_id" not in indexes:
        op.create_index("ix_telegram_connections_user_id",
                        "telegram_connections", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_telegram_connections_user_id",
                  table_name="telegram_connections")
    op.drop_table("telegram_connections")
