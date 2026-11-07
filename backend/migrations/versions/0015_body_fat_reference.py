"""Add an optional body-fat reference profile setting.

Revision ID: 0015_body_fat_reference
Revises: 0014_primary_medication
"""
from alembic import op
import sqlalchemy as sa

revision = "0015_body_fat_reference"
down_revision = "0014_primary_medication"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if "user_profiles" not in inspector.get_table_names():
        return
    columns = {column["name"] for column in inspector.get_columns("user_profiles")}
    if "body_fat_reference" not in columns:
        op.add_column("user_profiles", sa.Column("body_fat_reference", sa.String(length=10), nullable=True))


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if "user_profiles" not in inspector.get_table_names():
        return
    columns = {column["name"] for column in inspector.get_columns("user_profiles")}
    if "body_fat_reference" in columns:
        op.drop_column("user_profiles", "body_fat_reference")