from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user_id
from app.database import get_db
from app.schemas.comment import CommentCreate, CommentResponse
from app.services.household_service import get_household
from app.services import comment_service as svc
from app.services.push_service import notify_mentioned_users

router = APIRouter(
    prefix="/api/households/{household_id}/comments",
    tags=["comments"],
)

_VALID_ENTITY_TYPES = {"task", "event"}


def _validate_entity_type(entity_type: str) -> None:
    if entity_type not in _VALID_ENTITY_TYPES:
        raise HTTPException(status_code=400, detail="entity_type must be 'task' or 'event'")


@router.get("/{entity_type}/{entity_id}", response_model=list[CommentResponse])
async def list_comments(
    household_id: str,
    entity_type: str,
    entity_id: str,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    _validate_entity_type(entity_type)
    await get_household(db, household_id, user_id)
    return await svc.list_comments(db, entity_type, entity_id, household_id)


@router.post("/{entity_type}/{entity_id}", response_model=CommentResponse, status_code=201)
async def create_comment(
    household_id: str,
    entity_type: str,
    entity_id: str,
    body: CommentCreate,
    background_tasks: BackgroundTasks,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    _validate_entity_type(entity_type)
    await get_household(db, household_id, user_id)
    comment = await svc.create_comment(db, entity_type, entity_id, household_id, user_id, body)
    if body.mentions:
        background_tasks.add_task(
            notify_mentioned_users,
            comment.author_name,
            body.mentions,
            entity_type,
            entity_id,
            household_id,
        )
    return comment


@router.delete("/{entity_type}/{entity_id}/{comment_id}", status_code=204)
async def delete_comment(
    household_id: str,
    entity_type: str,
    entity_id: str,
    comment_id: str,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    _validate_entity_type(entity_type)
    await get_household(db, household_id, user_id)
    await svc.delete_comment(db, comment_id, user_id, entity_type, entity_id, household_id)
