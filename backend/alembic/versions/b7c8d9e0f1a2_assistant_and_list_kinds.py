"""add list kinds, shopping list recipes and household AI settings

Revision ID: b7c8d9e0f1a2
Revises: e3f4a5b6c7d8
Create Date: 2026-10-17 12:00:00.000000
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = 'b7c8d9e0f1a2'
down_revision: Union[str, Sequence[str], None] = 'e3f4a5b6c7d8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('shopping_lists') as batch_op:
        batch_op.add_column(sa.Column('kind', sa.Text(), nullable=False, server_default='other'))

    op.create_table('shopping_list_recipes',
        sa.Column('id', sa.Text(), nullable=False),
        sa.Column('list_id', sa.Text(), nullable=False),
        sa.Column('url', sa.Text(), nullable=False),
        sa.Column('title', sa.Text(), nullable=False),
        sa.Column('created_by', sa.Text(), nullable=False),
        sa.Column('created_at', sa.DateTime(), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
        sa.ForeignKeyConstraint(['list_id'], ['shopping_lists.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['created_by'], ['users.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_shopping_list_recipes_list_id', 'shopping_list_recipes', ['list_id'])

    with op.batch_alter_table('shopping_items') as batch_op:
        batch_op.add_column(sa.Column('recipe_id', sa.Text(), nullable=True))
        batch_op.create_foreign_key(
            'fk_shopping_items_recipe_id', 'shopping_list_recipes', ['recipe_id'], ['id'], ondelete='SET NULL'
        )
        batch_op.create_index('ix_shopping_items_recipe_id', ['recipe_id'])

    op.create_table('household_ai_settings',
        sa.Column('household_id', sa.Text(), nullable=False),
        sa.Column('encrypted_api_key', sa.Text(), nullable=False),
        sa.Column('key_label', sa.Text(), nullable=False, server_default=''),
        sa.Column('model', sa.Text(), nullable=False),
        sa.Column('updated_by', sa.Text(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
        sa.ForeignKeyConstraint(['household_id'], ['households.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['updated_by'], ['users.id']),
        sa.PrimaryKeyConstraint('household_id'),
    )

    op.execute(
        "UPDATE shopping_lists SET kind='groceries' "
        "WHERE lower(name) LIKE '%boodschap%' OR lower(name) LIKE '%grocer%' OR lower(name) LIKE '%supermarkt%' "
        "OR (' ' || lower(name) || ' ') LIKE '% ah %' OR (' ' || lower(name) || ' ') LIKE '% jumbo %' "
        "OR (' ' || lower(name) || ' ') LIKE '% lidl %'"
    )


def downgrade() -> None:
    op.drop_table('household_ai_settings')
    with op.batch_alter_table('shopping_items') as batch_op:
        batch_op.drop_index('ix_shopping_items_recipe_id')
        batch_op.drop_constraint('fk_shopping_items_recipe_id', type_='foreignkey')
        batch_op.drop_column('recipe_id')
    op.drop_index('ix_shopping_list_recipes_list_id', table_name='shopping_list_recipes')
    op.drop_table('shopping_list_recipes')
    with op.batch_alter_table('shopping_lists') as batch_op:
        batch_op.drop_column('kind')
