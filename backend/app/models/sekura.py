from datetime import datetime, timezone

from sqlalchemy import Column, DateTime, ForeignKey, Index, Text

from app.database import Base


class SekuraConnection(Base):
    __tablename__ = "sekura_connections"

    id = Column(Text, primary_key=True)
    user_id = Column(Text, ForeignKey("users.id"), nullable=False, unique=True)
    encrypted_api_key = Column(Text, nullable=False)
    key_scope = Column(Text, nullable=False, default="readwrite")
    created_at = Column(
        DateTime, default=lambda: datetime.now(timezone.utc), nullable=False
    )

    __table_args__ = (Index("ix_sekura_connections_user_id", "user_id"),)
