import uuid

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.comment import Comment
from app.models.event import Event
from app.models.household import HouseholdMember
from app.models.task import Task
from app.models.user import User
from app.schemas.comment import CommentCreate, CommentResponse

_ENTITY_MODELS = {"task": Task, "event": Event}


def comment_count_subquery(entity_type: str, entity_id_col):
    """Correlated scalar subquery counting comments for an entity column."""
    return (
        select(func.count(Comment.id))
        .where(Comment.entity_type == entity_type, Comment.entity_id == entity_id_col)
        .scalar_subquery()
    )


async def _require_entity_in_household(
    db: AsyncSession,
    entity_type: str,
    entity_id: str,
    household_id: str,
) -> None:
    """Raise 404 unless the entity exists and belongs to the household."""
    model = _ENTITY_MODELS[entity_type]
    result = await db.execute(
        select(model.id).where(model.id == entity_id, model.household_id == household_id)
    )
    if result.scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail=f"{entity_type.capitalize()} not found")


async def list_comments(
    db: AsyncSession,
    entity_type: str,
    entity_id: str,
    household_id: str,
) -> list[CommentResponse]:
    await _require_entity_in_household(db, entity_type, entity_id, household_id)
    result = await db.execute(
        select(Comment, User)
        .join(User, Comment.author_id == User.id)
        .where(Comment.entity_type == entity_type, Comment.entity_id == entity_id)
        .order_by(Comment.created_at.asc())
    )
    rows = result.all()
    return [
        CommentResponse(
            id=comment.id,
            entity_type=comment.entity_type,
            entity_id=comment.entity_id,
            author_id=comment.author_id,
            author_name=user.display_name,
            content=comment.content,
            created_at=comment.created_at,
        )
        for comment, user in rows
    ]


async def create_comment(
    db: AsyncSession,
    entity_type: str,
    entity_id: str,
    household_id: str,
    author_id: str,
    body: CommentCreate,
) -> CommentResponse:
    await _require_entity_in_household(db, entity_type, entity_id, household_id)
    if body.mentions:
        members_result = await db.execute(
            select(HouseholdMember.user_id).where(
                HouseholdMember.household_id == household_id,
                HouseholdMember.user_id.in_(body.mentions),
            )
        )
        found_ids = set(members_result.scalars().all())
        invalid = [uid for uid in body.mentions if uid not in found_ids]
        if invalid:
            raise HTTPException(status_code=400, detail="Mentioned user(s) are not household members")

    author_result = await db.execute(select(User.display_name).where(User.id == author_id))
    author_name = author_result.scalar_one()

    comment = Comment(
        id=str(uuid.uuid4()),
        entity_type=entity_type,
        entity_id=entity_id,
        author_id=author_id,
        content=body.content,
    )
    db.add(comment)
    await db.commit()
    await db.refresh(comment)  # load server-generated created_at

    return CommentResponse(
        id=comment.id,
        entity_type=comment.entity_type,
        entity_id=comment.entity_id,
        author_id=comment.author_id,
        author_name=author_name,
        content=comment.content,
        created_at=comment.created_at,
    )


async def delete_comment(
    db: AsyncSession,
    comment_id: str,
    requester_id: str,
    entity_type: str,
    entity_id: str,
    household_id: str,
) -> None:
    await _require_entity_in_household(db, entity_type, entity_id, household_id)
    result = await db.execute(
        select(Comment).where(
            Comment.id == comment_id,
            Comment.entity_type == entity_type,
            Comment.entity_id == entity_id,
        )
    )
    comment = result.scalar_one_or_none()
    if not comment:
        raise HTTPException(status_code=404, detail="Comment not found")
    if comment.author_id != requester_id:
        raise HTTPException(status_code=403, detail="Only the author can delete this comment")
    await db.delete(comment)
    await db.commit()
