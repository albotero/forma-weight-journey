"""Queue existing Strava sessions for metric enrichment."""
from alembic import op
import sqlalchemy as sa

revision = "0018_strava_session_metrics"
down_revision = "0017_strava_missing_calories"
branch_labels = None
depends_on = None


def upgrade() -> None:
    imports = sa.table(
        "strava_imports",
        sa.column("entry_id", sa.Integer),
        sa.column("suppressed", sa.Boolean),
        sa.column("pending", sa.Boolean),
    )
    op.execute(imports.update().where(
        imports.c.entry_id.is_not(None), imports.c.suppressed.is_(False),
    ).values(pending=True))


def downgrade() -> None:
    pass