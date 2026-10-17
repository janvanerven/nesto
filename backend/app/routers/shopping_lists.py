from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user_id
from app.database import get_db
from app.schemas.shopping_list import (
    BulkItemsCreate,
    RecipeResponse,
    ShoppingItemCreate,
    ShoppingItemResponse,
    ShoppingItemUpdate,
    ShoppingListCreate,
    ShoppingListResponse,
    ShoppingListUpdate,
    SuggestionResponse,
)
from app.services.household_service import get_household
from app.services import list_suggestion_service, shopping_list_service as svc

router = APIRouter(prefix="/api/households/{household_id}/lists", tags=["lists"])


# --- List endpoints ---

@router.get("", response_model=list[ShoppingListResponse])
async def get_lists(
    household_id: str,
    status: str | None = Query(None),
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    await get_household(db, household_id, user_id)
    return await svc.list_shopping_lists(db, household_id, status=status)


@router.post("", response_model=ShoppingListResponse, status_code=201)
async def create_list(
    household_id: str,
    body: ShoppingListCreate,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    await get_household(db, household_id, user_id)
    return await svc.create_shopping_list(db, household_id, user_id, body)


@router.patch("/{list_id}", response_model=ShoppingListResponse)
async def update_list(
    household_id: str,
    list_id: str,
    body: ShoppingListUpdate,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    await get_household(db, household_id, user_id)
    return await svc.update_shopping_list(db, list_id, household_id, body)


@router.delete("/{list_id}", status_code=204)
async def delete_list(
    household_id: str,
    list_id: str,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    await get_household(db, household_id, user_id)
    await svc.delete_shopping_list(db, list_id, household_id)


@router.post("/{list_id}/complete", response_model=ShoppingListResponse)
async def complete_list(
    household_id: str,
    list_id: str,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    await get_household(db, household_id, user_id)
    return await svc.complete_shopping_list(db, list_id, household_id)


@router.get("/{list_id}/suggestions", response_model=SuggestionResponse)
async def get_suggestions(
    household_id: str,
    list_id: str,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    await get_household(db, household_id, user_id)
    shopping_list = await svc._get_list_or_404(db, list_id, household_id)
    if shopping_list.kind != "groceries":
        raise HTTPException(status_code=400, detail="Suggestions are only available for grocery lists")
    return await list_suggestion_service.suggest_items(db, household_id, list_id)


# --- Item endpoints ---

@router.get("/{list_id}/items", response_model=list[ShoppingItemResponse])
async def get_items(
    household_id: str,
    list_id: str,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    await get_household(db, household_id, user_id)
    return await svc.list_items(db, list_id, household_id)


@router.post("/{list_id}/items", response_model=ShoppingItemResponse, status_code=201)
async def create_item(
    household_id: str,
    list_id: str,
    body: ShoppingItemCreate,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    await get_household(db, household_id, user_id)
    return await svc.create_item(db, list_id, household_id, body, user_id=user_id)


@router.patch("/{list_id}/items/{item_id}", response_model=ShoppingItemResponse)
async def update_item(
    household_id: str,
    list_id: str,
    item_id: str,
    body: ShoppingItemUpdate,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    await get_household(db, household_id, user_id)
    return await svc.update_item(db, item_id, list_id, household_id, body)


@router.delete("/{list_id}/items/{item_id}", status_code=204)
async def delete_item(
    household_id: str,
    list_id: str,
    item_id: str,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    await get_household(db, household_id, user_id)
    await svc.delete_item(db, item_id, list_id, household_id)


@router.post("/{list_id}/items/bulk", response_model=list[ShoppingItemResponse], status_code=201)
async def create_items_bulk(
    household_id: str,
    list_id: str,
    body: BulkItemsCreate,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    await get_household(db, household_id, user_id)
    return await svc.create_items_bulk(db, list_id, household_id, user_id, body)


# --- Recipe endpoints ---

@router.get("/{list_id}/recipes", response_model=list[RecipeResponse])
async def get_recipes(
    household_id: str,
    list_id: str,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    await get_household(db, household_id, user_id)
    return await svc.list_recipes(db, list_id, household_id)


@router.delete("/{list_id}/recipes/{recipe_id}", status_code=204)
async def delete_recipe(
    household_id: str,
    list_id: str,
    recipe_id: str,
    remove_items: bool = Query(False),
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    await get_household(db, household_id, user_id)
    await svc.delete_recipe(db, list_id, household_id, recipe_id, remove_items)
