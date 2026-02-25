"""add indexes

Revision ID: a1b2c3d4e5f6
Revises: d8f3a1b25c47
Create Date: 2026-02-25 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, Sequence[str], None] = 'd8f3a1b25c47'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add indexes on commonly filtered/joined columns."""
    op.execute("CREATE INDEX IF NOT EXISTS ix_household_members_household_id ON household_members (household_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_household_members_user_id ON household_members (user_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_tasks_household_id ON tasks (household_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_tasks_assigned_to ON tasks (assigned_to)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_tasks_status ON tasks (status)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_events_household_id ON events (household_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_events_assigned_to ON events (assigned_to)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_shopping_lists_household_id ON shopping_lists (household_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_shopping_lists_status ON shopping_lists (status)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_shopping_items_list_id ON shopping_items (list_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_household_invites_household_id ON household_invites (household_id)")


def downgrade() -> None:
    """Remove indexes."""
    op.execute("DROP INDEX IF EXISTS ix_household_invites_household_id")
    op.execute("DROP INDEX IF EXISTS ix_shopping_items_list_id")
    op.execute("DROP INDEX IF EXISTS ix_shopping_lists_status")
    op.execute("DROP INDEX IF EXISTS ix_shopping_lists_household_id")
    op.execute("DROP INDEX IF EXISTS ix_events_assigned_to")
    op.execute("DROP INDEX IF EXISTS ix_events_household_id")
    op.execute("DROP INDEX IF EXISTS ix_tasks_status")
    op.execute("DROP INDEX IF EXISTS ix_tasks_assigned_to")
    op.execute("DROP INDEX IF EXISTS ix_tasks_household_id")
    op.execute("DROP INDEX IF EXISTS ix_household_members_user_id")
    op.execute("DROP INDEX IF EXISTS ix_household_members_household_id")
