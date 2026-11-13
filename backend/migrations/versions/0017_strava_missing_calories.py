"""Treat zero calories from Strava as unavailable, preserving manual values."""
from alembic import op
import sqlalchemy as sa

revision = "0017_strava_missing_calories"
down_revision = "0016_strava"
branch_labels = None
depends_on = None


def upgrade() -> None:
    entries = sa.table("journal_entries", sa.column("id", sa.Integer), sa.column("data", sa.JSON))
    connection = op.get_bind()
    rows = connection.execute(sa.select(entries.c.id, entries.c.data).where(
        entries.c.data["source"].as_string() == "strava",
        entries.c.data["calories_kcal"].as_float() == 0,
    )).all()
    for entry_id, data in rows:
        connection.execute(entries.update().where(entries.c.id == entry_id).values(
            data={**data, "calories_kcal": None},
        ))


def downgrade() -> None:
    # Missing values cannot safely be distinguished from repaired provider zeros.
    pass
