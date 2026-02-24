from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class Household(Base):
    __tablename__ = "households"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    created_by: Mapped[str] = mapped_column(Text, ForeignKey("users.id"), nullable=False)


class HouseholdMember(Base):
    __tablename__ = "household_members"

    household_id: Mapped[str] = mapped_column(Text, ForeignKey("households.id"), primary_key=True)
    user_id: Mapped[str] = mapped_column(Text, ForeignKey("users.id"), primary_key=True)
    joined_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class HouseholdInvite(Base):
    __tablename__ = "household_invites"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    household_id: Mapped[str] = mapped_column(Text, ForeignKey("households.id"), nullable=False)
    created_by: Mapped[str] = mapped_column(Text, ForeignKey("users.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
