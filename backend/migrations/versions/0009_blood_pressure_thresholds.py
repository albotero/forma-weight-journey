"""Add diastolic normal thresholds for blood pressure.

Revision ID: 0009_blood_pressure_thresholds
Revises: 0008_catalog_item_thresholds
"""
from alembic import op
import sqlalchemy as sa

revision = "0009_blood_pressure_thresholds"
down_revision = "0008_catalog_item_thresholds"
branch_labels = None
depends_on = None


def upgrade() -> None:
    columns = {column["name"] for column in sa.inspect(
        op.get_bind()).get_columns("catalog_items")}
    if "diastolic_normal_min" not in columns:
        op.add_column("catalog_items", sa.Column(
            "diastolic_normal_min", sa.Float(), nullable=True))
    if "diastolic_normal_max" not in columns:
        op.add_column("catalog_items", sa.Column(
            "diastolic_normal_max", sa.Float(), nullable=True))


def downgrade() -> None:
    columns = {column["name"] for column in sa.inspect(
        op.get_bind()).get_columns("catalog_items")}
    if "diastolic_normal_max" in columns:
        op.drop_column("catalog_items", "diastolic_normal_max")
    if "diastolic_normal_min" in columns:
        op.drop_column("catalog_items", "diastolic_normal_min")
