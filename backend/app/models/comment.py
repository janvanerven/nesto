from datetime import datetime

import sqlalchemy as sa
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class Comment(Base):
    __tablename__ = "comments"

    id: Mapped[str] = mapped_column(sa.Text, primary_key=True)
    entity_type: Mapped[str] = mapped_column(sa.Text, nullable=False)  # "task" or "event"
    entity_id: Mapped[str] = mapped_column(sa.Text, nullable=False)
    author_id: Mapped[str] = mapped_column(sa.Text, sa.ForeignKey("users.id"), nullable=False)
    content: Mapped[str] = mapped_column(sa.Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(sa.DateTime, server_default=sa.text("(CURRENT_TIMESTAMP)"), nullable=False)
