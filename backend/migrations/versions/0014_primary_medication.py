"""Add a primary medication per account.

Revision ID: 0014_primary_medication
Revises: 0013_oral_medications
"""
from alembic import op
import sqlalchemy as sa

revision = "0014_primary_medication"
down_revision = "0013_oral_medications"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    columns = {column["name"]
               for column in sa.inspect(bind).get_columns("medications")}
    if "is_primary" not in columns:
        op.add_column("medications", sa.Column(
            "is_primary", sa.Boolean(), nullable=False, server_default=sa.false()))

    rows = bind.execute(sa.text(
        "SELECT user_id, id FROM medications WHERE active = true "
        "ORDER BY user_id, created_at DESC, id DESC"
    )).all()
    selected_users: set[int] = set()
    for user_id, medication_id in rows:
        if user_id in selected_users:
            continue
        bind.execute(sa.text(
            "UPDATE medications SET is_primary = true WHERE id = :id"),
            {"id": medication_id},
        )
        selected_users.add(user_id)


def downgrade() -> None:
    columns = {column["name"] for column in sa.inspect(
        op.get_bind()).get_columns("medications")}
    if "is_primary" in columns:
        op.drop_column("medications", "is_primary")
