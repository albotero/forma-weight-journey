"""Add a configurable local time for automatic reminders.

Revision ID: 0012_profile_reminder_time
Revises: 0011_medication_dosing_interval
"""
from alembic import op
import sqlalchemy as sa

revision = "0012_profile_reminder_time"
down_revision = "0011_medication_dosing_interval"
branch_labels = None
depends_on = None


def upgrade() -> None:
    columns = {column["name"] for column in sa.inspect(
        op.get_bind()).get_columns("user_profiles")}
    if "reminder_time" not in columns:
        op.add_column("user_profiles", sa.Column(
            "reminder_time", sa.String(length=5), nullable=False, server_default="05:00"))


def downgrade() -> None:
    columns = {column["name"] for column in sa.inspect(
        op.get_bind()).get_columns("user_profiles")}
    if "reminder_time" in columns:
        op.drop_column("user_profiles", "reminder_time")
