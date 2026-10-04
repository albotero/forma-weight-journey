"""Support oral medications and dose units.

Revision ID: 0013_oral_medications
Revises: 0012_profile_reminder_time
"""
from alembic import op
import sqlalchemy as sa

revision = "0013_oral_medications"
down_revision = "0012_profile_reminder_time"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    medication_columns = {
        column["name"]: column
        for column in sa.inspect(bind).get_columns("medications")
    }
    if "route" not in medication_columns:
        op.add_column("medications", sa.Column(
            "route", sa.String(length=16), nullable=False,
            server_default="injectable"))
    with op.batch_alter_table("medications") as batch:
        for column_name in ("concentration_mg", "concentration_volume_ml"):
            if column_name in medication_columns:
                batch.alter_column(
                    column_name, existing_type=sa.Float(), nullable=True)

    dose_columns = {
        column["name"]: column
        for column in sa.inspect(bind).get_columns("doses")
    }
    if "dose_amount" not in dose_columns:
        op.add_column("doses", sa.Column(
            "dose_amount", sa.Float(), nullable=True))
    if "dose_unit" not in dose_columns:
        op.add_column("doses", sa.Column(
            "dose_unit", sa.String(length=20), nullable=False,
            server_default="mg"))
    op.execute(sa.text(
        "UPDATE doses SET dose_amount = dose_mg WHERE dose_amount IS NULL"))
    with op.batch_alter_table("doses") as batch:
        batch.alter_column(
            "dose_amount", existing_type=sa.Float(), nullable=False)
        batch.alter_column("dose_mg", existing_type=sa.Float(), nullable=True)
        batch.alter_column(
            "calculated_volume_ml", existing_type=sa.Float(), nullable=True)


def downgrade() -> None:
    bind = op.get_bind()
    if "oral" in set(bind.execute(sa.text(
            "SELECT DISTINCT route FROM medications")).scalars()):
        raise RuntimeError("Cannot downgrade while oral medications exist")
    if bind.execute(sa.text(
            "SELECT 1 FROM doses WHERE dose_mg IS NULL LIMIT 1")).first():
        raise RuntimeError("Cannot downgrade while non-mg dose entries exist")
    with op.batch_alter_table("doses") as batch:
        batch.alter_column("dose_mg", existing_type=sa.Float(), nullable=False)
        batch.alter_column(
            "calculated_volume_ml", existing_type=sa.Float(), nullable=False)
        batch.drop_column("dose_unit")
        batch.drop_column("dose_amount")
    with op.batch_alter_table("medications") as batch:
        batch.alter_column(
            "concentration_mg", existing_type=sa.Float(), nullable=False)
        batch.alter_column(
            "concentration_volume_ml", existing_type=sa.Float(), nullable=False)
        batch.drop_column("route")
