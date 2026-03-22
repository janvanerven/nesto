"""add birthdays table

Revision ID: a4b5c6d7e8f9
Revises: 73c7efc857cf
Create Date: 2026-03-22 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a4b5c6d7e8f9'
down_revision: Union[str, Sequence[str], None] = '73c7efc857cf'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table('birthdays',
    sa.Column('id', sa.Text(), nullable=False),
    sa.Column('household_id', sa.Text(), nullable=False),
    sa.Column('person_name', sa.Text(), nullable=False),
    sa.Column('birth_month', sa.Integer(), nullable=False),
    sa.Column('birth_day', sa.Integer(), nullable=False),
    sa.Column('birth_year', sa.Integer(), nullable=True),
    sa.Column('created_by', sa.Text(), nullable=False),
    sa.Column('created_at', sa.DateTime(), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
    sa.Column('updated_at', sa.DateTime(), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
    sa.ForeignKeyConstraint(['created_by'], ['users.id'], ),
    sa.ForeignKeyConstraint(['household_id'], ['households.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_birthdays_household_id', 'birthdays', ['household_id'])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index('ix_birthdays_household_id', table_name='birthdays')
    op.drop_table('birthdays')
