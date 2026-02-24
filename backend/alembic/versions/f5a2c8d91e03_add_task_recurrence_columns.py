"""add task recurrence columns

Revision ID: f5a2c8d91e03
Revises: e3001a6b3d0b
Create Date: 2026-02-24 20:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f5a2c8d91e03'
down_revision: Union[str, Sequence[str], None] = 'e3001a6b3d0b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add recurrence columns to tasks table."""
    op.add_column('tasks', sa.Column('recurrence_rule', sa.Text(), nullable=True))
    op.add_column('tasks', sa.Column('recurrence_interval', sa.Integer(), nullable=False, server_default='1'))
    op.add_column('tasks', sa.Column('recurrence_end', sa.Date(), nullable=True))
    op.add_column('tasks', sa.Column('last_completed_at', sa.DateTime(), nullable=True))


def downgrade() -> None:
    """Remove recurrence columns from tasks table."""
    op.drop_column('tasks', 'last_completed_at')
    op.drop_column('tasks', 'recurrence_end')
    op.drop_column('tasks', 'recurrence_interval')
    op.drop_column('tasks', 'recurrence_rule')
