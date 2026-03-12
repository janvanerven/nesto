# Loyalty Cards Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add household-shared loyalty cards with on-screen barcode rendering to Nesto.

**Architecture:** New `loyalty_cards` table (household-scoped, flat entity). Backend CRUD via FastAPI router + service following the shopping lists pattern. Frontend renders barcodes client-side using JsBarcode (1D) and qrcode.react (QR). New `/cards` section with bottom nav tab.

**Tech Stack:** SQLAlchemy model, Alembic migration, FastAPI router, Pydantic schemas, React + TanStack Router/Query, JsBarcode, qrcode.react, Tailwind CSS, Framer Motion.

---

### Task 1: Backend — Model, Schema, Migration

**Files:**
- Create: `backend/app/models/loyalty_card.py`
- Create: `backend/app/schemas/loyalty_card.py`
- Modify: `backend/app/models/__init__.py`

**Step 1: Create the SQLAlchemy model**

Create `backend/app/models/loyalty_card.py`:

```python
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class LoyaltyCard(Base):
    __tablename__ = "loyalty_cards"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    household_id: Mapped[str] = mapped_column(Text, ForeignKey("households.id"), nullable=False)
    store_name: Mapped[str] = mapped_column(Text, nullable=False)
    barcode_number: Mapped[str] = mapped_column(Text, nullable=False)
    barcode_format: Mapped[str] = mapped_column(Text, nullable=False)
    color: Mapped[str] = mapped_column(Text, nullable=False, default="#6C5CE7")
    created_by: Mapped[str] = mapped_column(Text, ForeignKey("users.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())
```

**Step 2: Create the Pydantic schemas**

Create `backend/app/schemas/loyalty_card.py`:

```python
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


BarcodeFormat = Literal["code128", "ean13", "qr", "code39"]


class LoyaltyCardCreate(BaseModel):
    store_name: str = Field(min_length=1, max_length=200)
    barcode_number: str = Field(min_length=1, max_length=500)
    barcode_format: BarcodeFormat
    color: str = Field(default="#6C5CE7", pattern=r"^#[0-9A-Fa-f]{6}$")


class LoyaltyCardUpdate(BaseModel):
    store_name: str | None = Field(default=None, min_length=1, max_length=200)
    barcode_number: str | None = Field(default=None, min_length=1, max_length=500)
    barcode_format: BarcodeFormat | None = None
    color: str | None = Field(default=None, pattern=r"^#[0-9A-Fa-f]{6}$")


class LoyaltyCardResponse(BaseModel):
    id: str
    household_id: str
    store_name: str
    barcode_number: str
    barcode_format: str
    color: str
    created_by: str
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
```

**Step 3: Register model in `__init__.py`**

Modify `backend/app/models/__init__.py` — add import and export:

```python
from app.models.loyalty_card import LoyaltyCard
```

Add `"LoyaltyCard"` to the `__all__` list.

**Step 4: Generate Alembic migration**

Run: `cd /home/jan/nesto/backend && alembic revision --autogenerate -m "add loyalty_cards table"`

Verify the generated migration creates the `loyalty_cards` table with all columns and an index on `household_id`. If the index is missing, add manually:

```python
op.create_index('ix_loyalty_cards_household_id', 'loyalty_cards', ['household_id'])
```

**Step 5: Run migration**

Run: `cd /home/jan/nesto/backend && alembic upgrade head`

**Step 6: Commit**

```bash
git add backend/app/models/loyalty_card.py backend/app/schemas/loyalty_card.py backend/app/models/__init__.py backend/alembic/versions/
git commit -m "feat: add loyalty_cards model, schemas, and migration"
```

---

### Task 2: Backend — Service Layer

**Files:**
- Create: `backend/app/services/loyalty_card_service.py`

**Step 1: Create the service**

Create `backend/app/services/loyalty_card_service.py`:

```python
import uuid

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.loyalty_card import LoyaltyCard
from app.schemas.loyalty_card import LoyaltyCardCreate, LoyaltyCardUpdate

_UPDATABLE_FIELDS = {"store_name", "barcode_number", "barcode_format", "color"}


async def list_loyalty_cards(
    db: AsyncSession, household_id: str
) -> list[LoyaltyCard]:
    result = await db.execute(
        select(LoyaltyCard)
        .where(LoyaltyCard.household_id == household_id)
        .order_by(LoyaltyCard.store_name.asc())
    )
    return list(result.scalars().all())


async def create_loyalty_card(
    db: AsyncSession, household_id: str, user_id: str, data: LoyaltyCardCreate
) -> LoyaltyCard:
    card = LoyaltyCard(
        id=str(uuid.uuid4()),
        household_id=household_id,
        created_by=user_id,
        **data.model_dump(),
    )
    db.add(card)
    await db.commit()
    await db.refresh(card)
    return card


async def update_loyalty_card(
    db: AsyncSession, card_id: str, household_id: str, data: LoyaltyCardUpdate
) -> LoyaltyCard:
    card = await _get_card_or_404(db, card_id, household_id)
    updates = data.model_dump(exclude_unset=True)
    for key, value in updates.items():
        if key in _UPDATABLE_FIELDS:
            setattr(card, key, value)
    await db.commit()
    await db.refresh(card)
    return card


async def delete_loyalty_card(
    db: AsyncSession, card_id: str, household_id: str
) -> None:
    card = await _get_card_or_404(db, card_id, household_id)
    await db.delete(card)
    await db.commit()


async def _get_card_or_404(
    db: AsyncSession, card_id: str, household_id: str
) -> LoyaltyCard:
    result = await db.execute(
        select(LoyaltyCard).where(
            LoyaltyCard.id == card_id,
            LoyaltyCard.household_id == household_id,
        )
    )
    card = result.scalar_one_or_none()
    if not card:
        raise HTTPException(status_code=404, detail="Loyalty card not found")
    return card
```

**Step 2: Commit**

```bash
git add backend/app/services/loyalty_card_service.py
git commit -m "feat: add loyalty card service layer"
```

---

### Task 3: Backend — Router + Registration

**Files:**
- Create: `backend/app/routers/loyalty_cards.py`
- Modify: `backend/app/main.py`

**Step 1: Create the router**

Create `backend/app/routers/loyalty_cards.py`:

```python
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user_id
from app.database import get_db
from app.schemas.loyalty_card import (
    LoyaltyCardCreate,
    LoyaltyCardResponse,
    LoyaltyCardUpdate,
)
from app.services.household_service import get_household
from app.services import loyalty_card_service as svc

router = APIRouter(prefix="/api/households/{household_id}/cards", tags=["cards"])


@router.get("", response_model=list[LoyaltyCardResponse])
async def get_cards(
    household_id: str,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    await get_household(db, household_id, user_id)
    return await svc.list_loyalty_cards(db, household_id)


@router.post("", response_model=LoyaltyCardResponse, status_code=201)
async def create_card(
    household_id: str,
    body: LoyaltyCardCreate,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    await get_household(db, household_id, user_id)
    return await svc.create_loyalty_card(db, household_id, user_id, body)


@router.patch("/{card_id}", response_model=LoyaltyCardResponse)
async def update_card(
    household_id: str,
    card_id: str,
    body: LoyaltyCardUpdate,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    await get_household(db, household_id, user_id)
    return await svc.update_loyalty_card(db, card_id, household_id, body)


@router.delete("/{card_id}", status_code=204)
async def delete_card(
    household_id: str,
    card_id: str,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    await get_household(db, household_id, user_id)
    await svc.delete_loyalty_card(db, card_id, household_id)
```

**Step 2: Register router in `main.py`**

In `backend/app/main.py`, add the import:

```python
from app.routers import auth, events, households, loyalty_cards, shopping_lists, tasks
```

And add below the existing `include_router` calls:

```python
app.include_router(loyalty_cards.router)
```

**Step 3: Verify backend starts**

Run: `cd /home/jan/nesto && docker compose up backend -d && docker compose logs backend --tail=20`

Expected: No import errors, server starts successfully.

**Step 4: Commit**

```bash
git add backend/app/routers/loyalty_cards.py backend/app/main.py
git commit -m "feat: add loyalty cards API endpoints"
```

---

### Task 4: Frontend — Install Dependencies + API Hooks

**Files:**
- Create: `frontend/src/api/cards.ts`

**Step 1: Install barcode libraries**

Run: `cd /home/jan/nesto/frontend && npm install jsbarcode qrcode.react`

**Step 2: Create API hooks**

Create `frontend/src/api/cards.ts`:

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch, hasToken } from './client'

export interface LoyaltyCard {
  id: string
  household_id: string
  store_name: string
  barcode_number: string
  barcode_format: string
  color: string
  created_by: string
  created_at: string
  updated_at: string
}

export interface LoyaltyCardCreate {
  store_name: string
  barcode_number: string
  barcode_format: 'code128' | 'ean13' | 'qr' | 'code39'
  color: string
}

export interface LoyaltyCardUpdate {
  store_name?: string
  barcode_number?: string
  barcode_format?: 'code128' | 'ean13' | 'qr' | 'code39'
  color?: string
}

export function useLoyaltyCards(householdId: string) {
  return useQuery({
    queryKey: ['cards', householdId],
    queryFn: () => apiFetch<LoyaltyCard[]>(`/households/${householdId}/cards`),
    enabled: !!householdId && hasToken(),
  })
}

export function useCreateLoyaltyCard(householdId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (card: LoyaltyCardCreate) =>
      apiFetch<LoyaltyCard>(`/households/${householdId}/cards`, {
        method: 'POST',
        body: JSON.stringify(card),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cards', householdId] }),
  })
}

export function useUpdateLoyaltyCard(householdId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ cardId, ...update }: LoyaltyCardUpdate & { cardId: string }) =>
      apiFetch<LoyaltyCard>(`/households/${householdId}/cards/${cardId}`, {
        method: 'PATCH',
        body: JSON.stringify(update),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cards', householdId] }),
  })
}

export function useDeleteLoyaltyCard(householdId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (cardId: string) =>
      apiFetch<void>(`/households/${householdId}/cards/${cardId}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cards', householdId] }),
  })
}
```

**Step 3: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/src/api/cards.ts
git commit -m "feat: add loyalty card API hooks and barcode dependencies"
```

---

### Task 5: Frontend — Barcode Display Component

**Files:**
- Create: `frontend/src/components/cards/barcode-display.tsx`

**Step 1: Create barcode renderer**

Create `frontend/src/components/cards/barcode-display.tsx`:

```tsx
import { useEffect, useRef } from 'react'
import JsBarcode from 'jsbarcode'
import { QRCodeSVG } from 'qrcode.react'

interface BarcodeDisplayProps {
  value: string
  format: string
  width?: number
  height?: number
}

const FORMAT_MAP: Record<string, string> = {
  code128: 'CODE128',
  ean13: 'EAN13',
  code39: 'CODE39',
}

export function BarcodeDisplay({ value, format, width, height }: BarcodeDisplayProps) {
  if (format === 'qr') {
    return (
      <div className="flex justify-center">
        <QRCodeSVG value={value} size={width ?? 200} bgColor="transparent" fgColor="currentColor" />
      </div>
    )
  }

  return <LinearBarcode value={value} format={format} width={width} height={height} />
}

function LinearBarcode({ value, format, height }: BarcodeDisplayProps) {
  const svgRef = useRef<SVGSVGElement>(null)

  useEffect(() => {
    if (!svgRef.current) return
    try {
      JsBarcode(svgRef.current, value, {
        format: FORMAT_MAP[format] ?? 'CODE128',
        displayValue: true,
        width: 2,
        height: height ?? 80,
        margin: 0,
        background: 'transparent',
        lineColor: 'currentColor',
        fontSize: 14,
        font: 'Outfit',
      })
    } catch {
      // Invalid barcode value for format — show fallback
      if (svgRef.current) svgRef.current.innerHTML = ''
    }
  }, [value, format, height])

  return (
    <div className="flex justify-center w-full overflow-hidden">
      <svg ref={svgRef} className="w-full max-w-full" />
    </div>
  )
}
```

**Step 2: Commit**

```bash
git add frontend/src/components/cards/barcode-display.tsx
git commit -m "feat: add barcode display component (JsBarcode + QR)"
```

---

### Task 6: Frontend — Card Card, Create Sheet, Edit Sheet Components

**Files:**
- Create: `frontend/src/components/cards/loyalty-card-card.tsx`
- Create: `frontend/src/components/cards/create-card-sheet.tsx`
- Create: `frontend/src/components/cards/edit-card-sheet.tsx`

**Step 1: Create the card tile component**

Create `frontend/src/components/cards/loyalty-card-card.tsx`:

A card tile showing the store name and a small barcode preview on a colored background. Uses the card's `color` field. Follows the `ListCard` pattern but with custom styling:

```tsx
import { BarcodeDisplay } from './barcode-display'
import type { LoyaltyCard } from '@/api/cards'

interface LoyaltyCardCardProps {
  card: LoyaltyCard
  onClick: () => void
}

function textColor(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return lum > 0.5 ? '#1a1a1a' : '#ffffff'
}

const FORMAT_LABELS: Record<string, string> = {
  code128: 'Code 128',
  ean13: 'EAN-13',
  qr: 'QR Code',
  code39: 'Code 39',
}

export function LoyaltyCardCard({ card, onClick }: LoyaltyCardCardProps) {
  const fg = textColor(card.color)

  return (
    <button
      onClick={onClick}
      className="w-full rounded-2xl p-4 text-left transition-all active:scale-[0.98]"
      style={{ backgroundColor: card.color, color: fg }}
    >
      <p className="font-bold text-lg truncate">{card.store_name}</p>
      <p className="text-xs opacity-70 mb-3">{FORMAT_LABELS[card.barcode_format] ?? card.barcode_format}</p>
      <div className="opacity-80 pointer-events-none" style={{ color: fg }}>
        <BarcodeDisplay value={card.barcode_number} format={card.barcode_format} height={40} />
      </div>
    </button>
  )
}
```

**Step 2: Create the create-card bottom sheet**

Create `frontend/src/components/cards/create-card-sheet.tsx`:

Bottom sheet with fields: store name (text input), barcode number (text input), barcode format (dropdown), color (palette picker). Follows the `CreateListSheet` pattern exactly for layout/animation:

```tsx
import { motion, AnimatePresence } from 'framer-motion'
import { useRef, useState } from 'react'
import { Button, Input } from '@/components/ui'
import type { LoyaltyCardCreate } from '@/api/cards'

interface CreateCardSheetProps {
  open: boolean
  onClose: () => void
  onSubmit: (card: LoyaltyCardCreate) => void
  isPending: boolean
}

const FORMATS = [
  { value: 'code128' as const, label: 'Code 128' },
  { value: 'ean13' as const, label: 'EAN-13' },
  { value: 'qr' as const, label: 'QR Code' },
  { value: 'code39' as const, label: 'Code 39' },
]

const COLORS = [
  '#6C5CE7', '#0984E3', '#00B894', '#FDCB6E',
  '#E17055', '#D63031', '#E84393', '#2D3436',
  '#636E72', '#00CEC9', '#55EFC4', '#FAB1A0',
]

export function CreateCardSheet({ open, onClose, onSubmit, isPending }: CreateCardSheetProps) {
  const nameRef = useRef<HTMLInputElement>(null)
  const [storeName, setStoreName] = useState('')
  const [barcodeNumber, setBarcodeNumber] = useState('')
  const [barcodeFormat, setBarcodeFormat] = useState<LoyaltyCardCreate['barcode_format']>('code128')
  const [color, setColor] = useState(COLORS[0])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!storeName.trim() || !barcodeNumber.trim()) return
    onSubmit({
      store_name: storeName.trim(),
      barcode_number: barcodeNumber.trim(),
      barcode_format: barcodeFormat,
      color,
    })
    setStoreName('')
    setBarcodeNumber('')
    setBarcodeFormat('code128')
    setColor(COLORS[0])
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/30 z-40"
            onClick={onClose}
          />
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            onAnimationComplete={(def: { y?: string | number }) => {
              if (def.y === 0) nameRef.current?.focus()
            }}
            className="fixed bottom-0 left-0 right-0 bg-surface rounded-t-3xl p-6 pb-[env(safe-area-inset-bottom)] z-50 max-w-lg mx-auto max-h-[85vh] overflow-y-auto"
          >
            <div className="w-12 h-1.5 bg-text/10 rounded-full mx-auto mb-6" />
            <h2 className="text-xl font-bold text-text mb-4">New loyalty card</h2>

            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <Input
                ref={nameRef}
                label="Store name"
                value={storeName}
                onChange={(e) => setStoreName(e.target.value)}
                placeholder="e.g. Albert Heijn, Kruidvat"
              />

              <Input
                label="Barcode number"
                value={barcodeNumber}
                onChange={(e) => setBarcodeNumber(e.target.value)}
                placeholder="e.g. 2620012345678"
              />

              {/* Barcode format */}
              <div>
                <label className="text-sm font-medium text-text-muted mb-2 block">Barcode format</label>
                <div className="flex gap-2 flex-wrap">
                  {FORMATS.map((f) => (
                    <button
                      key={f.value}
                      type="button"
                      onClick={() => setBarcodeFormat(f.value)}
                      className={`
                        px-3 py-2 rounded-xl text-sm font-medium transition-all
                        ${barcodeFormat === f.value
                          ? 'bg-primary text-white shadow-md'
                          : 'bg-text/5 text-text-muted'
                        }
                      `}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Color picker */}
              <div>
                <label className="text-sm font-medium text-text-muted mb-2 block">Card color</label>
                <div className="flex gap-2 flex-wrap">
                  {COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setColor(c)}
                      className={`
                        w-9 h-9 rounded-full transition-all
                        ${color === c ? 'ring-2 ring-offset-2 ring-primary ring-offset-surface scale-110' : 'hover:scale-105'}
                      `}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>

              <Button type="submit" disabled={isPending || !storeName.trim() || !barcodeNumber.trim()}>
                {isPending ? 'Creating...' : 'Create card'}
              </Button>
            </form>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
```

**Step 3: Create the edit-card bottom sheet**

Create `frontend/src/components/cards/edit-card-sheet.tsx`:

Follows the `EditListSheet` pattern — syncs state via useEffect, two-step delete:

```tsx
import { motion, AnimatePresence } from 'framer-motion'
import { useState, useEffect } from 'react'
import { Button, Input } from '@/components/ui'
import type { LoyaltyCard, LoyaltyCardUpdate } from '@/api/cards'

interface EditCardSheetProps {
  card: LoyaltyCard | null
  open: boolean
  onClose: () => void
  onSubmit: (update: LoyaltyCardUpdate & { cardId: string }) => void
  onDelete: (cardId: string) => void
  isPending: boolean
}

const FORMATS = [
  { value: 'code128' as const, label: 'Code 128' },
  { value: 'ean13' as const, label: 'EAN-13' },
  { value: 'qr' as const, label: 'QR Code' },
  { value: 'code39' as const, label: 'Code 39' },
]

const COLORS = [
  '#6C5CE7', '#0984E3', '#00B894', '#FDCB6E',
  '#E17055', '#D63031', '#E84393', '#2D3436',
  '#636E72', '#00CEC9', '#55EFC4', '#FAB1A0',
]

export function EditCardSheet({ card, open, onClose, onSubmit, onDelete, isPending }: EditCardSheetProps) {
  const [storeName, setStoreName] = useState('')
  const [barcodeNumber, setBarcodeNumber] = useState('')
  const [barcodeFormat, setBarcodeFormat] = useState<string>('code128')
  const [color, setColor] = useState(COLORS[0])
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    if (!card) return
    setStoreName(card.store_name)
    setBarcodeNumber(card.barcode_number)
    setBarcodeFormat(card.barcode_format)
    setColor(card.color)
    setConfirmDelete(false)
  }, [card])

  if (!card) return null

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault()
    if (!card) return
    onSubmit({
      cardId: card.id,
      store_name: storeName.trim(),
      barcode_number: barcodeNumber.trim(),
      barcode_format: barcodeFormat as LoyaltyCardUpdate['barcode_format'],
      color,
    })
  }

  function handleDeleteClick(): void {
    if (!card) return
    if (confirmDelete) {
      onDelete(card.id)
    } else {
      setConfirmDelete(true)
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/30 z-40"
            onClick={onClose}
          />
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="fixed bottom-0 left-0 right-0 bg-surface rounded-t-3xl p-6 pb-[env(safe-area-inset-bottom)] z-50 max-w-lg mx-auto max-h-[85vh] overflow-y-auto"
          >
            <div className="w-12 h-1.5 bg-text/10 rounded-full mx-auto mb-6" />
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-text">Edit card</h2>
              <button
                type="button"
                onClick={onClose}
                className="p-1.5 -mr-1.5 rounded-full text-text-muted hover:bg-text/5 transition-colors"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <Input
                label="Store name"
                value={storeName}
                onChange={(e) => setStoreName(e.target.value)}
                placeholder="e.g. Albert Heijn, Kruidvat"
              />

              <Input
                label="Barcode number"
                value={barcodeNumber}
                onChange={(e) => setBarcodeNumber(e.target.value)}
                placeholder="e.g. 2620012345678"
              />

              <div>
                <label className="text-sm font-medium text-text-muted mb-2 block">Barcode format</label>
                <div className="flex gap-2 flex-wrap">
                  {FORMATS.map((f) => (
                    <button
                      key={f.value}
                      type="button"
                      onClick={() => setBarcodeFormat(f.value)}
                      className={`
                        px-3 py-2 rounded-xl text-sm font-medium transition-all
                        ${barcodeFormat === f.value
                          ? 'bg-primary text-white shadow-md'
                          : 'bg-text/5 text-text-muted'
                        }
                      `}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-sm font-medium text-text-muted mb-2 block">Card color</label>
                <div className="flex gap-2 flex-wrap">
                  {COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setColor(c)}
                      className={`
                        w-9 h-9 rounded-full transition-all
                        ${color === c ? 'ring-2 ring-offset-2 ring-primary ring-offset-surface scale-110' : 'hover:scale-105'}
                      `}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>

              <div className="flex gap-3">
                <Button type="submit" disabled={isPending || !storeName.trim() || !barcodeNumber.trim()} className="flex-1">
                  {isPending ? 'Saving...' : 'Save changes'}
                </Button>
                <Button
                  type="button"
                  variant={confirmDelete ? 'danger' : 'ghost'}
                  onClick={handleDeleteClick}
                  disabled={isPending}
                >
                  {confirmDelete ? 'Confirm' : 'Delete'}
                </Button>
              </div>
            </form>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
```

**Step 4: Commit**

```bash
git add frontend/src/components/cards/
git commit -m "feat: add loyalty card UI components (card tile, create/edit sheets)"
```

---

### Task 7: Frontend — Routes (List Page + Detail Page)

**Files:**
- Create: `frontend/src/routes/cards.tsx`
- Create: `frontend/src/routes/cards.index.tsx`
- Create: `frontend/src/routes/cards.$cardId.tsx`

**Step 1: Create parent route**

Create `frontend/src/routes/cards.tsx`:

```tsx
import { createFileRoute, Outlet } from '@tanstack/react-router'

export const Route = createFileRoute('/cards')({
  component: () => <Outlet />,
})
```

**Step 2: Create list page**

Create `frontend/src/routes/cards.index.tsx`:

```tsx
import { createFileRoute, Navigate, useNavigate } from '@tanstack/react-router'
import { useAuth } from 'react-oidc-context'
import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useHouseholds } from '@/api/households'
import { useLoyaltyCards, useCreateLoyaltyCard } from '@/api/cards'
import { LoyaltyCardCard } from '@/components/cards/loyalty-card-card'
import { CreateCardSheet } from '@/components/cards/create-card-sheet'
import { Fab, Card } from '@/components/ui'

export const Route = createFileRoute('/cards/')({
  component: CardsPage,
})

function CardsPage() {
  const auth = useAuth()
  const { data: households } = useHouseholds()
  const [showCreate, setShowCreate] = useState(false)

  if (!auth.isAuthenticated) return <Navigate to="/login" />
  if (!households?.length) return <Navigate to="/onboarding" />

  const householdId = households[0].id

  return (
    <CardsContent
      householdId={householdId}
      showCreate={showCreate}
      setShowCreate={setShowCreate}
    />
  )
}

function CardsContent({
  householdId,
  showCreate,
  setShowCreate,
}: {
  householdId: string
  showCreate: boolean
  setShowCreate: (v: boolean) => void
}) {
  const navigate = useNavigate()
  const { data: cards, isLoading } = useLoyaltyCards(householdId)
  const createMutation = useCreateLoyaltyCard(householdId)

  return (
    <div className="pb-4">
      <h1 className="text-2xl font-extrabold text-text mt-2 mb-4">Cards</h1>

      {isLoading ? (
        <div className="grid grid-cols-2 gap-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-36 bg-surface rounded-2xl animate-pulse" />
          ))}
        </div>
      ) : !cards?.length ? (
        <Card className="text-center py-8">
          <p className="text-4xl mb-3">&#128179;</p>
          <p className="font-semibold text-text">No loyalty cards yet</p>
          <p className="text-sm text-text-muted mt-1">Tap + to add your first card.</p>
        </Card>
      ) : (
        <motion.div className="grid grid-cols-2 gap-3">
          <AnimatePresence>
            {cards.map((card, i) => (
              <motion.div
                key={card.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={{ delay: i * 0.05 }}
              >
                <LoyaltyCardCard
                  card={card}
                  onClick={() => navigate({ to: '/cards/$cardId', params: { cardId: card.id } })}
                />
              </motion.div>
            ))}
          </AnimatePresence>
        </motion.div>
      )}

      <Fab pulse={!cards?.length} onClick={() => setShowCreate(true)}>
        +
      </Fab>

      <CreateCardSheet
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onSubmit={async (card) => {
          await createMutation.mutateAsync(card)
          setShowCreate(false)
        }}
        isPending={createMutation.isPending}
      />
    </div>
  )
}
```

**Step 3: Create detail page**

Create `frontend/src/routes/cards.$cardId.tsx`:

Full-screen card view with large barcode for scanning. Back button, edit button, colored background:

```tsx
import { createFileRoute, Navigate, useNavigate } from '@tanstack/react-router'
import { useAuth } from 'react-oidc-context'
import { useState } from 'react'
import { useHouseholds } from '@/api/households'
import { useLoyaltyCards, useUpdateLoyaltyCard, useDeleteLoyaltyCard } from '@/api/cards'
import { BarcodeDisplay } from '@/components/cards/barcode-display'
import { EditCardSheet } from '@/components/cards/edit-card-sheet'
import { Card } from '@/components/ui'

export const Route = createFileRoute('/cards/$cardId')({
  component: CardDetailPage,
})

function textColor(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return lum > 0.5 ? '#1a1a1a' : '#ffffff'
}

function CardDetailPage() {
  const auth = useAuth()
  const { data: households } = useHouseholds()
  const { cardId } = Route.useParams()

  if (!auth.isAuthenticated) return <Navigate to="/login" />
  if (!households?.length) return <Navigate to="/onboarding" />

  const householdId = households[0].id

  return <CardDetailContent householdId={householdId} cardId={cardId} />
}

function CardDetailContent({ householdId, cardId }: { householdId: string; cardId: string }) {
  const navigate = useNavigate()
  const { data: cards, isLoading } = useLoyaltyCards(householdId)
  const card = cards?.find((c) => c.id === cardId) ?? null
  const updateMutation = useUpdateLoyaltyCard(householdId)
  const deleteMutation = useDeleteLoyaltyCard(householdId)
  const [showEdit, setShowEdit] = useState(false)

  if (isLoading) {
    return (
      <div className="pb-4">
        <div className="h-10 bg-surface rounded-xl animate-pulse mt-2 mb-4" />
        <div className="h-64 bg-surface rounded-2xl animate-pulse" />
      </div>
    )
  }

  if (cards && !card) {
    return (
      <div className="pb-4">
        <div className="flex items-center gap-3 mt-2 mb-4">
          <button
            onClick={() => navigate({ to: '/cards' })}
            className="p-1.5 -ml-1.5 rounded-full text-text-muted hover:bg-text/5 transition-colors"
            aria-label="Back to cards"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
          <h1 className="text-2xl font-extrabold text-text">Card not found</h1>
        </div>
        <Card className="text-center py-8">
          <p className="font-semibold text-text">This card no longer exists</p>
          <p className="text-sm text-text-muted mt-1">It may have been deleted.</p>
        </Card>
      </div>
    )
  }

  if (!card) return null

  const fg = textColor(card.color)

  return (
    <div className="pb-4">
      {/* Header */}
      <div className="flex items-center gap-3 mt-2 mb-4">
        <button
          onClick={() => navigate({ to: '/cards' })}
          className="p-1.5 -ml-1.5 rounded-full text-text-muted hover:bg-text/5 transition-colors"
          aria-label="Back to cards"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <h1 className="text-2xl font-extrabold text-text flex-1 truncate">
          {card.store_name}
        </h1>
        <button
          onClick={() => setShowEdit(true)}
          className="p-1.5 -mr-1.5 rounded-full text-text-muted hover:bg-text/5 transition-colors"
          aria-label="Edit card"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
            <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
          </svg>
        </button>
      </div>

      {/* Card with barcode */}
      <div
        className="rounded-2xl p-6 flex flex-col items-center gap-4"
        style={{ backgroundColor: card.color, color: fg }}
      >
        <p className="font-bold text-2xl">{card.store_name}</p>

        <div className="w-full bg-white rounded-xl p-4 text-black">
          <BarcodeDisplay value={card.barcode_number} format={card.barcode_format} height={120} />
        </div>

        <p className="text-sm font-mono opacity-80">{card.barcode_number}</p>
      </div>

      {/* Edit sheet */}
      <EditCardSheet
        card={card}
        open={showEdit}
        onClose={() => setShowEdit(false)}
        onSubmit={async (update) => {
          await updateMutation.mutateAsync(update)
          setShowEdit(false)
        }}
        onDelete={async (id) => {
          await deleteMutation.mutateAsync(id)
          navigate({ to: '/cards' })
        }}
        isPending={updateMutation.isPending || deleteMutation.isPending}
      />
    </div>
  )
}
```

**Step 4: Commit**

```bash
git add frontend/src/routes/cards.tsx frontend/src/routes/cards.index.tsx frontend/src/routes/cards.$cardId.tsx
git commit -m "feat: add loyalty cards routes (list + detail pages)"
```

---

### Task 8: Frontend — Bottom Nav Update

**Files:**
- Modify: `frontend/src/components/layout/bottom-nav.tsx`

**Step 1: Add Cards tab**

In `frontend/src/components/layout/bottom-nav.tsx`, add a `CardIcon` component and insert the Cards tab between Lists and More in the `tabs` array:

```typescript
const tabs = [
  { to: '/' as const, label: 'Home', icon: HomeIcon },
  { to: '/tasks' as const, label: 'Reminders', icon: CheckIcon },
  { to: '/calendar' as const, label: 'Calendar', icon: CalendarIcon },
  { to: '/lists' as const, label: 'Lists', icon: ListIcon },
  { to: '/cards' as const, label: 'Cards', icon: CardIcon },
  { to: '/settings' as const, label: 'More', icon: SettingsIcon },
]
```

Add the `CardIcon` SVG component (credit card icon):

```tsx
function CardIcon({ active }: { active: boolean }) {
  const color = active ? '#6C5CE7' : '#636E72'
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1" y="4" width="22" height="16" rx="2" /><line x1="1" y1="10" x2="23" y2="10" />
    </svg>
  )
}
```

**Step 2: Adjust nav spacing for 6 tabs**

Change the tab link padding from `px-4` to `px-2` so 6 tabs fit comfortably:

```tsx
className="flex flex-col items-center gap-1 px-2 py-2 relative"
```

**Step 3: Verify the app builds**

Run: `cd /home/jan/nesto/frontend && npx tsc --noEmit`

**Step 4: Commit**

```bash
git add frontend/src/components/layout/bottom-nav.tsx
git commit -m "feat: add Cards tab to bottom navigation"
```

---

### Task 9: Update CLAUDE.md

**Files:**
- Modify: `/home/jan/nesto/.claude/CLAUDE.md`

**Step 1: Update project documentation**

Add `loyalty_card` to the models list, `cards` to routers, `loyalty_card_service` to services, `cards/` to components, `cards.$cardId` to routes, and the new API endpoints. Update the database table list.

**Step 2: Commit**

```bash
git add .claude/CLAUDE.md
git commit -m "docs: update CLAUDE.md with loyalty cards feature"
```

---

### Task 10: End-to-End Verification

**Step 1: Rebuild and run**

Run: `cd /home/jan/nesto && docker compose down && docker compose up --build -d`

**Step 2: Verify backend**

Run: `docker compose logs backend --tail=30`

Expected: No errors, migration applied, server running.

**Step 3: Verify frontend builds**

Run: `docker compose logs frontend --tail=20`

Expected: Vite build succeeds, no TypeScript errors.

**Step 4: Manual smoke test**

Open the app in browser:
1. Navigate to Cards tab — should show empty state
2. Tap + to create a card — fill in store name, barcode number, pick format and color
3. Card should appear in grid with barcode preview
4. Tap the card — should show full-screen barcode view
5. Edit the card — change color, verify it saves
6. Delete the card — two-step confirmation, returns to list
