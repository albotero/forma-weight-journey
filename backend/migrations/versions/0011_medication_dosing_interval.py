"""Add optional dosing interval to medications.

Revision ID: 0011_medication_dosing_interval
Revises: 0010_catalog_item_sort_order
"""
from alembic import op
import sqlalchemy as sa

revision = "0011_medication_dosing_interval"
down_revision = "0010_catalog_item_sort_order"
branch_labels = None
depends_on = None


def upgrade() -> None:
    columns = {column["name"] for column in sa.inspect(
        op.get_bind()).get_columns("medications")}
    if "dosing_interval" not in columns:
        op.add_column("medications", sa.Column(
            "dosing_interval", sa.String(length=10), nullable=True))


def downgrade() -> None:
    columns = {column["name"] for column in sa.inspect(
        op.get_bind()).get_columns("medications")}
    if "dosing_interval" in columns:
        op.drop_column("medications", "dosing_interval")
