"""add loyalty_cards table

Revision ID: 7a8eeee9b28c
Revises: b2c3d4e5f6a7
Create Date: 2026-03-12 21:05:54.024809

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '7a8eeee9b28c'
down_revision: Union[str, Sequence[str], None] = 'b2c3d4e5f6a7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table('loyalty_cards',
    sa.Column('id', sa.Text(), nullable=False),
    sa.Column('household_id', sa.Text(), nullable=False),
    sa.Column('store_name', sa.Text(), nullable=False),
    sa.Column('barcode_number', sa.Text(), nullable=False),
    sa.Column('barcode_format', sa.Text(), nullable=False),
    sa.Column('color', sa.Text(), nullable=False),
    sa.Column('created_by', sa.Text(), nullable=False),
    sa.Column('created_at', sa.DateTime(), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
    sa.Column('updated_at', sa.DateTime(), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
    sa.ForeignKeyConstraint(['created_by'], ['users.id'], ),
    sa.ForeignKeyConstraint(['household_id'], ['households.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_loyalty_cards_household_id', 'loyalty_cards', ['household_id'])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index('ix_loyalty_cards_household_id', table_name='loyalty_cards')
    op.drop_table('loyalty_cards')
