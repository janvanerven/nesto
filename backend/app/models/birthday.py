from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class Birthday(Base):
    __tablename__ = "birthdays"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    household_id: Mapped[str] = mapped_column(Text, ForeignKey("households.id", ondelete="CASCADE"), nullable=False)
    person_name: Mapped[str] = mapped_column(Text, nullable=False)
    birth_month: Mapped[int] = mapped_column(Integer, nullable=False)
    birth_day: Mapped[int] = mapped_column(Integer, nullable=False)
    birth_year: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_by: Mapped[str] = mapped_column(Text, ForeignKey("users.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())
