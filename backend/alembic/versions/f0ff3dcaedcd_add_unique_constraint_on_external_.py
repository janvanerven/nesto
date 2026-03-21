"""add unique constraint on external_events connection_uid

Revision ID: f0ff3dcaedcd
Revises: 3381e2294dac
Create Date: 2026-03-21 16:20:56.872774

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f0ff3dcaedcd'
down_revision: Union[str, Sequence[str], None] = '3381e2294dac'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table('external_events', schema=None) as batch_op:
        batch_op.create_unique_constraint('uq_external_events_connection_uid', ['connection_id', 'caldav_uid'])


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table('external_events', schema=None) as batch_op:
        batch_op.drop_constraint('uq_external_events_connection_uid', type_='unique')
