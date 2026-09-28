"""Require verified account email addresses.

Revision ID: 0007_email_verification
Revises: 0006_user_auth_version
"""
from alembic import op
import sqlalchemy as sa

revision = "0007_email_verification"
down_revision = "0006_user_auth_version"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    columns = {column["name"] for column in inspector.get_columns("users")}
    if "pending_email" not in columns:
        op.add_column("users", sa.Column(
            "pending_email", sa.String(length=320), nullable=True))
    if "email_verified_at" not in columns:
        op.add_column("users", sa.Column(
            "email_verified_at", sa.DateTime(timezone=True), nullable=True))
    op.execute(sa.text(
        "UPDATE users SET email_verified_at = created_at WHERE email_verified_at IS NULL"))

    if "email_verification_tokens" not in inspector.get_table_names():
        op.create_table(
            "email_verification_tokens",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("user_id", sa.Integer(), sa.ForeignKey(
                "users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("email", sa.String(length=320), nullable=False),
            sa.Column("purpose", sa.String(length=24), nullable=False),
            sa.Column("token_hash", sa.String(length=64), nullable=False),
            sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True),
                      server_default=sa.func.now(), nullable=False),
        )
        op.create_index("ix_email_verification_tokens_user_id",
                        "email_verification_tokens", ["user_id"])
        op.create_index("ix_email_verification_tokens_token_hash",
                        "email_verification_tokens", ["token_hash"], unique=True)
        op.create_index("ix_email_verification_tokens_expires_at",
                        "email_verification_tokens", ["expires_at"])


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    tables = set(inspector.get_table_names())
    if "email_verification_tokens" in tables:
        indexes = {item["name"] for item in inspector.get_indexes(
            "email_verification_tokens")}
        for name in ("ix_email_verification_tokens_expires_at", "ix_email_verification_tokens_token_hash", "ix_email_verification_tokens_user_id"):
            if name in indexes:
                op.drop_index(name, table_name="email_verification_tokens")
        op.drop_table("email_verification_tokens")

    columns = {column["name"] for column in sa.inspect(
        op.get_bind()).get_columns("users")}
    if "email_verified_at" in columns:
        op.drop_column("users", "email_verified_at")
    if "pending_email" in columns:
        op.drop_column("users", "pending_email")