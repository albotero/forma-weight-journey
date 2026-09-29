"""Add normal range thresholds to catalog items.

Revision ID: 0008_catalog_item_thresholds
Revises: 0007_email_verification
"""
from alembic import op
import sqlalchemy as sa

revision = "0008_catalog_item_thresholds"
down_revision = "0007_email_verification"
branch_labels = None
depends_on = None


def upgrade() -> None:
    columns = {column["name"] for column in sa.inspect(
        op.get_bind()).get_columns("catalog_items")}
    if "normal_min" not in columns:
        op.add_column("catalog_items", sa.Column(
            "normal_min", sa.Float(), nullable=True))
    if "normal_max" not in columns:
        op.add_column("catalog_items", sa.Column(
            "normal_max", sa.Float(), nullable=True))


def downgrade() -> None:
    columns = {column["name"] for column in sa.inspect(
        op.get_bind()).get_columns("catalog_items")}
    if "normal_max" in columns:
        op.drop_column("catalog_items", "normal_max")
    if "normal_min" in columns:
        op.drop_column("catalog_items", "normal_min")
