"""Add a user-configurable sort order to catalog items.

Revision ID: 0010_catalog_item_sort_order
Revises: 0009_blood_pressure_thresholds
"""
from alembic import op
import sqlalchemy as sa

revision = "0010_catalog_item_sort_order"
down_revision = "0009_blood_pressure_thresholds"
branch_labels = None
depends_on = None


def upgrade() -> None:
    columns = {column["name"] for column in sa.inspect(
        op.get_bind()).get_columns("catalog_items")}
    if "sort_order" not in columns:
        op.add_column("catalog_items", sa.Column(
            "sort_order", sa.Integer(), nullable=False, server_default="0"))

    bind = op.get_bind()
    catalog_items = sa.table(
        "catalog_items",
        sa.column("id", sa.Integer),
        sa.column("user_id", sa.Integer),
        sa.column("category", sa.String),
        sa.column("is_blood_pressure", sa.Boolean),
        sa.column("name", sa.String),
        sa.column("sort_order", sa.Integer),
    )
    rows = bind.execute(sa.select(
        catalog_items.c.id, catalog_items.c.user_id, catalog_items.c.category,
        catalog_items.c.is_blood_pressure, catalog_items.c.name,
    ).order_by(
        catalog_items.c.user_id, catalog_items.c.category,
        catalog_items.c.is_blood_pressure.desc(), catalog_items.c.name,
    )).all()
    counters: dict[tuple[int, str], int] = {}
    for row in rows:
        key = (row.user_id, row.category)
        order = counters.get(key, 0)
        counters[key] = order + 1
        bind.execute(catalog_items.update().where(
            catalog_items.c.id == row.id).values(sort_order=order))


def downgrade() -> None:
    columns = {column["name"] for column in sa.inspect(
        op.get_bind()).get_columns("catalog_items")}
    if "sort_order" in columns:
        op.drop_column("catalog_items", "sort_order")
