"""Add catalog items and medication review tracking.

Revision ID: 0004_catalog_and_review
Revises: 0003_telegram_reminders
"""
from alembic import op
import sqlalchemy as sa

revision = "0004_catalog_and_review"
down_revision = "0003_telegram_reminders"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    profile_columns = {column["name"]
                       for column in inspector.get_columns("user_profiles")}
    if "medications_reviewed_at" not in profile_columns:
        op.add_column("user_profiles", sa.Column(
            "medications_reviewed_at", sa.DateTime(timezone=True), nullable=True))
    if "medications_reviewed_signature" not in profile_columns:
        op.add_column("user_profiles", sa.Column(
            "medications_reviewed_signature", sa.String(length=255), nullable=True))

    if "catalog_items" not in inspector.get_table_names():
        op.create_table(
            "catalog_items",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("user_id", sa.Integer(), sa.ForeignKey(
                "users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("category", sa.String(length=16), nullable=False),
            sa.Column("name", sa.String(length=120), nullable=False),
            sa.Column("unit", sa.String(length=40), nullable=True),
            sa.Column("symptom_category", sa.String(length=40), nullable=True),
            sa.Column("is_blood_pressure", sa.Boolean(),
                      nullable=False, server_default=sa.false()),
            sa.Column("created_at", sa.DateTime(timezone=True),
                      server_default=sa.func.now(), nullable=False),
        )
        op.create_index("ix_catalog_items_user_id",
                        "catalog_items", ["user_id"])
        op.create_index("ix_catalog_items_category",
                        "catalog_items", ["category"])


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if "catalog_items" in inspector.get_table_names():
        op.drop_index("ix_catalog_items_category", table_name="catalog_items")
        op.drop_index("ix_catalog_items_user_id", table_name="catalog_items")
        op.drop_table("catalog_items")

    profile_columns = {column["name"]
                       for column in inspector.get_columns("user_profiles")}
    if "medications_reviewed_signature" in profile_columns:
        op.drop_column("user_profiles", "medications_reviewed_signature")
    if "medications_reviewed_at" in profile_columns:
        op.drop_column("user_profiles", "medications_reviewed_at")
