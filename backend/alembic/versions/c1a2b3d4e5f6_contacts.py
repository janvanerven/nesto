"""add people and contact addresses; move birthdays onto people

Revision ID: c1a2b3d4e5f6
Revises: b7c8d9e0f1a2
Create Date: 2026-10-18 12:00:00.000000
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = 'c1a2b3d4e5f6'
down_revision: Union[str, Sequence[str], None] = 'b7c8d9e0f1a2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _text(name: str) -> sa.Column:
    return sa.Column(name, sa.Text(), nullable=False, server_default='')


def _timestamps() -> list[sa.Column]:
    return [
        sa.Column('created_at', sa.DateTime(), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
        sa.Column('updated_at', sa.DateTime(), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
    ]


def upgrade() -> None:
    op.create_table('contact_addresses',
        sa.Column('id', sa.Text(), nullable=False),
        sa.Column('household_id', sa.Text(), nullable=False),
        sa.Column('label', sa.Text(), nullable=False),
        _text('street'), _text('postcode'), _text('city'), _text('country'), _text('notes'),
        sa.Column('created_by', sa.Text(), nullable=False),
        *_timestamps(),
        sa.ForeignKeyConstraint(['household_id'], ['households.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['created_by'], ['users.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_contact_addresses_household_id', 'contact_addresses', ['household_id'])

    op.create_table('people',
        sa.Column('id', sa.Text(), nullable=False),
        sa.Column('household_id', sa.Text(), nullable=False),
        sa.Column('address_id', sa.Text(), nullable=True),
        sa.Column('name', sa.Text(), nullable=False),
        sa.Column('birth_month', sa.Integer(), nullable=True),
        sa.Column('birth_day', sa.Integer(), nullable=True),
        sa.Column('birth_year', sa.Integer(), nullable=True),
        _text('phone'), _text('email'), _text('notes'),
        sa.Column('created_by', sa.Text(), nullable=False),
        *_timestamps(),
        sa.ForeignKeyConstraint(['household_id'], ['households.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['address_id'], ['contact_addresses.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['created_by'], ['users.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_people_household_id', 'people', ['household_id'])
    op.create_index('ix_people_address_id', 'people', ['address_id'])

    # Keep ids so birthday feed UIDs (birthday-{id}@nesto) stay stable.
    op.execute(
        "INSERT INTO people (id, household_id, name, birth_month, birth_day, birth_year, "
        "created_by, created_at, updated_at) "
        "SELECT id, household_id, person_name, birth_month, birth_day, birth_year, "
        "created_by, created_at, updated_at FROM birthdays"
    )
    op.drop_index('ix_birthdays_household_id', table_name='birthdays')
    op.drop_table('birthdays')


def downgrade() -> None:
    op.create_table('birthdays',
        sa.Column('id', sa.Text(), nullable=False),
        sa.Column('household_id', sa.Text(), nullable=False),
        sa.Column('person_name', sa.Text(), nullable=False),
        sa.Column('birth_month', sa.Integer(), nullable=False),
        sa.Column('birth_day', sa.Integer(), nullable=False),
        sa.Column('birth_year', sa.Integer(), nullable=True),
        sa.Column('created_by', sa.Text(), nullable=False),
        *_timestamps(),
        sa.ForeignKeyConstraint(['created_by'], ['users.id'], ),
        sa.ForeignKeyConstraint(['household_id'], ['households.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_birthdays_household_id', 'birthdays', ['household_id'])
    op.execute(
        "INSERT INTO birthdays (id, household_id, person_name, birth_month, birth_day, birth_year, "
        "created_by, created_at, updated_at) "
        "SELECT id, household_id, name, birth_month, birth_day, birth_year, "
        "created_by, created_at, updated_at FROM people "
        "WHERE birth_month IS NOT NULL AND birth_day IS NOT NULL"
    )
    op.drop_index('ix_people_address_id', table_name='people')
    op.drop_index('ix_people_household_id', table_name='people')
    op.drop_table('people')
    op.drop_index('ix_contact_addresses_household_id', table_name='contact_addresses')
    op.drop_table('contact_addresses')
