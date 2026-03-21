"""add index on tasks due_date

Revision ID: e1f2a3b4c5d6
Revises: 3381e2294dac
Create Date: 2026-03-21 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'e1f2a3b4c5d6'
down_revision: Union[str, Sequence[str], None] = 'f0ff3dcaedcd'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add index on tasks.due_date for date-range filtering."""
    op.execute("CREATE INDEX IF NOT EXISTS ix_tasks_due_date ON tasks (due_date)")


def downgrade() -> None:
    """Remove index on tasks.due_date."""
    op.execute("DROP INDEX IF EXISTS ix_tasks_due_date")
