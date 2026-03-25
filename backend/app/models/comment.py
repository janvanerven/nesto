from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class Comment(Base):
    __tablename__ = "comments"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    entity_type: Mapped[str] = mapped_column(Text, nullable=False)  # "task" or "event"
    entity_id: Mapped[str] = mapped_column(Text, nullable=False)
    author_id: Mapped[str] = mapped_column(Text, ForeignKey("users.id"), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)
