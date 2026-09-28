"""Add single-use password reset tokens.

Revision ID: 0005_password_reset_tokens
Revises: 0004_catalog_and_review
"""
from alembic import op
import sqlalchemy as sa

revision = "0005_password_reset_tokens"
down_revision = "0004_catalog_and_review"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if "password_reset_tokens" not in sa.inspect(op.get_bind()).get_table_names():
        op.create_table(
            "password_reset_tokens",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("user_id", sa.Integer(), sa.ForeignKey(
                "users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("token_hash", sa.String(length=64), nullable=False),
            sa.Column("expires_at", sa.DateTime(
                timezone=True), nullable=False),
            sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True),
                      server_default=sa.func.now(), nullable=False),
        )
        op.create_index("ix_password_reset_tokens_user_id",
                        "password_reset_tokens", ["user_id"])
        op.create_index("ix_password_reset_tokens_token_hash",
                        "password_reset_tokens", ["token_hash"], unique=True)
        op.create_index("ix_password_reset_tokens_expires_at",
                        "password_reset_tokens", ["expires_at"])


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if "password_reset_tokens" in inspector.get_table_names():
        indexes = {item["name"]
                   for item in inspector.get_indexes("password_reset_tokens")}
        for name in ("ix_password_reset_tokens_expires_at", "ix_password_reset_tokens_token_hash", "ix_password_reset_tokens_user_id"):
            if name in indexes:
                op.drop_index(name, table_name="password_reset_tokens")
        op.drop_table("password_reset_tokens")
