"""add shopping item added_by

Revision ID: d8f3a1b25c47
Revises: c7e4f2a19b53
Create Date: 2026-02-24 23:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd8f3a1b25c47'
down_revision: Union[str, Sequence[str], None] = 'c7e4f2a19b53'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table('shopping_items') as batch_op:
        batch_op.add_column(sa.Column('added_by', sa.Text(), nullable=True))
        batch_op.create_foreign_key('fk_shopping_items_added_by', 'users', ['added_by'], ['id'])


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table('shopping_items') as batch_op:
        batch_op.drop_constraint('fk_shopping_items_added_by', type_='foreignkey')
        batch_op.drop_column('added_by')
