"""Add private Strava connections and durable import tracking."""
from alembic import op
import sqlalchemy as sa

revision = "0016_strava"
down_revision = "0015_body_fat_reference"
branch_labels = None
depends_on = None


def upgrade() -> None:
    tables = sa.inspect(op.get_bind()).get_table_names()
    if "strava_connections" not in tables:
        create_connections()
    if "strava_imports" not in tables:
        create_imports()


def create_connections() -> None:
    op.create_table(
        "strava_connections",
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("client_id", sa.String(32), nullable=False, unique=True),
        sa.Column("client_secret", sa.Text(), nullable=False),
        sa.Column("webhook_key", sa.String(64), nullable=False, unique=True),
        sa.Column("verify_token", sa.String(64), nullable=False),
        sa.Column("subscription_id", sa.BigInteger(), nullable=True),
        sa.Column("athlete_id", sa.BigInteger(), unique=True, nullable=True),
        sa.Column("tokens", sa.Text(), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("state_hash", sa.String(64), unique=True, nullable=True),
        sa.Column("state_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("state_auth_version", sa.Integer(), nullable=True),
        sa.Column("import_history", sa.Boolean(), nullable=False),
        sa.Column("linked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("scan_after", sa.BigInteger(), nullable=False),
        sa.Column("scan_before", sa.BigInteger(), nullable=False),
        sa.Column("scan_page", sa.Integer(), nullable=False),
        sa.Column("next_sync_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("lease_until", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_sync_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error", sa.String(500), nullable=True),
        sa.Column("webhook_error", sa.String(500), nullable=True),
    )


def create_imports() -> None:
    op.create_table(
        "strava_imports",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("strava_connections.user_id", ondelete="CASCADE"), nullable=False),
        sa.Column("activity_id", sa.BigInteger(), nullable=False),
        sa.Column("entry_id", sa.Integer(), sa.ForeignKey("journal_entries.id", ondelete="SET NULL"), nullable=True),
        sa.Column("pending", sa.Boolean(), nullable=False),
        sa.Column("suppressed", sa.Boolean(), nullable=False),
        sa.Column("event_time", sa.BigInteger(), nullable=False),
        sa.Column("generation", sa.Integer(), nullable=False),
        sa.Column("last_error", sa.String(500), nullable=True),
        sa.UniqueConstraint("user_id", "activity_id"),
    )
    op.create_index("ix_strava_imports_user_id", "strava_imports", ["user_id"])


def downgrade() -> None:
    op.drop_table("strava_imports")
    op.drop_table("strava_connections")
