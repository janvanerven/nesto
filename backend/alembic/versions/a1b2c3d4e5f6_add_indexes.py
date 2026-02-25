"""add indexes

Revision ID: a1b2c3d4e5f6
Revises: d8f3a1b25c47
Create Date: 2026-02-25 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, Sequence[str], None] = 'd8f3a1b25c47'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add indexes on commonly filtered/joined columns."""
    with op.batch_alter_table('household_members') as batch_op:
        batch_op.create_index('ix_household_members_household_id', ['household_id'])
        batch_op.create_index('ix_household_members_user_id', ['user_id'])

    with op.batch_alter_table('tasks') as batch_op:
        batch_op.create_index('ix_tasks_household_id', ['household_id'])
        batch_op.create_index('ix_tasks_assigned_to', ['assigned_to'])
        batch_op.create_index('ix_tasks_status', ['status'])

    with op.batch_alter_table('events') as batch_op:
        batch_op.create_index('ix_events_household_id', ['household_id'])
        batch_op.create_index('ix_events_assigned_to', ['assigned_to'])

    with op.batch_alter_table('shopping_lists') as batch_op:
        batch_op.create_index('ix_shopping_lists_household_id', ['household_id'])
        batch_op.create_index('ix_shopping_lists_status', ['status'])

    with op.batch_alter_table('shopping_items') as batch_op:
        batch_op.create_index('ix_shopping_items_list_id', ['list_id'])

    with op.batch_alter_table('household_invites') as batch_op:
        batch_op.create_index('ix_household_invites_household_id', ['household_id'])
        batch_op.create_index('ix_household_invites_code', ['code'])


def downgrade() -> None:
    """Remove indexes."""
    with op.batch_alter_table('household_invites') as batch_op:
        batch_op.drop_index('ix_household_invites_code')
        batch_op.drop_index('ix_household_invites_household_id')

    with op.batch_alter_table('shopping_items') as batch_op:
        batch_op.drop_index('ix_shopping_items_list_id')

    with op.batch_alter_table('shopping_lists') as batch_op:
        batch_op.drop_index('ix_shopping_lists_status')
        batch_op.drop_index('ix_shopping_lists_household_id')

    with op.batch_alter_table('events') as batch_op:
        batch_op.drop_index('ix_events_assigned_to')
        batch_op.drop_index('ix_events_household_id')

    with op.batch_alter_table('tasks') as batch_op:
        batch_op.drop_index('ix_tasks_status')
        batch_op.drop_index('ix_tasks_assigned_to')
        batch_op.drop_index('ix_tasks_household_id')

    with op.batch_alter_table('household_members') as batch_op:
        batch_op.drop_index('ix_household_members_user_id')
        batch_op.drop_index('ix_household_members_household_id')
