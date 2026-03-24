"""add reminders_sent and household_notices tables

Revision ID: c1d2e3f4a5b6
Revises: b3c4d5e6f7a8
Create Date: 2026-03-24 12:00:00.000000
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = 'c1d2e3f4a5b6'
down_revision: Union[str, Sequence[str], None] = 'b3c4d5e6f7a8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # reminders_sent — deduplication table for email/push reminders
    op.create_table('reminders_sent',
        sa.Column('id', sa.Text(), nullable=False),
        sa.Column('entity_type', sa.Text(), nullable=False),   # "task" or "event"
        sa.Column('entity_id', sa.Text(), nullable=False),
        sa.Column('occurrence_date', sa.Date(), nullable=False),
        sa.Column('channel', sa.Text(), nullable=False, server_default='email'),
        sa.Column('sent_at', sa.DateTime(), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('entity_type', 'entity_id', 'occurrence_date', 'channel',
                            name='uq_reminders_sent_dedup'),
    )
    op.create_index('ix_reminders_sent_entity', 'reminders_sent', ['entity_type', 'entity_id'])
    op.create_index('ix_reminders_sent_sent_at', 'reminders_sent', ['sent_at'])

    # household_notices — the notice board
    op.create_table('household_notices',
        sa.Column('id', sa.Text(), nullable=False),
        sa.Column('household_id', sa.Text(), nullable=False),
        sa.Column('author_id', sa.Text(), nullable=False),
        sa.Column('content', sa.Text(), nullable=False),
        sa.Column('pinned', sa.Boolean(), nullable=False, server_default='0'),
        sa.Column('created_at', sa.DateTime(), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['household_id'], ['households.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['author_id'], ['users.id'], ),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_household_notices_household_id', 'household_notices', ['household_id'])

    # users: add reminder preference columns
    op.add_column('users', sa.Column('reminders_tasks', sa.Boolean(), nullable=False, server_default='1'))
    op.add_column('users', sa.Column('reminders_events', sa.Boolean(), nullable=False, server_default='1'))

    # households: add timezone column (IANA tz string, e.g. "Europe/Amsterdam")
    op.add_column('households', sa.Column('timezone', sa.Text(), nullable=False, server_default='UTC'))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('households', 'timezone')
    op.drop_column('users', 'reminders_events')
    op.drop_column('users', 'reminders_tasks')
    op.drop_index('ix_household_notices_household_id', table_name='household_notices')
    op.drop_table('household_notices')
    op.drop_index('ix_reminders_sent_sent_at', table_name='reminders_sent')
    op.drop_index('ix_reminders_sent_entity', table_name='reminders_sent')
    op.drop_table('reminders_sent')
