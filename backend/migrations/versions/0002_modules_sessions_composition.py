"""Add composition, module entries, photos, and persistent sessions.

Revision ID: 0002_modules_sessions
Revises: 0001_initial
"""
from alembic import op
import sqlalchemy as sa

revision = "0002_modules_sessions"
down_revision = "0001_initial"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    tables = set(inspector.get_table_names())
    weight_columns = {column["name"]
                      for column in inspector.get_columns("weight_measurements")}

    for name, column_type in (
        ("body_fat_percent", sa.Float()),
        ("fat_free_mass_kg", sa.Float()),
        ("subcutaneous_fat_percent", sa.Float()),
        ("visceral_fat_index", sa.Float()),
        ("body_water_percent", sa.Float()),
        ("skeletal_muscle_percent", sa.Float()),
        ("muscle_mass_kg", sa.Float()),
        ("bone_mass_kg", sa.Float()),
        ("protein_percent", sa.Float()),
        ("bmr_kcal", sa.Float()),
        ("metabolic_age", sa.Integer()),
    ):
        if name not in weight_columns:
            op.add_column("weight_measurements", sa.Column(
                name, column_type, nullable=True))

    if "journal_entries" not in tables:
        op.create_table(
            "journal_entries",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("user_id", sa.Integer(), sa.ForeignKey(
                "users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("module", sa.String(length=32), nullable=False),
            sa.Column("occurred_at", sa.DateTime(
                timezone=True), nullable=False),
            sa.Column("title", sa.String(length=160), nullable=False),
            sa.Column("data", sa.JSON(), nullable=False),
            sa.Column("notes", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True),
                      server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True),
                      server_default=sa.func.now(), nullable=False),
        )
        op.create_index("ix_journal_entries_user_id",
                        "journal_entries", ["user_id"])
        op.create_index("ix_journal_entries_module",
                        "journal_entries", ["module"])
        op.create_index("ix_journal_entries_occurred_at",
                        "journal_entries", ["occurred_at"])

    if "photo_records" not in tables:
        op.create_table(
            "photo_records",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("user_id", sa.Integer(), sa.ForeignKey(
                "users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("file_key", sa.String(length=80),
                      nullable=False, unique=True),
            sa.Column("content_type", sa.String(length=80), nullable=False),
            sa.Column("caption", sa.String(length=300), nullable=True),
            sa.Column("taken_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True),
                      server_default=sa.func.now(), nullable=False),
        )
        op.create_index("ix_photo_records_user_id",
                        "photo_records", ["user_id"])
        op.create_index("ix_photo_records_taken_at",
                        "photo_records", ["taken_at"])

    if "refresh_sessions" not in tables:
        op.create_table(
            "refresh_sessions",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("user_id", sa.Integer(), sa.ForeignKey(
                "users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("token_hash", sa.String(length=64),
                      nullable=False, unique=True),
            sa.Column("expires_at", sa.DateTime(
                timezone=True), nullable=False),
            sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True),
                      server_default=sa.func.now(), nullable=False),
        )
        op.create_index("ix_refresh_sessions_user_id",
                        "refresh_sessions", ["user_id"])
        op.create_index("ix_refresh_sessions_token_hash",
                        "refresh_sessions", ["token_hash"])
        op.create_index("ix_refresh_sessions_expires_at",
                        "refresh_sessions", ["expires_at"])


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    tables = set(inspector.get_table_names())
    for table in ("refresh_sessions", "photo_records", "journal_entries"):
        if table in tables:
            op.drop_table(table)

    weight_columns = {column["name"] for column in sa.inspect(
        op.get_bind()).get_columns("weight_measurements")}
    for name in (
        "metabolic_age", "bmr_kcal", "protein_percent", "bone_mass_kg", "muscle_mass_kg",
        "skeletal_muscle_percent", "body_water_percent", "visceral_fat_index",
        "subcutaneous_fat_percent", "fat_free_mass_kg", "body_fat_percent",
    ):
        if name in weight_columns:
            op.drop_column("weight_measurements", name)
