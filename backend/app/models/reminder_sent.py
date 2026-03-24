from datetime import date, datetime

from sqlalchemy import Date, DateTime, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class ReminderSent(Base):
    __tablename__ = "reminders_sent"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    entity_type: Mapped[str] = mapped_column(Text, nullable=False)   # "task" or "event"
    entity_id: Mapped[str] = mapped_column(Text, nullable=False)
    occurrence_date: Mapped[date] = mapped_column(Date, nullable=False)
    channel: Mapped[str] = mapped_column(Text, nullable=False, default="email")
    sent_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    __table_args__ = (
        UniqueConstraint(
            "entity_type", "entity_id", "occurrence_date", "channel",
            name="uq_reminders_sent_dedup",
        ),
    )
