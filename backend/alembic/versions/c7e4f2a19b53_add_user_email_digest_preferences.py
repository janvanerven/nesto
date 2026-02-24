"""add user email digest preferences

Revision ID: c7e4f2a19b53
Revises: 809d2c20b8de
Create Date: 2026-02-24 22:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c7e4f2a19b53'
down_revision: Union[str, Sequence[str], None] = '809d2c20b8de'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('users', sa.Column('email_digest_daily', sa.Boolean(), nullable=False, server_default='0'))
    op.add_column('users', sa.Column('email_digest_weekly', sa.Boolean(), nullable=False, server_default='0'))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('users', 'email_digest_weekly')
    op.drop_column('users', 'email_digest_daily')
