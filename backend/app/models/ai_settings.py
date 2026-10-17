from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class HouseholdAiSettings(Base):
    __tablename__ = "household_ai_settings"

    household_id: Mapped[str] = mapped_column(
        Text, ForeignKey("households.id", ondelete="CASCADE"), primary_key=True
    )
    encrypted_api_key: Mapped[str] = mapped_column(Text, nullable=False)
    key_label: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")
    model: Mapped[str] = mapped_column(Text, nullable=False)
    updated_by: Mapped[str] = mapped_column(Text, ForeignKey("users.id"), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())
