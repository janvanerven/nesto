"""replace documents with sekura

Revision ID: b3c4d5e6f7a8
Revises: a4b5c6d7e8f9
Create Date: 2026-03-23 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b3c4d5e6f7a8'
down_revision: Union[str, Sequence[str], None] = 'a4b5c6d7e8f9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Create sekura_connections table; drop old document tables."""
    op.create_table(
        'sekura_connections',
        sa.Column('id', sa.Text(), nullable=False),
        sa.Column('user_id', sa.Text(), nullable=False),
        sa.Column('encrypted_api_key', sa.Text(), nullable=False),
        sa.Column('key_scope', sa.Text(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('user_id'),
    )
    op.create_index('ix_sekura_connections_user_id', 'sekura_connections', ['user_id'])

    # Drop in dependency order: junction table first, then dependents
    op.drop_table('document_tag_links')
    op.drop_index(op.f('ix_documents_household_id'), table_name='documents')
    op.drop_table('documents')
    op.drop_index(op.f('ix_document_tags_household_id'), table_name='document_tags')
    op.drop_table('document_tags')


def downgrade() -> None:
    """Recreate document tables; drop sekura_connections."""
    op.create_table(
        'document_tags',
        sa.Column('id', sa.Text(), nullable=False),
        sa.Column('household_id', sa.Text(), nullable=False),
        sa.Column('name', sa.Text(), nullable=False),
        sa.Column('category', sa.Text(), nullable=False),
        sa.ForeignKeyConstraint(['household_id'], ['households.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('household_id', 'name', 'category',
                            name='uq_document_tags_household_name_category'),
    )
    op.create_index(op.f('ix_document_tags_household_id'), 'document_tags', ['household_id'])
    op.create_table(
        'documents',
        sa.Column('id', sa.Text(), nullable=False),
        sa.Column('household_id', sa.Text(), nullable=False),
        sa.Column('uploaded_by', sa.Text(), nullable=False),
        sa.Column('filename', sa.Text(), nullable=False),
        sa.Column('storage_path', sa.Text(), nullable=False),
        sa.Column('mime_type', sa.Text(), nullable=False),
        sa.Column('size_bytes', sa.Integer(), nullable=False),
        sa.Column('has_thumbnail', sa.Boolean(), server_default=sa.text('0'), nullable=False),
        sa.Column('created_at', sa.DateTime(), server_default=sa.text('(CURRENT_TIMESTAMP)'),
                  nullable=False),
        sa.ForeignKeyConstraint(['household_id'], ['households.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['uploaded_by'], ['users.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_documents_household_id'), 'documents', ['household_id'])
    op.create_table(
        'document_tag_links',
        sa.Column('document_id', sa.Text(), nullable=False),
        sa.Column('tag_id', sa.Text(), nullable=False),
        sa.ForeignKeyConstraint(['document_id'], ['documents.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['tag_id'], ['document_tags.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('document_id', 'tag_id'),
    )

    op.drop_index('ix_sekura_connections_user_id', table_name='sekura_connections')
    op.drop_table('sekura_connections')
