"""add calendar sync tables

Revision ID: 3381e2294dac
Revises: 7a8eeee9b28c
Create Date: 2026-03-21 15:59:50.731871

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '3381e2294dac'
down_revision: Union[str, Sequence[str], None] = '7a8eeee9b28c'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table('calendar_connections',
    sa.Column('id', sa.Text(), nullable=False),
    sa.Column('user_id', sa.Text(), nullable=False),
    sa.Column('household_id', sa.Text(), nullable=False),
    sa.Column('name', sa.Text(), nullable=False),
    sa.Column('provider', sa.Text(), nullable=False),
    sa.Column('server_url', sa.Text(), nullable=False),
    sa.Column('calendar_url', sa.Text(), nullable=False),
    sa.Column('username', sa.Text(), nullable=False),
    sa.Column('encrypted_password', sa.Text(), nullable=False),
    sa.Column('color', sa.Text(), nullable=False),
    sa.Column('sync_token', sa.Text(), nullable=True),
    sa.Column('last_synced_at', sa.DateTime(), nullable=True),
    sa.Column('enabled', sa.Boolean(), server_default=sa.text('1'), nullable=False),
    sa.Column('error_count', sa.Integer(), server_default=sa.text('0'), nullable=False),
    sa.Column('last_error', sa.Text(), nullable=True),
    sa.Column('created_at', sa.DateTime(), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
    sa.ForeignKeyConstraint(['household_id'], ['households.id'], ),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_calendar_connections_user_id', 'calendar_connections', ['user_id'])
    op.create_index('ix_calendar_connections_household_id', 'calendar_connections', ['household_id'])

    op.create_table('external_events',
    sa.Column('id', sa.Text(), nullable=False),
    sa.Column('connection_id', sa.Text(), nullable=False),
    sa.Column('caldav_uid', sa.Text(), nullable=False),
    sa.Column('caldav_etag', sa.Text(), nullable=True),
    sa.Column('caldav_href', sa.Text(), nullable=True),
    sa.Column('title', sa.Text(), nullable=False),
    sa.Column('description', sa.Text(), nullable=True),
    sa.Column('start_time', sa.DateTime(), nullable=False),
    sa.Column('end_time', sa.DateTime(), nullable=False),
    sa.Column('all_day', sa.Boolean(), server_default=sa.text('0'), nullable=False),
    sa.Column('location', sa.Text(), nullable=True),
    sa.Column('recurrence_rule', sa.Text(), nullable=True),
    sa.Column('timezone', sa.Text(), nullable=True),
    sa.Column('raw_ical', sa.Text(), nullable=True),
    sa.Column('created_at', sa.DateTime(), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
    sa.Column('updated_at', sa.DateTime(), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
    sa.ForeignKeyConstraint(['connection_id'], ['calendar_connections.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_external_events_connection_id', 'external_events', ['connection_id'])
    op.create_index('ix_external_events_caldav_uid', 'external_events', ['caldav_uid'])

    with op.batch_alter_table('household_members', schema=None) as batch_op:
        batch_op.add_column(sa.Column('feed_token', sa.Text(), nullable=True))
        batch_op.create_unique_constraint('uq_household_members_feed_token', ['feed_token'])


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table('household_members', schema=None) as batch_op:
        batch_op.drop_constraint('uq_household_members_feed_token', type_='unique')
        batch_op.drop_column('feed_token')

    op.drop_index('ix_external_events_caldav_uid', table_name='external_events')
    op.drop_index('ix_external_events_connection_id', table_name='external_events')
    op.drop_table('external_events')
    op.drop_index('ix_calendar_connections_household_id', table_name='calendar_connections')
    op.drop_index('ix_calendar_connections_user_id', table_name='calendar_connections')
    op.drop_table('calendar_connections')
