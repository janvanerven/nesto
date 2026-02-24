# Lists Module Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a unified "Lists" module (groceries + wishlist) with shopping lists, items, check-off, archive, and a 5th bottom-nav tab.

**Architecture:** Two new DB tables (shopping_lists, shopping_items) with full CRUD via FastAPI service/router. Frontend gets two new routes (/lists, /lists/$listId), API hooks, list cards, create/edit sheets, and inline item entry. Follows all existing patterns exactly.

**Tech Stack:** FastAPI, SQLAlchemy 2.0 async, Alembic, React 19, TanStack Router + Query, Tailwind CSS v4, Framer Motion

**Design doc:** `docs/plans/2026-02-24-lists-module-design.md`

---

### Task 1: Backend Models — ShoppingList + ShoppingItem

**Files:**
- Create: `backend/app/models/shopping_list.py`
- Modify: `backend/app/models/__init__.py`

**Step 1: Create the model file**

```python
# backend/app/models/shopping_list.py
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class ShoppingList(Base):
    __tablename__ = "shopping_lists"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    household_id: Mapped[str] = mapped_column(Text, ForeignKey("households.id"), nullable=False)
    name: Mapped[str] = mapped_column(Text, nullable=False, default="")
    priority: Mapped[int] = mapped_column(Integer, nullable=False, default=3)
    status: Mapped[str] = mapped_column(Text, nullable=False, default="active")
    created_by: Mapped[str] = mapped_column(Text, ForeignKey("users.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())


class ShoppingItem(Base):
    __tablename__ = "shopping_items"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    list_id: Mapped[str] = mapped_column(Text, ForeignKey("shopping_lists.id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    quantity: Mapped[str] = mapped_column(Text, nullable=False, default="")
    checked: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
```

**Step 2: Register models in `__init__.py`**

Add to `backend/app/models/__init__.py`:
```python
from app.models.shopping_list import ShoppingItem, ShoppingList
```
And add `"ShoppingList", "ShoppingItem"` to the `__all__` list.

**Step 3: Commit**

```
git add backend/app/models/shopping_list.py backend/app/models/__init__.py
git commit -m "feat(lists): add ShoppingList and ShoppingItem models"
```

---

### Task 2: Alembic Migration

**Files:**
- Create: `backend/alembic/versions/<hash>_add_shopping_lists_tables.py`

**Step 1: Generate migration**

```bash
cd backend && alembic revision --autogenerate -m "add shopping lists tables"
```

**Step 2: Verify the generated migration has both tables**

The migration should contain `op.create_table('shopping_lists', ...)` and `op.create_table('shopping_items', ...)` with the CASCADE foreign key on `shopping_items.list_id`.

**Step 3: Run migration**

```bash
cd backend && alembic upgrade head
```

**Step 4: Commit**

```
git add backend/alembic/versions/
git commit -m "feat(lists): add shopping_lists and shopping_items migration"
```

---

### Task 3: Backend Schemas

**Files:**
- Create: `backend/app/schemas/shopping_list.py`

**Step 1: Create schemas**

```python
# backend/app/schemas/shopping_list.py
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


# --- Shopping List schemas ---

class ShoppingListCreate(BaseModel):
    name: str = Field(default="", max_length=200)
    priority: int = Field(default=3, ge=1, le=4)


class ShoppingListUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=200)
    priority: int | None = Field(default=None, ge=1, le=4)
    status: Literal["active", "archived"] | None = None


class ShoppingListResponse(BaseModel):
    id: str
    household_id: str
    name: str
    priority: int
    status: str
    created_by: str
    created_at: datetime
    updated_at: datetime
    item_count: int = 0
    checked_count: int = 0

    model_config = {"from_attributes": True}


# --- Shopping Item schemas ---

class ShoppingItemCreate(BaseModel):
    name: str = Field(min_length=1, max_length=500)
    quantity: str = Field(default="", max_length=100)


class ShoppingItemUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=500)
    quantity: str | None = Field(default=None, max_length=100)
    checked: bool | None = None


class ShoppingItemResponse(BaseModel):
    id: str
    list_id: str
    name: str
    quantity: str
    checked: bool
    position: int
    created_at: datetime

    model_config = {"from_attributes": True}
```

**Step 2: Commit**

```
git add backend/app/schemas/shopping_list.py
git commit -m "feat(lists): add shopping list and item schemas"
```

---

### Task 4: Backend Service

**Files:**
- Create: `backend/app/services/shopping_list_service.py`

**Step 1: Create service with all CRUD operations**

```python
# backend/app/services/shopping_list_service.py
import uuid

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.shopping_list import ShoppingItem, ShoppingList
from app.schemas.shopping_list import (
    ShoppingItemCreate,
    ShoppingItemUpdate,
    ShoppingListCreate,
    ShoppingListUpdate,
)

_LIST_UPDATABLE_FIELDS = {"name", "priority", "status"}
_ITEM_UPDATABLE_FIELDS = {"name", "quantity", "checked"}


# --- List operations ---

async def list_shopping_lists(
    db: AsyncSession,
    household_id: str,
    status: str | None = None,
) -> list[dict]:
    query = select(ShoppingList).where(ShoppingList.household_id == household_id)
    if status:
        query = query.where(ShoppingList.status == status)
    query = query.order_by(ShoppingList.priority.asc(), ShoppingList.created_at.desc())
    result = await db.execute(query)
    lists = list(result.scalars().all())

    # Fetch item counts per list
    out = []
    for sl in lists:
        counts = await db.execute(
            select(
                func.count(ShoppingItem.id),
                func.count(ShoppingItem.id).filter(ShoppingItem.checked == True),
            ).where(ShoppingItem.list_id == sl.id)
        )
        total, checked = counts.one()
        d = {
            "id": sl.id,
            "household_id": sl.household_id,
            "name": sl.name,
            "priority": sl.priority,
            "status": sl.status,
            "created_by": sl.created_by,
            "created_at": sl.created_at,
            "updated_at": sl.updated_at,
            "item_count": total,
            "checked_count": checked,
        }
        out.append(d)
    return out


async def create_shopping_list(
    db: AsyncSession, household_id: str, user_id: str, data: ShoppingListCreate
) -> dict:
    sl = ShoppingList(
        id=str(uuid.uuid4()),
        household_id=household_id,
        created_by=user_id,
        **data.model_dump(),
    )
    db.add(sl)
    await db.commit()
    await db.refresh(sl)
    return {
        **{c.key: getattr(sl, c.key) for c in sl.__table__.columns},
        "item_count": 0,
        "checked_count": 0,
    }


async def update_shopping_list(
    db: AsyncSession, list_id: str, household_id: str, data: ShoppingListUpdate
) -> dict:
    sl = await _get_list_or_404(db, list_id, household_id)
    updates = data.model_dump(exclude_unset=True)
    for key, value in updates.items():
        if key in _LIST_UPDATABLE_FIELDS:
            setattr(sl, key, value)
    await db.commit()
    await db.refresh(sl)

    counts = await db.execute(
        select(
            func.count(ShoppingItem.id),
            func.count(ShoppingItem.id).filter(ShoppingItem.checked == True),
        ).where(ShoppingItem.list_id == sl.id)
    )
    total, checked = counts.one()
    return {
        **{c.key: getattr(sl, c.key) for c in sl.__table__.columns},
        "item_count": total,
        "checked_count": checked,
    }


async def delete_shopping_list(db: AsyncSession, list_id: str, household_id: str) -> None:
    sl = await _get_list_or_404(db, list_id, household_id)
    await db.delete(sl)
    await db.commit()


async def complete_shopping_list(
    db: AsyncSession, list_id: str, household_id: str
) -> dict:
    sl = await _get_list_or_404(db, list_id, household_id)
    sl.status = "archived"
    # Check all unchecked items
    items_result = await db.execute(
        select(ShoppingItem).where(ShoppingItem.list_id == sl.id, ShoppingItem.checked == False)
    )
    for item in items_result.scalars().all():
        item.checked = True
    await db.commit()
    await db.refresh(sl)

    counts = await db.execute(
        select(
            func.count(ShoppingItem.id),
            func.count(ShoppingItem.id).filter(ShoppingItem.checked == True),
        ).where(ShoppingItem.list_id == sl.id)
    )
    total, checked = counts.one()
    return {
        **{c.key: getattr(sl, c.key) for c in sl.__table__.columns},
        "item_count": total,
        "checked_count": checked,
    }


# --- Item operations ---

async def list_items(db: AsyncSession, list_id: str, household_id: str) -> list[ShoppingItem]:
    await _get_list_or_404(db, list_id, household_id)
    result = await db.execute(
        select(ShoppingItem)
        .where(ShoppingItem.list_id == list_id)
        .order_by(ShoppingItem.checked.asc(), ShoppingItem.position.asc(), ShoppingItem.created_at.asc())
    )
    return list(result.scalars().all())


async def create_item(
    db: AsyncSession, list_id: str, household_id: str, data: ShoppingItemCreate
) -> ShoppingItem:
    await _get_list_or_404(db, list_id, household_id)
    # Position = current max + 1
    max_pos = await db.execute(
        select(func.coalesce(func.max(ShoppingItem.position), -1)).where(ShoppingItem.list_id == list_id)
    )
    position = max_pos.scalar() + 1

    item = ShoppingItem(
        id=str(uuid.uuid4()),
        list_id=list_id,
        position=position,
        **data.model_dump(),
    )
    db.add(item)
    await db.commit()
    await db.refresh(item)
    return item


async def update_item(
    db: AsyncSession, item_id: str, list_id: str, household_id: str, data: ShoppingItemUpdate
) -> ShoppingItem:
    await _get_list_or_404(db, list_id, household_id)
    result = await db.execute(
        select(ShoppingItem).where(ShoppingItem.id == item_id, ShoppingItem.list_id == list_id)
    )
    item = result.scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")

    updates = data.model_dump(exclude_unset=True)
    for key, value in updates.items():
        if key in _ITEM_UPDATABLE_FIELDS:
            setattr(item, key, value)
    await db.commit()
    await db.refresh(item)
    return item


async def delete_item(db: AsyncSession, item_id: str, list_id: str, household_id: str) -> None:
    await _get_list_or_404(db, list_id, household_id)
    result = await db.execute(
        select(ShoppingItem).where(ShoppingItem.id == item_id, ShoppingItem.list_id == list_id)
    )
    item = result.scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    await db.delete(item)
    await db.commit()


# --- Helpers ---

async def _get_list_or_404(db: AsyncSession, list_id: str, household_id: str) -> ShoppingList:
    result = await db.execute(
        select(ShoppingList).where(ShoppingList.id == list_id, ShoppingList.household_id == household_id)
    )
    sl = result.scalar_one_or_none()
    if not sl:
        raise HTTPException(status_code=404, detail="Shopping list not found")
    return sl
```

**Step 2: Commit**

```
git add backend/app/services/shopping_list_service.py
git commit -m "feat(lists): add shopping list service with full CRUD"
```

---

### Task 5: Backend Router

**Files:**
- Create: `backend/app/routers/shopping_lists.py`
- Modify: `backend/app/main.py`

**Step 1: Create router**

```python
# backend/app/routers/shopping_lists.py
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user_id
from app.database import get_db
from app.schemas.shopping_list import (
    ShoppingItemCreate,
    ShoppingItemResponse,
    ShoppingItemUpdate,
    ShoppingListCreate,
    ShoppingListResponse,
    ShoppingListUpdate,
)
from app.services.household_service import get_household
from app.services import shopping_list_service as svc

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
    return await svc.create_item(db, list_id, household_id, body)


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
```

**Step 2: Register router in `backend/app/main.py`**

Add import: `from app.routers import auth, events, households, shopping_lists, tasks`
Add line: `app.include_router(shopping_lists.router)`

**Step 3: Verify backend starts**

```bash
cd backend && python -c "from app.main import app; print('OK')"
```

**Step 4: Commit**

```
git add backend/app/routers/shopping_lists.py backend/app/main.py
git commit -m "feat(lists): add shopping lists router and register in app"
```

---

### Task 6: Frontend API Hooks

**Files:**
- Create: `frontend/src/api/lists.ts`

**Step 1: Create API hooks file**

```typescript
// frontend/src/api/lists.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch, hasToken } from './client'

export interface ShoppingList {
  id: string
  household_id: string
  name: string
  priority: number
  status: string
  created_by: string
  created_at: string
  updated_at: string
  item_count: number
  checked_count: number
}

export interface ShoppingListCreate {
  name?: string
  priority?: number
}

export interface ShoppingListUpdate {
  name?: string
  priority?: number
  status?: 'active' | 'archived'
}

export interface ShoppingItem {
  id: string
  list_id: string
  name: string
  quantity: string
  checked: boolean
  position: number
  created_at: string
}

export interface ShoppingItemCreate {
  name: string
  quantity?: string
}

export interface ShoppingItemUpdate {
  name?: string
  quantity?: string
  checked?: boolean
}

// --- List hooks ---

export function useShoppingLists(householdId: string, status?: string) {
  const params = status ? `?status=${status}` : ''
  return useQuery({
    queryKey: ['lists', householdId, status],
    queryFn: () => apiFetch<ShoppingList[]>(`/households/${householdId}/lists${params}`),
    enabled: !!householdId && hasToken(),
  })
}

export function useCreateShoppingList(householdId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (list: ShoppingListCreate) =>
      apiFetch<ShoppingList>(`/households/${householdId}/lists`, {
        method: 'POST',
        body: JSON.stringify(list),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['lists', householdId] }),
  })
}

export function useUpdateShoppingList(householdId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ listId, ...update }: ShoppingListUpdate & { listId: string }) =>
      apiFetch<ShoppingList>(`/households/${householdId}/lists/${listId}`, {
        method: 'PATCH',
        body: JSON.stringify(update),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['lists', householdId] }),
  })
}

export function useDeleteShoppingList(householdId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (listId: string) =>
      apiFetch<void>(`/households/${householdId}/lists/${listId}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['lists', householdId] }),
  })
}

export function useCompleteShoppingList(householdId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (listId: string) =>
      apiFetch<ShoppingList>(`/households/${householdId}/lists/${listId}/complete`, {
        method: 'POST',
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['lists', householdId] }),
  })
}

// --- Item hooks ---

export function useShoppingItems(householdId: string, listId: string) {
  return useQuery({
    queryKey: ['list-items', householdId, listId],
    queryFn: () => apiFetch<ShoppingItem[]>(`/households/${householdId}/lists/${listId}/items`),
    enabled: !!householdId && !!listId && hasToken(),
  })
}

export function useCreateShoppingItem(householdId: string, listId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (item: ShoppingItemCreate) =>
      apiFetch<ShoppingItem>(`/households/${householdId}/lists/${listId}/items`, {
        method: 'POST',
        body: JSON.stringify(item),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['list-items', householdId, listId] })
      qc.invalidateQueries({ queryKey: ['lists', householdId] })
    },
  })
}

export function useUpdateShoppingItem(householdId: string, listId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ itemId, ...update }: ShoppingItemUpdate & { itemId: string }) =>
      apiFetch<ShoppingItem>(`/households/${householdId}/lists/${listId}/items/${itemId}`, {
        method: 'PATCH',
        body: JSON.stringify(update),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['list-items', householdId, listId] })
      qc.invalidateQueries({ queryKey: ['lists', householdId] })
    },
  })
}

export function useDeleteShoppingItem(householdId: string, listId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (itemId: string) =>
      apiFetch<void>(`/households/${householdId}/lists/${listId}/items/${itemId}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['list-items', householdId, listId] })
      qc.invalidateQueries({ queryKey: ['lists', householdId] })
    },
  })
}
```

**Step 2: Commit**

```
git add frontend/src/api/lists.ts
git commit -m "feat(lists): add frontend API hooks for lists and items"
```

---

### Task 7: Bottom Nav — Add Lists Tab

**Files:**
- Modify: `frontend/src/components/layout/bottom-nav.tsx`

**Step 1: Add ListIcon function and insert tab**

Add a `ListIcon` component (clipboard/list SVG icon). Insert the Lists tab between Calendar and Settings in the `tabs` array:

```typescript
const tabs = [
  { to: '/' as const, label: 'Home', icon: HomeIcon },
  { to: '/tasks' as const, label: 'Reminders', icon: CheckIcon },
  { to: '/calendar' as const, label: 'Calendar', icon: CalendarIcon },
  { to: '/lists' as const, label: 'Lists', icon: ListIcon },
  { to: '/settings' as const, label: 'More', icon: SettingsIcon },
]
```

Add the icon:
```typescript
function ListIcon({ active }: { active: boolean }) {
  const color = active ? '#6C5CE7' : '#636E72'
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 5h11M9 12h11M9 19h11M5 5v.01M5 12v.01M5 19v.01" />
    </svg>
  )
}
```

**Step 2: Commit**

```
git add frontend/src/components/layout/bottom-nav.tsx
git commit -m "feat(lists): add Lists tab to bottom nav"
```

---

### Task 8: Lists Route — Main Page

**Files:**
- Create: `frontend/src/routes/lists.tsx`
- Create: `frontend/src/components/lists/list-card.tsx`
- Create: `frontend/src/components/lists/create-list-sheet.tsx`

**Step 1: Create ListCard component**

`frontend/src/components/lists/list-card.tsx` — Shows list name, priority dot, progress count (e.g. "3/7"), tappable to navigate to detail. Similar structure to TaskCard but with progress instead of due date.

Key elements:
- PriorityDot for priority display
- Progress text: `${checked_count}/${item_count}` items
- Name displays as "Untitled list" when empty
- Entire card is tappable (navigates to detail)
- Archived lists show dimmed

**Step 2: Create CreateListSheet component**

`frontend/src/components/lists/create-list-sheet.tsx` — Minimal bottom sheet following the exact same Framer Motion animation pattern as CreateReminderSheet. Fields: name input (optional, placeholder "List name"), priority pills. Submit creates the list and navigates to its detail page.

**Step 3: Create Lists route**

`frontend/src/routes/lists.tsx` — File-based route following the tasks.tsx pattern:
- Auth/household guards with redirects
- Filter tabs: Active | Archived
- Loading skeletons
- Empty state with emoji + message
- List of ListCard components
- FAB for create
- CreateListSheet wired to `useCreateShoppingList`
- On list create success, navigate to `/lists/${newList.id}`

**Step 4: Verify TypeScript compiles**

```bash
cd frontend && npx tsc --noEmit 2>&1 | grep -E "lists|list-card|create-list"
```

**Step 5: Commit**

```
git add frontend/src/routes/lists.tsx frontend/src/components/lists/
git commit -m "feat(lists): add lists main page with list cards and create sheet"
```

---

### Task 9: List Detail Route

**Files:**
- Create: `frontend/src/routes/lists.$listId.tsx`
- Create: `frontend/src/components/lists/edit-list-sheet.tsx`

**Step 1: Create EditListSheet component**

`frontend/src/components/lists/edit-list-sheet.tsx` — Bottom sheet following edit-event-sheet pattern:
- Props: `{ list, open, onClose, onSubmit, onDelete, isPending }`
- useEffect populates state from list prop
- Fields: name input, priority pills
- Two-step delete confirmation
- Archive button (sets status to "archived")

**Step 2: Create list detail route**

`frontend/src/routes/lists.$listId.tsx` — TanStack Router dynamic route:
- Parse `listId` from route params
- Auth/household guards
- Header with list name + edit icon (pencil SVG) + back button
- Inline "Add item" form at top: name input + quantity input + add button (single row)
- Items rendered as checkable rows:
  - Checkbox (same style as task complete button) — tap toggles `checked`
  - Item name + quantity text
  - Delete button (trash icon, same style as TaskCard)
- Checked items: dimmed + strike-through, sorted to bottom (backend handles sort order)
- "Complete list" button at bottom — calls `useCompleteShoppingList` then navigates back to `/lists`
- EditListSheet wired to `useUpdateShoppingList` and `useDeleteShoppingList`
- On delete, navigate back to `/lists`

**Step 3: Verify TypeScript compiles**

```bash
cd frontend && npx tsc --noEmit 2>&1 | grep -E "listId|edit-list"
```

**Step 4: Commit**

```
git add frontend/src/routes/lists.\$listId.tsx frontend/src/components/lists/edit-list-sheet.tsx
git commit -m "feat(lists): add list detail page with inline items and edit sheet"
```

---

### Task 10: Integration Verification

**Step 1: Run backend**

```bash
cd backend && python -c "from app.main import app; print('Routes:', [r.path for r in app.routes])"
```

Verify `/api/households/{household_id}/lists` routes are present.

**Step 2: Run frontend type check**

```bash
cd frontend && npx tsc --noEmit
```

Only pre-existing errors should appear (Vite env types, Framer Motion type mismatch). No new errors from lists code.

**Step 3: Manual smoke test checklist**

- [ ] Bottom nav shows 5 tabs including "Lists"
- [ ] `/lists` page loads with empty state
- [ ] Create a list via FAB → navigates to detail
- [ ] Add items inline on detail page
- [ ] Check/uncheck items (toggle, dim + strike-through)
- [ ] Delete items
- [ ] Edit list name/priority via edit sheet
- [ ] Complete list → archives, returns to lists page
- [ ] Archived filter shows completed lists
- [ ] Delete list from edit sheet (two-step confirm)

---

### Task 11: Update CLAUDE.md

**Files:**
- Modify: `.claude/CLAUDE.md`

**Step 1: Update project structure, API endpoints, and database sections**

Add to Project Structure:
- `models/` — add shopping_list
- `schemas/` — add shopping_list
- `routers/` — add shopping_lists
- `services/` — add shopping_list_service
- Frontend routes: add lists, lists.$listId
- Frontend components: add lists/ (list-card, create-list-sheet, edit-list-sheet)
- Frontend api: add lists.ts

Add to API Endpoints:
```
- GET/POST /api/households/{id}/lists — List/create shopping lists
- PATCH/DELETE /api/households/{id}/lists/{listId} — Update/delete list
- POST /api/households/{id}/lists/{listId}/complete — Archive list
- GET/POST /api/households/{id}/lists/{listId}/items — List/add items
- PATCH/DELETE /api/households/{id}/lists/{listId}/items/{itemId} — Update/delete item
```

Add to Database:
```
Tables: ..., shopping_lists, shopping_items
```

**Step 2: Commit**

```
git add .claude/CLAUDE.md
git commit -m "docs: update CLAUDE.md with lists module"
```
