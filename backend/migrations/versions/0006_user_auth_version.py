"""Add user authentication version for immediate token revocation.

Revision ID: 0006_user_auth_version
Revises: 0005_password_reset_tokens
"""
from alembic import op
import sqlalchemy as sa

revision = "0006_user_auth_version"
down_revision = "0005_password_reset_tokens"
branch_labels = None
depends_on = None


def upgrade() -> None:
    columns = {column["name"] for column in sa.inspect(
        op.get_bind()).get_columns("users")}
    if "auth_version" not in columns:
        op.add_column("users", sa.Column(
            "auth_version", sa.Integer(), nullable=False, server_default="0"))


def downgrade() -> None:
    columns = {column["name"] for column in sa.inspect(
        op.get_bind()).get_columns("users")}
    if "auth_version" in columns:
        op.drop_column("users", "auth_version")
