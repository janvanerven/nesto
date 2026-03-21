# Documents Feature Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add household document storage with file uploads, two-category tagging (type + subject), and a "More" tab in the bottom nav.

**Architecture:** Files stored on filesystem (`data/documents/`), metadata + tags in SQLite. Image thumbnails generated server-side with Pillow. Multipart upload endpoint. Frontend with tag-based filtering and inline image preview.

**Tech Stack:** `Pillow` (backend), no new frontend deps.

**Design doc:** `docs/plans/2026-03-21-documents-design.md`

---

### Task 1: Add Pillow dependency

**Files:**
- Modify: `backend/pyproject.toml:16`

**Step 1: Add Pillow to dependencies**

Add after the `"cryptography>=43.0.0"` line:

```toml
    "Pillow>=11.0.0",
```

**Step 2: Install in dev container**

Run: `docker compose -f docker-compose.yml exec backend pip install Pillow`
Expected: Successfully installed Pillow.

**Step 3: Verify**

Run: `docker compose -f docker-compose.yml exec backend python -c "from PIL import Image; print('OK')"`
Expected: `OK`

**Step 4: Commit**

```bash
git add backend/pyproject.toml
git commit -m "chore: add Pillow dependency for document thumbnails"
```

---

### Task 2: Create data models

**Files:**
- Create: `backend/app/models/document.py`
- Modify: `backend/app/models/__init__.py`

**Step 1: Create Document, DocumentTag, and DocumentTagLink models**

Create `backend/app/models/document.py`:

```python
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class Document(Base):
    __tablename__ = "documents"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    household_id: Mapped[str] = mapped_column(Text, ForeignKey("households.id", ondelete="CASCADE"), nullable=False)
    uploaded_by: Mapped[str] = mapped_column(Text, ForeignKey("users.id"), nullable=False)
    filename: Mapped[str] = mapped_column(Text, nullable=False)
    storage_path: Mapped[str] = mapped_column(Text, nullable=False)
    mime_type: Mapped[str] = mapped_column(Text, nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class DocumentTag(Base):
    __tablename__ = "document_tags"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    household_id: Mapped[str] = mapped_column(Text, ForeignKey("households.id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    category: Mapped[str] = mapped_column(Text, nullable=False)  # "type" or "subject"


class DocumentTagLink(Base):
    __tablename__ = "document_tag_links"
    __table_args__ = (
        UniqueConstraint("document_id", "tag_id", name="uq_document_tag_links"),
    )

    document_id: Mapped[str] = mapped_column(
        Text, ForeignKey("documents.id", ondelete="CASCADE"), primary_key=True
    )
    tag_id: Mapped[str] = mapped_column(
        Text, ForeignKey("document_tags.id", ondelete="CASCADE"), primary_key=True
    )
```

**Step 2: Update models/__init__.py**

Add import and exports:

```python
from app.models.document import Document, DocumentTag, DocumentTagLink
```

Add `"Document"`, `"DocumentTag"`, `"DocumentTagLink"` to `__all__`.

**Step 3: Verify models load**

Run: `docker compose -f docker-compose.yml exec backend python -c "from app.models import Document, DocumentTag, DocumentTagLink; print('OK')"`
Expected: `OK`

**Step 4: Commit**

```bash
git add backend/app/models/document.py backend/app/models/__init__.py
git commit -m "feat: add Document, DocumentTag, DocumentTagLink models"
```

---

### Task 3: Create Alembic migration

**Files:**
- Create: `backend/alembic/versions/<auto>_add_documents_tables.py`

**Step 1: Generate migration**

Run: `docker compose -f docker-compose.yml exec backend alembic revision --autogenerate -m "add documents tables"`

**Step 2: Review and clean the generated migration**

The autogenerate will detect spurious index drops on other tables (SQLite naming mismatch). Edit the migration to ONLY contain:
- `create_table('documents', ...)` with all columns
- `create_table('document_tags', ...)` with all columns
- `create_table('document_tag_links', ...)` with composite PK and unique constraint
- Indexes on `documents.household_id`, `document_tags.household_id`, `document_tag_links.document_id`, `document_tag_links.tag_id`

Remove ALL other operations (index drops on existing tables).

**Step 3: Run migration**

Run: `docker compose -f docker-compose.yml exec backend alembic upgrade head`
Expected: No errors.

**Step 4: Verify tables exist**

Run: `docker compose -f docker-compose.yml exec backend python -c "import sqlite3; c=sqlite3.connect('data/nesto.db'); print([t[0] for t in c.execute(\"SELECT name FROM sqlite_master WHERE type='table'\").fetchall()])"`
Expected: List includes `documents`, `document_tags`, `document_tag_links`.

**Step 5: Commit**

```bash
git add backend/alembic/versions/
git commit -m "feat: add documents migration"
```

---

### Task 4: Create backend schemas

**Files:**
- Create: `backend/app/schemas/document.py`

**Step 1: Create schemas**

Create `backend/app/schemas/document.py`:

```python
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class DocumentTagCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    category: Literal["type", "subject"]


class DocumentTagResponse(BaseModel):
    id: str
    household_id: str
    name: str
    category: str

    model_config = {"from_attributes": True}


class DocumentResponse(BaseModel):
    id: str
    household_id: str
    uploaded_by: str
    filename: str
    mime_type: str
    size_bytes: int
    created_at: datetime
    tags: list[DocumentTagResponse] = []
    has_thumbnail: bool = False

    model_config = {"from_attributes": True}


class DocumentUpdate(BaseModel):
    filename: str | None = Field(default=None, min_length=1, max_length=500)
    tag_ids: list[str] | None = None
```

**Step 2: Commit**

```bash
git add backend/app/schemas/document.py
git commit -m "feat: add document Pydantic schemas"
```

---

### Task 5: Create document service

**Files:**
- Create: `backend/app/services/document_service.py`

**Step 1: Write the implementation**

Create `backend/app/services/document_service.py`:

```python
import logging
import os
import shutil
import uuid

from fastapi import HTTPException, UploadFile
from PIL import Image
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.document import Document, DocumentTag, DocumentTagLink

logger = logging.getLogger(__name__)

DOCUMENTS_DIR = "data/documents"
MAX_FILE_SIZE = 25 * 1024 * 1024  # 25 MB
ALLOWED_MIME_TYPES = {"image/jpeg", "image/png", "image/webp", "application/pdf"}
THUMBNAIL_WIDTH = 400


async def list_documents(
    db: AsyncSession,
    household_id: str,
    type_tag: str | None = None,
    subject_tag: str | None = None,
    search: str | None = None,
) -> list[dict]:
    query = select(Document).where(Document.household_id == household_id)

    if search:
        query = query.where(Document.filename.ilike(f"%{search}%"))

    # Apply tag filters via subqueries
    if type_tag:
        query = query.where(
            Document.id.in_(
                select(DocumentTagLink.document_id)
                .join(DocumentTag, DocumentTag.id == DocumentTagLink.tag_id)
                .where(DocumentTag.id == type_tag)
            )
        )
    if subject_tag:
        query = query.where(
            Document.id.in_(
                select(DocumentTagLink.document_id)
                .join(DocumentTag, DocumentTag.id == DocumentTagLink.tag_id)
                .where(DocumentTag.id == subject_tag)
            )
        )

    query = query.order_by(Document.created_at.desc())
    result = await db.execute(query)
    documents = result.scalars().all()

    # Fetch tags for all documents in one query
    doc_ids = [d.id for d in documents]
    if doc_ids:
        tag_links_result = await db.execute(
            select(DocumentTagLink, DocumentTag)
            .join(DocumentTag, DocumentTag.id == DocumentTagLink.tag_id)
            .where(DocumentTagLink.document_id.in_(doc_ids))
        )
        tag_map: dict[str, list[DocumentTag]] = {}
        for link, tag in tag_links_result.all():
            tag_map.setdefault(link.document_id, []).append(tag)
    else:
        tag_map = {}

    return [
        {
            "id": doc.id,
            "household_id": doc.household_id,
            "uploaded_by": doc.uploaded_by,
            "filename": doc.filename,
            "mime_type": doc.mime_type,
            "size_bytes": doc.size_bytes,
            "created_at": doc.created_at,
            "tags": [
                {"id": t.id, "household_id": t.household_id, "name": t.name, "category": t.category}
                for t in tag_map.get(doc.id, [])
            ],
            "has_thumbnail": doc.mime_type.startswith("image/"),
        }
        for doc in documents
    ]


async def create_document(
    db: AsyncSession,
    household_id: str,
    user_id: str,
    file: UploadFile,
    tag_ids: list[str],
) -> Document:
    # Validate mime type
    if file.content_type not in ALLOWED_MIME_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"File type not allowed. Allowed: {', '.join(ALLOWED_MIME_TYPES)}",
        )

    # Read file content
    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(status_code=400, detail="File too large. Max 25 MB.")

    doc_id = str(uuid.uuid4())
    filename = file.filename or "unnamed"
    # Sanitize filename
    filename = os.path.basename(filename)[:200]

    # Create directory
    doc_dir = os.path.join(DOCUMENTS_DIR, household_id, doc_id)
    os.makedirs(doc_dir, exist_ok=True)

    # Write file
    file_path = os.path.join(doc_dir, filename)
    with open(file_path, "wb") as f:
        f.write(content)

    # Generate thumbnail for images
    if file.content_type and file.content_type.startswith("image/"):
        try:
            _generate_thumbnail(file_path, doc_dir, filename)
        except Exception as e:
            logger.warning("Failed to generate thumbnail for %s: %s", doc_id, e)

    # Create DB record
    storage_path = os.path.join(household_id, doc_id, filename)
    doc = Document(
        id=doc_id,
        household_id=household_id,
        uploaded_by=user_id,
        filename=filename,
        storage_path=storage_path,
        mime_type=file.content_type or "application/octet-stream",
        size_bytes=len(content),
    )
    db.add(doc)

    # Link tags
    for tag_id in tag_ids:
        db.add(DocumentTagLink(document_id=doc_id, tag_id=tag_id))

    await db.commit()
    await db.refresh(doc)
    return doc


async def get_document(db: AsyncSession, doc_id: str, household_id: str) -> Document:
    result = await db.execute(
        select(Document).where(
            Document.id == doc_id,
            Document.household_id == household_id,
        )
    )
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    return doc


async def update_document(
    db: AsyncSession, doc_id: str, household_id: str, filename: str | None, tag_ids: list[str] | None
) -> Document:
    doc = await get_document(db, doc_id, household_id)

    if filename is not None:
        # Rename file on disk
        old_path = os.path.join(DOCUMENTS_DIR, doc.storage_path)
        new_filename = os.path.basename(filename)[:200]
        new_storage_path = os.path.join(household_id, doc_id, new_filename)
        new_path = os.path.join(DOCUMENTS_DIR, new_storage_path)
        if old_path != new_path and os.path.exists(old_path):
            os.rename(old_path, new_path)
            # Rename thumbnail too if it exists
            old_thumb = os.path.join(DOCUMENTS_DIR, household_id, doc_id, f"thumb_{doc.filename}")
            new_thumb = os.path.join(DOCUMENTS_DIR, household_id, doc_id, f"thumb_{new_filename}")
            if os.path.exists(old_thumb):
                os.rename(old_thumb, new_thumb)
        doc.filename = new_filename
        doc.storage_path = new_storage_path

    if tag_ids is not None:
        # Replace all tag links
        existing = await db.execute(
            select(DocumentTagLink).where(DocumentTagLink.document_id == doc_id)
        )
        for link in existing.scalars().all():
            await db.delete(link)
        for tag_id in tag_ids:
            db.add(DocumentTagLink(document_id=doc_id, tag_id=tag_id))

    await db.commit()
    await db.refresh(doc)
    return doc


async def delete_document(db: AsyncSession, doc_id: str, household_id: str) -> None:
    doc = await get_document(db, doc_id, household_id)

    # Delete files from disk
    doc_dir = os.path.join(DOCUMENTS_DIR, household_id, doc_id)
    if os.path.exists(doc_dir):
        shutil.rmtree(doc_dir)

    await db.delete(doc)
    await db.commit()


def get_file_path(doc: Document) -> str:
    return os.path.join(DOCUMENTS_DIR, doc.storage_path)


def get_thumbnail_path(doc: Document) -> str | None:
    thumb_path = os.path.join(DOCUMENTS_DIR, doc.household_id, doc.id, f"thumb_{doc.filename}")
    if os.path.exists(thumb_path):
        return thumb_path
    return None


def _generate_thumbnail(file_path: str, doc_dir: str, filename: str) -> None:
    with Image.open(file_path) as img:
        img.thumbnail((THUMBNAIL_WIDTH, THUMBNAIL_WIDTH * 2))
        thumb_path = os.path.join(doc_dir, f"thumb_{filename}")
        if img.mode in ("RGBA", "P"):
            img = img.convert("RGB")
        img.save(thumb_path, "JPEG", quality=80)


# --- Tag operations ---

async def list_tags(db: AsyncSession, household_id: str) -> list[DocumentTag]:
    result = await db.execute(
        select(DocumentTag)
        .where(DocumentTag.household_id == household_id)
        .order_by(DocumentTag.category.asc(), DocumentTag.name.asc())
    )
    return list(result.scalars().all())


async def create_tag(db: AsyncSession, household_id: str, name: str, category: str) -> DocumentTag:
    tag = DocumentTag(
        id=str(uuid.uuid4()),
        household_id=household_id,
        name=name,
        category=category,
    )
    db.add(tag)
    await db.commit()
    await db.refresh(tag)
    return tag


async def delete_tag(db: AsyncSession, tag_id: str, household_id: str) -> None:
    result = await db.execute(
        select(DocumentTag).where(
            DocumentTag.id == tag_id,
            DocumentTag.household_id == household_id,
        )
    )
    tag = result.scalar_one_or_none()
    if not tag:
        raise HTTPException(status_code=404, detail="Tag not found")
    await db.delete(tag)
    await db.commit()
```

**Step 2: Create the documents directory**

Add to `backend/app/main.py` lifespan, after `os.makedirs("data", exist_ok=True)`:

```python
    os.makedirs("data/documents", exist_ok=True)
```

**Step 3: Commit**

```bash
git add backend/app/services/document_service.py backend/app/main.py
git commit -m "feat: add document service with file storage and thumbnail generation"
```

---

### Task 6: Create backend router

**Files:**
- Create: `backend/app/routers/documents.py`
- Modify: `backend/app/main.py`

**Step 1: Create the router**

Create `backend/app/routers/documents.py`:

```python
import json
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, Query, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user_id
from app.database import get_db
from app.schemas.document import (
    DocumentResponse,
    DocumentTagCreate,
    DocumentTagResponse,
    DocumentUpdate,
)
from app.services import document_service as svc
from app.services.household_service import get_household

router = APIRouter(prefix="/api/households/{household_id}/documents", tags=["documents"])
tags_router = APIRouter(prefix="/api/households/{household_id}/document-tags", tags=["documents"])


@router.get("", response_model=list[DocumentResponse])
async def list_documents(
    household_id: str,
    type_tag: Optional[str] = Query(None),
    subject_tag: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    await get_household(db, household_id, user_id)
    return await svc.list_documents(db, household_id, type_tag, subject_tag, search)


@router.post("", response_model=DocumentResponse, status_code=201)
async def upload_document(
    household_id: str,
    file: UploadFile = File(...),
    metadata: str = Form(default="{}"),
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    await get_household(db, household_id, user_id)
    meta = json.loads(metadata)
    tag_ids = meta.get("tags", [])
    doc = await svc.create_document(db, household_id, user_id, file, tag_ids)

    # Fetch full response with tags
    docs = await svc.list_documents(db, household_id)
    return next((d for d in docs if d["id"] == doc.id), doc)


@router.get("/{doc_id}", response_model=DocumentResponse)
async def get_document(
    household_id: str,
    doc_id: str,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    await get_household(db, household_id, user_id)
    docs = await svc.list_documents(db, household_id)
    doc = next((d for d in docs if d["id"] == doc_id), None)
    if not doc:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Document not found")
    return doc


@router.get("/{doc_id}/file")
async def get_document_file(
    household_id: str,
    doc_id: str,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    await get_household(db, household_id, user_id)
    doc = await svc.get_document(db, doc_id, household_id)
    file_path = svc.get_file_path(doc)
    return FileResponse(file_path, filename=doc.filename, media_type=doc.mime_type)


@router.get("/{doc_id}/thumbnail")
async def get_document_thumbnail(
    household_id: str,
    doc_id: str,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    await get_household(db, household_id, user_id)
    doc = await svc.get_document(db, doc_id, household_id)
    thumb_path = svc.get_thumbnail_path(doc)
    if not thumb_path:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="No thumbnail available")
    return FileResponse(thumb_path, media_type="image/jpeg")


@router.patch("/{doc_id}", response_model=DocumentResponse)
async def update_document(
    household_id: str,
    doc_id: str,
    body: DocumentUpdate,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    await get_household(db, household_id, user_id)
    await svc.update_document(db, doc_id, household_id, body.filename, body.tag_ids)
    docs = await svc.list_documents(db, household_id)
    return next((d for d in docs if d["id"] == doc_id), None)


@router.delete("/{doc_id}", status_code=204)
async def delete_document(
    household_id: str,
    doc_id: str,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    await get_household(db, household_id, user_id)
    await svc.delete_document(db, doc_id, household_id)


# --- Tags ---

@tags_router.get("", response_model=list[DocumentTagResponse])
async def list_tags(
    household_id: str,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    await get_household(db, household_id, user_id)
    return await svc.list_tags(db, household_id)


@tags_router.post("", response_model=DocumentTagResponse, status_code=201)
async def create_tag(
    household_id: str,
    body: DocumentTagCreate,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    await get_household(db, household_id, user_id)
    return await svc.create_tag(db, household_id, body.name, body.category)


@tags_router.delete("/{tag_id}", status_code=204)
async def delete_tag(
    household_id: str,
    tag_id: str,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    await get_household(db, household_id, user_id)
    await svc.delete_tag(db, tag_id, household_id)
```

**Step 2: Register routers in main.py**

Add import:
```python
from app.routers import auth, calendar_sync, documents, events, households, loyalty_cards, shopping_lists, tasks
```

Add after existing router registrations:
```python
app.include_router(documents.router)
app.include_router(documents.tags_router)
```

**Step 3: Verify app loads**

Run: `docker compose -f docker-compose.yml exec backend python -c "from app.main import app; print('OK', len(app.routes))"`
Expected: Route count increased.

**Step 4: Commit**

```bash
git add backend/app/routers/documents.py backend/app/main.py
git commit -m "feat: add documents API routes (CRUD + tags + file serving)"
```

---

### Task 7: Update nginx for large uploads

**Files:**
- Modify: `nginx/nginx.conf`

**Step 1: Add a scoped location block for document uploads with 25MB limit**

In `nginx/nginx.conf`, add BEFORE the existing `/api/` location block:

```nginx
    # Document uploads — higher size limit
    location ~ ^/api/households/[^/]+/documents$ {
        client_max_body_size 25m;
        limit_req zone=api burst=10 nodelay;
        proxy_pass http://backend:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_connect_timeout 10s;
        proxy_read_timeout 60s;
        proxy_send_timeout 60s;
    }
```

**Step 2: Commit**

```bash
git add nginx/nginx.conf
git commit -m "ops: allow 25MB uploads for document endpoint in nginx"
```

---

### Task 8: Update docker-compose for document storage

**Files:**
- Modify: `docker-compose.prod.yml`

**Step 1: Add documents directory to backup service**

The documents are already on the `nesto-data` volume (backend writes to `data/documents/`). The backup service mounts `nesto-data:/data:ro`, so documents at `/data/documents/` are accessible. Update the backup entrypoint to also copy documents:

Replace the existing backup entrypoint with:

```yaml
    entrypoint: >
      sh -c 'apk add --no-cache sqlite && while true; do
        sqlite3 /data/nesto.db ".backup /backup/nesto-$$(date +%Y%m%d-%H%M).db";
        if [ -d /data/documents ]; then
          cp -r /data/documents /backup/documents;
        fi;
        find /backup -name "*.db" -mtime +7 -delete;
        sleep 86400;
      done'
```

**Step 2: Commit**

```bash
git add docker-compose.prod.yml
git commit -m "ops: include documents directory in backup service"
```

---

### Task 9: Create frontend API hooks

**Files:**
- Create: `frontend/src/api/documents.ts`

**Step 1: Create the API module**

Create `frontend/src/api/documents.ts`:

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch, hasToken } from './client'

export interface DocumentTag {
  id: string
  household_id: string
  name: string
  category: 'type' | 'subject'
}

export interface Document {
  id: string
  household_id: string
  uploaded_by: string
  filename: string
  mime_type: string
  size_bytes: number
  created_at: string
  tags: DocumentTag[]
  has_thumbnail: boolean
}

export interface DocumentTagCreate {
  name: string
  category: 'type' | 'subject'
}

export function useDocuments(
  householdId: string,
  filters?: { type_tag?: string; subject_tag?: string; search?: string },
) {
  const params = new URLSearchParams()
  if (filters?.type_tag) params.set('type_tag', filters.type_tag)
  if (filters?.subject_tag) params.set('subject_tag', filters.subject_tag)
  if (filters?.search) params.set('search', filters.search)
  const qs = params.toString()
  return useQuery({
    queryKey: ['documents', householdId, filters],
    queryFn: () =>
      apiFetch<Document[]>(`/households/${householdId}/documents${qs ? `?${qs}` : ''}`),
    enabled: !!householdId && hasToken(),
  })
}

export function useUploadDocument(householdId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ file, tagIds }: { file: File; tagIds: string[] }) => {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('metadata', JSON.stringify({ tags: tagIds }))

      const { getStoredOidcUser } = await import('./client')
      const user = getStoredOidcUser()
      const token = user?.access_token

      const res = await fetch(`/api/households/${householdId}/documents`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: 'Upload failed' }))
        throw new Error(err.detail || 'Upload failed')
      }
      return res.json() as Promise<Document>
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['documents', householdId] }),
  })
}

export function useUpdateDocument(householdId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ docId, ...data }: { docId: string; filename?: string; tag_ids?: string[] }) =>
      apiFetch<Document>(`/households/${householdId}/documents/${docId}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['documents', householdId] }),
  })
}

export function useDeleteDocument(householdId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (docId: string) =>
      apiFetch<void>(`/households/${householdId}/documents/${docId}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['documents', householdId] }),
  })
}

export function useDocumentTags(householdId: string) {
  return useQuery({
    queryKey: ['document-tags', householdId],
    queryFn: () => apiFetch<DocumentTag[]>(`/households/${householdId}/document-tags`),
    enabled: !!householdId && hasToken(),
  })
}

export function useCreateDocumentTag(householdId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: DocumentTagCreate) =>
      apiFetch<DocumentTag>(`/households/${householdId}/document-tags`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['document-tags', householdId] }),
  })
}

export function useDeleteDocumentTag(householdId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (tagId: string) =>
      apiFetch<void>(`/households/${householdId}/document-tags/${tagId}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['document-tags', householdId] })
      qc.invalidateQueries({ queryKey: ['documents', householdId] })
    },
  })
}

export function getDocumentFileUrl(householdId: string, docId: string): string {
  return `/api/households/${householdId}/documents/${docId}/file`
}

export function getDocumentThumbnailUrl(householdId: string, docId: string): string {
  return `/api/households/${householdId}/documents/${docId}/thumbnail`
}
```

**Step 2: Commit**

```bash
git add frontend/src/api/documents.ts
git commit -m "feat: add frontend API hooks for documents"
```

---

### Task 10: Rework bottom nav to "More" pattern

**Files:**
- Modify: `frontend/src/components/layout/bottom-nav.tsx`
- Create: `frontend/src/routes/more.tsx`

**Step 1: Update bottom-nav.tsx**

Replace the `tabs` array and `SettingsIcon` with a "More" tab using a grid icon. The tabs become: Home, Reminders, Calendar, Lists, More. The "More" route is `/more`. The `isActive` check for More should also match `/cards`, `/settings`, and `/documents`.

Replace the tabs array:
```typescript
const tabs = [
  { to: '/' as const, label: 'Home', icon: HomeIcon },
  { to: '/tasks' as const, label: 'Reminders', icon: CheckIcon },
  { to: '/calendar' as const, label: 'Calendar', icon: CalendarIcon },
  { to: '/lists' as const, label: 'Lists', icon: ListIcon },
  { to: '/more' as const, label: 'More', icon: MoreIcon },
]
```

Update the `isActive` check to also match sub-pages for More:
```typescript
const isActive = currentPath === tab.to
  || (tab.to !== '/' && currentPath.startsWith(tab.to))
  || (tab.to === '/more' && ['/cards', '/settings', '/documents'].some(p => currentPath.startsWith(p)))
```

Replace `SettingsIcon` and `CardIcon` with `MoreIcon`:
```typescript
function MoreIcon({ active }: { active: boolean }) {
  return (
    <svg
      width="24" height="24" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      className={active ? 'text-primary' : 'text-text-muted'}
    >
      <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  )
}
```

Remove `CardIcon` and `SettingsIcon` functions (no longer used).

**Step 2: Create the More page**

Create `frontend/src/routes/more.tsx`:

```tsx
import { createFileRoute, Navigate, Link } from '@tanstack/react-router'
import { useAuth } from 'react-oidc-context'
import { Card } from '@/components/ui'

export const Route = createFileRoute('/more')({
  component: MorePage,
})

const items = [
  {
    to: '/cards' as const,
    label: 'Loyalty Cards',
    description: 'Store and scan your loyalty cards',
    icon: '💳',
  },
  {
    to: '/documents' as const,
    label: 'Documents',
    description: 'Warranties, receipts, and manuals',
    icon: '📄',
  },
  {
    to: '/settings' as const,
    label: 'Settings',
    description: 'Profile, household, and preferences',
    icon: '⚙️',
  },
]

function MorePage() {
  const auth = useAuth()
  if (!auth.isAuthenticated) return <Navigate to="/login" />

  return (
    <div className="pb-4">
      <h1 className="text-2xl font-extrabold text-text mt-2 mb-4">More</h1>
      <div className="space-y-3">
        {items.map((item) => (
          <Link key={item.to} to={item.to}>
            <Card interactive className="flex items-center gap-4">
              <span className="text-2xl">{item.icon}</span>
              <div>
                <p className="font-semibold text-text">{item.label}</p>
                <p className="text-sm text-text-muted">{item.description}</p>
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  )
}
```

**Step 3: Commit**

```bash
git add frontend/src/components/layout/bottom-nav.tsx frontend/src/routes/more.tsx
git commit -m "feat: rework bottom nav to More tab (Cards, Documents, Settings)"
```

---

### Task 11: Create Documents page and routes

**Files:**
- Create: `frontend/src/routes/documents.tsx`

**Step 1: Create the documents route**

Create `frontend/src/routes/documents.tsx` with:
- Document list with thumbnail grid
- Search bar
- Tag filter chips (type tags and subject tags as two separate rows)
- FAB for upload
- Upload bottom sheet with file picker, tag selection, inline tag creation
- Document detail view on tap (image preview or download link)
- Delete with confirmation

This is a large component. Follow the patterns from `cards.index.tsx` for the list page structure, `create-card-sheet.tsx` for the upload sheet, and `cards.$cardId.tsx` for the detail view.

Key patterns to follow:
- `useAuth` + `useHouseholds` guards at top
- `useDocuments(householdId, filters)` for the list
- `useDocumentTags(householdId)` for filter chips
- `useUploadDocument(householdId)` for the upload mutation
- `useDeleteDocument(householdId)` for delete
- `useScrollLock(open)` on the upload sheet
- `AnimatePresence` + `motion.div` for list animations
- `Fab` for the upload button
- Tags displayed as colored pills: type tags in one color, subject tags in another
- Image thumbnails via `getDocumentThumbnailUrl(householdId, docId)` with `<img>` tag
- PDF documents show a PDF icon placeholder
- File download via `getDocumentFileUrl(householdId, docId)` opened in new tab or via `<a download>`
- Inline tag creation in the upload sheet: text input + category selector + "Add" button
- Filter state managed with `useState` for `activeTypeTag` and `activeSubjectTag`

**Step 2: Regenerate route tree**

Run: `cd frontend && npx tsr generate`

**Step 3: Verify TypeScript**

Run: `docker compose -f docker-compose.yml exec frontend npx tsc --noEmit`

**Step 4: Commit**

```bash
git add frontend/src/routes/documents.tsx frontend/src/routeTree.gen.ts
git commit -m "feat: add Documents page with upload, tags, and filtering"
```

---

### Task 12: Update CLAUDE.md

**Files:**
- Modify: `.claude/CLAUDE.md`

**Step 1: Update CLAUDE.md to reflect new feature**

Add to relevant sections:
- Models: add `document`, `document_tag`, `document_tag_link`
- Services: add `document_service`
- Routes: add `documents` router
- API endpoints: add all document and tag endpoints
- Components: note the More page and Documents route
- Frontend API: add `documents.ts`
- Dependencies: add `Pillow`

**Step 2: Commit**

```bash
git add .claude/CLAUDE.md
git commit -m "docs: update CLAUDE.md with documents feature"
```

---

### Task 13: End-to-end smoke test

**Step 1: Verify backend loads**

Run: `docker compose -f docker-compose.yml exec backend python -c "from app.main import app; print('OK', len(app.routes))"`
Expected: Route count includes new document endpoints.

**Step 2: Run all tests**

Run: `docker compose -f docker-compose.yml exec backend python -m pytest tests/ -v`
Expected: All tests pass.

**Step 3: Verify frontend compiles**

Run: `docker compose -f docker-compose.yml exec frontend npx tsc --noEmit`
Expected: No errors.

**Step 4: Commit any final changes**

```bash
git add -A
git commit -m "feat: documents feature complete"
```
