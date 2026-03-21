# Documents Feature Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add household document storage with file uploads, two-category tagging (type + subject), and a "More" tab in the bottom nav.

**Architecture:** Files stored on filesystem (`data/documents/`), metadata + tags in SQLite. Image thumbnails generated server-side with Pillow. Multipart upload endpoint with magic-byte validation. Frontend with tag-based filtering and authenticated image loading.

**Tech Stack:** `Pillow` (backend), no new frontend deps.

**Design doc:** `docs/plans/2026-03-21-documents-design.md`

**Security hardening (from review):**
- Magic-byte validation on uploads (not just client-supplied content_type)
- Pillow `MAX_IMAGE_PIXELS` guard against decompression bombs
- EXIF auto-rotation for thumbnails
- Path containment checks on all filesystem operations
- Tag IDs validated against household membership
- Per-household storage quota (1 GB default)
- `json.loads` error handling on metadata field
- File writes after DB commit to prevent orphans
- `has_thumbnail` stored as DB column, not inferred from mime type

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

import sqlalchemy as sa
from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, Text, UniqueConstraint, func
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
    has_thumbnail: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=sa.text("0"))
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class DocumentTag(Base):
    __tablename__ = "document_tags"
    __table_args__ = (
        UniqueConstraint("household_id", "name", "category", name="uq_document_tags_household_name_category"),
    )

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    household_id: Mapped[str] = mapped_column(Text, ForeignKey("households.id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    category: Mapped[str] = mapped_column(Text, nullable=False)  # "type" or "subject"


class DocumentTagLink(Base):
    __tablename__ = "document_tag_links"

    document_id: Mapped[str] = mapped_column(
        Text, ForeignKey("documents.id", ondelete="CASCADE"), primary_key=True
    )
    tag_id: Mapped[str] = mapped_column(
        Text, ForeignKey("document_tags.id", ondelete="CASCADE"), primary_key=True
    )
```

Key changes from v1: `has_thumbnail` column on Document, unique constraint on `(household_id, name, category)` for tags, removed redundant UniqueConstraint on tag links (composite PK is sufficient).

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
- `create_table('documents', ...)` with all columns including `has_thumbnail`
- `create_table('document_tags', ...)` with all columns and the unique constraint
- `create_table('document_tag_links', ...)` with composite PK
- Indexes on `documents.household_id`, `document_tags.household_id`

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
    has_thumbnail: bool
    created_at: datetime
    tags: list[DocumentTagResponse] = []


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
import tempfile
import uuid

from fastapi import HTTPException, UploadFile
from PIL import Image, ImageOps
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.document import Document, DocumentTag, DocumentTagLink

logger = logging.getLogger(__name__)

DOCUMENTS_DIR = "data/documents"
MAX_FILE_SIZE = 25 * 1024 * 1024  # 25 MB
MAX_HOUSEHOLD_STORAGE = 1 * 1024 * 1024 * 1024  # 1 GB
THUMBNAIL_WIDTH = 400
Image.MAX_IMAGE_PIXELS = 20_000_000  # ~80 MB uncompressed RGB

ALLOWED_MIME_TYPES = {"image/jpeg", "image/png", "image/webp", "application/pdf"}

MAGIC_BYTES = {
    "image/jpeg": [b"\xff\xd8\xff"],
    "image/png": [b"\x89PNG\r\n\x1a\n"],
    "image/webp": [b"RIFF"],
    "application/pdf": [b"%PDF-"],
}


def _safe_path(path: str) -> str:
    """Resolve and verify path is inside DOCUMENTS_DIR."""
    resolved = os.path.realpath(path)
    base = os.path.realpath(DOCUMENTS_DIR)
    if not resolved.startswith(base + os.sep) and resolved != base:
        raise ValueError("Path escape detected")
    return resolved


def _validate_magic_bytes(content: bytes, declared_mime: str) -> None:
    """Verify file content matches declared MIME type via magic bytes."""
    signatures = MAGIC_BYTES.get(declared_mime)
    if not signatures:
        raise HTTPException(status_code=400, detail="Unsupported file type")
    for sig in signatures:
        if content[:len(sig)] == sig:
            if declared_mime == "image/webp" and content[8:12] != b"WEBP":
                raise HTTPException(status_code=400, detail="File content does not match declared type")
            return
    raise HTTPException(status_code=400, detail="File content does not match declared type")


def _sanitize_filename(filename: str) -> str:
    """Sanitize filename: strip path components, limit length, reject reserved prefixes."""
    name = os.path.basename(filename)[:200]
    if not name:
        name = "unnamed"
    if name.startswith("thumb_"):
        name = f"doc_{name}"
    return name


async def _get_household_storage_used(db: AsyncSession, household_id: str) -> int:
    result = await db.execute(
        select(func.coalesce(func.sum(Document.size_bytes), 0))
        .where(Document.household_id == household_id)
    )
    return result.scalar_one()


async def _validate_tag_ids(db: AsyncSession, tag_ids: list[str], household_id: str) -> None:
    """Verify all tag IDs belong to this household."""
    if not tag_ids:
        return
    result = await db.execute(
        select(DocumentTag.id).where(
            DocumentTag.id.in_(tag_ids),
            DocumentTag.household_id == household_id,
        )
    )
    valid_ids = {row[0] for row in result.all()}
    invalid = set(tag_ids) - valid_ids
    if invalid:
        raise HTTPException(status_code=400, detail=f"Invalid tag IDs for this household")


async def list_documents(
    db: AsyncSession,
    household_id: str,
    type_tag: str | None = None,
    subject_tag: str | None = None,
    search: str | None = None,
) -> list[dict]:
    query = select(Document).where(Document.household_id == household_id)

    if search:
        # Escape LIKE wildcards
        escaped = search.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        query = query.where(Document.filename.ilike(f"%{escaped}%", escape="\\"))

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
            "has_thumbnail": doc.has_thumbnail,
            "created_at": doc.created_at,
            "tags": [
                {"id": t.id, "household_id": t.household_id, "name": t.name, "category": t.category}
                for t in tag_map.get(doc.id, [])
            ],
        }
        for doc in documents
    ]


async def get_document_with_tags(db: AsyncSession, doc_id: str, household_id: str) -> dict:
    """Fetch a single document with its tags — avoids O(n) list scan."""
    doc = await get_document(db, doc_id, household_id)
    tag_result = await db.execute(
        select(DocumentTag)
        .join(DocumentTagLink, DocumentTagLink.tag_id == DocumentTag.id)
        .where(DocumentTagLink.document_id == doc_id)
    )
    tags = tag_result.scalars().all()
    return {
        "id": doc.id,
        "household_id": doc.household_id,
        "uploaded_by": doc.uploaded_by,
        "filename": doc.filename,
        "mime_type": doc.mime_type,
        "size_bytes": doc.size_bytes,
        "has_thumbnail": doc.has_thumbnail,
        "created_at": doc.created_at,
        "tags": [
            {"id": t.id, "household_id": t.household_id, "name": t.name, "category": t.category}
            for t in tags
        ],
    }


async def create_document(
    db: AsyncSession,
    household_id: str,
    user_id: str,
    file: UploadFile,
    tag_ids: list[str],
) -> dict:
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

    # Validate magic bytes match declared mime type
    _validate_magic_bytes(content, file.content_type)

    # Check household storage quota
    used = await _get_household_storage_used(db, household_id)
    if used + len(content) > MAX_HOUSEHOLD_STORAGE:
        raise HTTPException(status_code=413, detail="Household storage quota exceeded (1 GB)")

    # Validate tag IDs belong to this household
    await _validate_tag_ids(db, tag_ids, household_id)

    doc_id = str(uuid.uuid4())
    filename = _sanitize_filename(file.filename or "unnamed")

    # Create directory
    doc_dir = os.path.join(DOCUMENTS_DIR, household_id, doc_id)
    _safe_path(doc_dir)
    os.makedirs(doc_dir, exist_ok=True)

    # Write to temp file first, move after DB commit
    tmp_path = os.path.join(doc_dir, f".tmp_{filename}")
    final_path = os.path.join(doc_dir, filename)
    with open(tmp_path, "wb") as f:
        f.write(content)

    # Generate thumbnail for images
    has_thumbnail = False
    if file.content_type and file.content_type.startswith("image/"):
        try:
            _generate_thumbnail(tmp_path, doc_dir, filename)
            has_thumbnail = True
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
        mime_type=file.content_type,
        size_bytes=len(content),
        has_thumbnail=has_thumbnail,
    )
    db.add(doc)

    # Link tags
    for tag_id in tag_ids:
        db.add(DocumentTagLink(document_id=doc_id, tag_id=tag_id))

    try:
        await db.commit()
    except Exception:
        # Clean up orphaned files on DB failure
        shutil.rmtree(doc_dir, ignore_errors=True)
        raise

    # DB committed — move temp file to final path
    os.rename(tmp_path, final_path)

    await db.refresh(doc)
    return await get_document_with_tags(db, doc_id, household_id)


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
) -> dict:
    doc = await get_document(db, doc_id, household_id)

    if filename is not None:
        new_filename = _sanitize_filename(filename)
        old_storage_path = doc.storage_path
        new_storage_path = os.path.join(household_id, doc_id, new_filename)

        # Update DB first, then rename file
        old_filename = doc.filename
        doc.filename = new_filename
        doc.storage_path = new_storage_path

    if tag_ids is not None:
        await _validate_tag_ids(db, tag_ids, household_id)
        # Replace all tag links
        existing = await db.execute(
            select(DocumentTagLink).where(DocumentTagLink.document_id == doc_id)
        )
        for link in existing.scalars().all():
            await db.delete(link)
        for tag_id in tag_ids:
            db.add(DocumentTagLink(document_id=doc_id, tag_id=tag_id))

    await db.commit()

    # Rename file on disk after DB commit succeeds
    if filename is not None:
        old_path = _safe_path(os.path.join(DOCUMENTS_DIR, old_storage_path))
        new_path = _safe_path(os.path.join(DOCUMENTS_DIR, new_storage_path))
        if old_path != new_path and os.path.exists(old_path):
            try:
                os.rename(old_path, new_path)
                # Rename thumbnail too
                old_thumb = _safe_path(os.path.join(DOCUMENTS_DIR, household_id, doc_id, f"thumb_{old_filename}"))
                new_thumb = _safe_path(os.path.join(DOCUMENTS_DIR, household_id, doc_id, f"thumb_{new_filename}"))
                if os.path.exists(old_thumb):
                    os.rename(old_thumb, new_thumb)
            except OSError as e:
                logger.error("File rename failed after DB commit: %s", e)

    return await get_document_with_tags(db, doc_id, household_id)


async def delete_document(db: AsyncSession, doc_id: str, household_id: str) -> None:
    doc = await get_document(db, doc_id, household_id)

    # Delete DB record first
    await db.delete(doc)
    await db.commit()

    # Then clean up files
    doc_dir = _safe_path(os.path.join(DOCUMENTS_DIR, household_id, doc_id))
    if os.path.exists(doc_dir):
        shutil.rmtree(doc_dir)


def get_file_path(doc: Document) -> str:
    return _safe_path(os.path.join(DOCUMENTS_DIR, doc.storage_path))


def get_thumbnail_path(doc: Document) -> str | None:
    thumb_path = _safe_path(os.path.join(DOCUMENTS_DIR, doc.household_id, doc.id, f"thumb_{doc.filename}"))
    if os.path.exists(thumb_path):
        return thumb_path
    return None


def _generate_thumbnail(file_path: str, doc_dir: str, filename: str) -> None:
    with Image.open(file_path) as img:
        # Auto-rotate based on EXIF orientation
        img = ImageOps.exif_transpose(img)
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

**Step 2: Create the documents directory in lifespan**

Add to `backend/app/main.py` lifespan, after `os.makedirs("data", exist_ok=True)`:

```python
    os.makedirs("data/documents", exist_ok=True)
```

**Step 3: Commit**

```bash
git add backend/app/services/document_service.py backend/app/main.py
git commit -m "feat: add document service with secure file storage and thumbnails"
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

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
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
    type_tag: str | None = Query(None),
    subject_tag: str | None = Query(None),
    search: str | None = Query(None, max_length=200),
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

    try:
        meta = json.loads(metadata)
    except json.JSONDecodeError:
        raise HTTPException(status_code=422, detail="Invalid JSON in metadata field")
    if not isinstance(meta, dict):
        raise HTTPException(status_code=422, detail="metadata must be a JSON object")

    tag_ids = meta.get("tags", [])
    if not isinstance(tag_ids, list) or not all(isinstance(t, str) for t in tag_ids):
        raise HTTPException(status_code=422, detail="tags must be a list of strings")

    return await svc.create_document(db, household_id, user_id, file, tag_ids)


@router.get("/{doc_id}", response_model=DocumentResponse)
async def get_document(
    household_id: str,
    doc_id: str,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    await get_household(db, household_id, user_id)
    return await svc.get_document_with_tags(db, doc_id, household_id)


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
    return FileResponse(
        file_path,
        filename=doc.filename,
        media_type=doc.mime_type,
        headers={"X-Content-Type-Options": "nosniff"},
    )


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
        raise HTTPException(status_code=404, detail="No thumbnail available")
    return FileResponse(
        thumb_path,
        media_type="image/jpeg",
        headers={"X-Content-Type-Options": "nosniff"},
    )


@router.patch("/{doc_id}", response_model=DocumentResponse)
async def update_document(
    household_id: str,
    doc_id: str,
    body: DocumentUpdate,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    await get_household(db, household_id, user_id)
    return await svc.update_document(db, doc_id, household_id, body.filename, body.tag_ids)


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

Add to imports:
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
git commit -m "feat: add documents API routes (CRUD + tags + secure file serving)"
```

---

### Task 7: Update nginx for large uploads

**Files:**
- Modify: `nginx/nginx.conf`

**Step 1: Add scoped location block for document uploads**

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
        add_header X-Content-Type-Options "nosniff" always;
    }
```

Also add `add_header X-Content-Type-Options "nosniff" always;` to the existing `/api/` location block.

**Step 2: Commit**

```bash
git add nginx/nginx.conf
git commit -m "ops: allow 25MB uploads for documents, add nosniff to API responses"
```

---

### Task 8: Update docker-compose for document backup

**Files:**
- Modify: `docker-compose.prod.yml`

**Step 1: Update backup entrypoint to use rsync for documents**

Replace the backup entrypoint with:

```yaml
    entrypoint: >
      sh -c 'apk add --no-cache sqlite rsync && while true; do
        sqlite3 /data/nesto.db ".backup /backup/nesto-$$(date +%Y%m%d-%H%M).db";
        if [ -d /data/documents ]; then
          rsync -a --delete /data/documents/ /backup/documents/;
        fi;
        find /backup -name "*.db" -mtime +7 -delete;
        sleep 86400;
      done'
```

This uses `rsync --delete` for incremental document sync (only copies changes, removes deleted files).

**Step 2: Commit**

```bash
git add docker-compose.prod.yml
git commit -m "ops: add incremental document backup with rsync"
```

---

### Task 9: Create frontend API hooks and upload helper

**Files:**
- Create: `frontend/src/api/documents.ts`
- Modify: `frontend/src/api/client.ts`

**Step 1: Export `getAccessToken` from client.ts**

Add this exported function to `frontend/src/api/client.ts` after the `hasToken` function:

```typescript
export function getAccessToken(): string | undefined {
  return getFreshToken()
}
```

**Step 2: Create the documents API module**

Create `frontend/src/api/documents.ts`:

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch, hasToken, getAccessToken } from './client'

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
  has_thumbnail: boolean
  created_at: string
  tags: DocumentTag[]
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

      const token = getAccessToken()
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

export function useDocument(householdId: string, docId: string) {
  return useQuery({
    queryKey: ['documents', householdId, docId],
    queryFn: () => apiFetch<Document>(`/households/${householdId}/documents/${docId}`),
    enabled: !!householdId && !!docId && hasToken(),
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

/**
 * Build authenticated URL for document file/thumbnail.
 * Use with useAuthenticatedImage hook for <img> tags.
 */
export function getDocumentFileUrl(householdId: string, docId: string): string {
  return `/api/households/${householdId}/documents/${docId}/file`
}

export function getDocumentThumbnailUrl(householdId: string, docId: string): string {
  return `/api/households/${householdId}/documents/${docId}/thumbnail`
}
```

**Step 3: Create authenticated image hook**

Create `frontend/src/utils/use-authenticated-image.ts`:

```typescript
import { useState, useEffect } from 'react'
import { getAccessToken } from '@/api/client'

/**
 * Fetches an image from an authenticated endpoint and returns an object URL.
 * The object URL can be used as an <img> src.
 */
export function useAuthenticatedImage(url: string | null): string | null {
  const [objectUrl, setObjectUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!url) {
      setObjectUrl(null)
      return
    }

    let revoked = false
    const token = getAccessToken()

    fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load image')
        return res.blob()
      })
      .then((blob) => {
        if (!revoked) {
          setObjectUrl(URL.createObjectURL(blob))
        }
      })
      .catch(() => {
        if (!revoked) setObjectUrl(null)
      })

    return () => {
      revoked = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [url])

  return objectUrl
}
```

**Step 4: Commit**

```bash
git add frontend/src/api/documents.ts frontend/src/api/client.ts frontend/src/utils/use-authenticated-image.ts
git commit -m "feat: add document API hooks with authenticated image loading"
```

---

### Task 10: Rework bottom nav to "More" pattern

**Files:**
- Modify: `frontend/src/components/layout/bottom-nav.tsx`
- Create: `frontend/src/routes/more.tsx`

**Step 1: Update bottom-nav.tsx**

Replace the `tabs` array (line 4-11):
```typescript
const MORE_PATHS = ['/cards', '/settings', '/documents']

const tabs = [
  { to: '/' as const, label: 'Home', icon: HomeIcon },
  { to: '/tasks' as const, label: 'Reminders', icon: CheckIcon },
  { to: '/calendar' as const, label: 'Calendar', icon: CalendarIcon },
  { to: '/lists' as const, label: 'Lists', icon: ListIcon },
  { to: '/more' as const, label: 'More', icon: MoreIcon },
]
```

Update the `isActive` check (line 21):
```typescript
const isActive = currentPath === tab.to
  || (tab.to !== '/' && currentPath.startsWith(tab.to))
  || (tab.to === '/more' && MORE_PATHS.some(p => currentPath.startsWith(p)))
```

Replace `CardIcon` and `SettingsIcon` with `MoreIcon`:
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

Remove `CardIcon` and `SettingsIcon`.

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
  { to: '/cards' as const, label: 'Loyalty Cards', description: 'Store and scan your loyalty cards', icon: CardIcon },
  { to: '/documents' as const, label: 'Documents', description: 'Warranties, receipts, and manuals', icon: DocIcon },
  { to: '/settings' as const, label: 'Settings', description: 'Profile, household, and preferences', icon: GearIcon },
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
              <item.icon />
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

function CardIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-primary shrink-0">
      <rect x="1" y="4" width="22" height="16" rx="2" /><line x1="1" y1="10" x2="23" y2="10" />
    </svg>
  )
}

function DocIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-primary shrink-0">
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" />
    </svg>
  )
}

function GearIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-primary shrink-0">
      <circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
    </svg>
  )
}
```

**Step 3: Commit**

```bash
git add frontend/src/components/layout/bottom-nav.tsx frontend/src/routes/more.tsx
git commit -m "feat: rework bottom nav to More tab (Cards, Documents, Settings)"
```

---

### Task 11: Create Documents pages (list + detail routes)

**Files:**
- Create: `frontend/src/routes/documents.tsx` (layout with Outlet)
- Create: `frontend/src/routes/documents.index.tsx` (list page)
- Create: `frontend/src/routes/documents.$docId.tsx` (detail page)
- Create: `frontend/src/components/documents/upload-document-sheet.tsx`

Follow the existing pattern from `cards.tsx` + `cards.index.tsx` + `cards.$cardId.tsx`.

**Step 1: Create layout route**

Create `frontend/src/routes/documents.tsx`:

```tsx
import { createFileRoute, Outlet } from '@tanstack/react-router'

export const Route = createFileRoute('/documents')({
  component: () => <Outlet />,
})
```

**Step 2: Create upload sheet component**

Create `frontend/src/components/documents/upload-document-sheet.tsx`:

```tsx
import { useState, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Button, Input } from '@/components/ui'
import { useUploadDocument, useDocumentTags, useCreateDocumentTag } from '@/api/documents'
import type { DocumentTag } from '@/api/documents'
import { useScrollLock } from '@/utils/use-scroll-lock'

interface UploadDocumentSheetProps {
  open: boolean
  onClose: () => void
  householdId: string
}

export function UploadDocumentSheet({ open, onClose, householdId }: UploadDocumentSheetProps) {
  useScrollLock(open)
  const fileRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [newTagName, setNewTagName] = useState('')
  const [newTagCategory, setNewTagCategory] = useState<'type' | 'subject'>('type')
  const [error, setError] = useState('')

  const { data: tags = [] } = useDocumentTags(householdId)
  const uploadMutation = useUploadDocument(householdId)
  const createTagMutation = useCreateDocumentTag(householdId)

  const typeTags = tags.filter(t => t.category === 'type')
  const subjectTags = tags.filter(t => t.category === 'subject')

  const reset = () => {
    setFile(null)
    setSelectedTags([])
    setNewTagName('')
    setError('')
    if (fileRef.current) fileRef.current.value = ''
  }

  const handleClose = () => {
    reset()
    onClose()
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f) {
      if (f.size > 25 * 1024 * 1024) {
        setError('File too large. Max 25 MB.')
        return
      }
      setFile(f)
      setError('')
    }
  }

  const toggleTag = (tagId: string) => {
    setSelectedTags(prev =>
      prev.includes(tagId) ? prev.filter(id => id !== tagId) : [...prev, tagId]
    )
  }

  const handleCreateTag = async () => {
    if (!newTagName.trim()) return
    try {
      const tag = await createTagMutation.mutateAsync({
        name: newTagName.trim(),
        category: newTagCategory,
      })
      setSelectedTags(prev => [...prev, tag.id])
      setNewTagName('')
    } catch (e: any) {
      setError(e?.message || 'Failed to create tag')
    }
  }

  const handleUpload = async () => {
    if (!file) return
    setError('')
    try {
      await uploadMutation.mutateAsync({ file, tagIds: selectedTags })
      handleClose()
    } catch (e: any) {
      setError(e?.message || 'Upload failed')
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 bg-black/30 z-40"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={handleClose}
          />
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="fixed bottom-0 left-0 right-0 bg-surface rounded-t-3xl p-6 pb-[env(safe-area-inset-bottom)] z-50 max-w-lg mx-auto max-h-[85vh] overflow-y-auto"
          >
            <div className="w-12 h-1.5 bg-text/10 rounded-full mx-auto mb-6" />
            <h2 className="text-lg font-bold text-text mb-4">Upload Document</h2>

            {/* File picker */}
            <div className="mb-4">
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,application/pdf"
                onChange={handleFileChange}
                className="hidden"
              />
              {file ? (
                <div className="bg-background rounded-xl p-3 flex items-center justify-between">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-text truncate">{file.name}</p>
                    <p className="text-xs text-text-muted">{(file.size / 1024 / 1024).toFixed(1)} MB</p>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => { setFile(null); if (fileRef.current) fileRef.current.value = '' }}>
                    Change
                  </Button>
                </div>
              ) : (
                <Button variant="secondary" className="w-full" onClick={() => fileRef.current?.click()}>
                  Choose file
                </Button>
              )}
            </div>

            {/* Type tags */}
            {typeTags.length > 0 && (
              <div className="mb-3">
                <p className="text-sm font-medium text-text mb-1">Type</p>
                <div className="flex flex-wrap gap-2">
                  {typeTags.map(tag => (
                    <TagPill key={tag.id} tag={tag} selected={selectedTags.includes(tag.id)} onClick={() => toggleTag(tag.id)} />
                  ))}
                </div>
              </div>
            )}

            {/* Subject tags */}
            {subjectTags.length > 0 && (
              <div className="mb-3">
                <p className="text-sm font-medium text-text mb-1">Subject</p>
                <div className="flex flex-wrap gap-2">
                  {subjectTags.map(tag => (
                    <TagPill key={tag.id} tag={tag} selected={selectedTags.includes(tag.id)} onClick={() => toggleTag(tag.id)} />
                  ))}
                </div>
              </div>
            )}

            {/* Create new tag */}
            <div className="mb-4">
              <p className="text-sm font-medium text-text mb-1">Add tag</p>
              <div className="flex gap-2">
                <Input
                  value={newTagName}
                  onChange={(e) => setNewTagName(e.target.value)}
                  placeholder="Tag name"
                  className="flex-1 !h-10"
                />
                <select
                  value={newTagCategory}
                  onChange={(e) => setNewTagCategory(e.target.value as 'type' | 'subject')}
                  className="h-10 px-2 rounded-xl bg-background text-text text-sm border border-text/10"
                >
                  <option value="type">Type</option>
                  <option value="subject">Subject</option>
                </select>
                <Button size="sm" variant="secondary" onClick={handleCreateTag} disabled={!newTagName.trim()}>
                  +
                </Button>
              </div>
            </div>

            {error && <p className="text-xs text-accent mb-3">{error}</p>}

            <Button
              className="w-full"
              onClick={handleUpload}
              disabled={!file || uploadMutation.isPending}
            >
              {uploadMutation.isPending ? 'Uploading...' : 'Upload'}
            </Button>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}

function TagPill({ tag, selected, onClick }: { tag: DocumentTag; selected: boolean; onClick: () => void }) {
  const colors = tag.category === 'type'
    ? selected ? 'bg-primary text-white' : 'bg-primary/10 text-primary'
    : selected ? 'bg-secondary text-white' : 'bg-secondary/10 text-secondary'
  return (
    <button onClick={onClick} className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${colors}`}>
      {tag.name}
    </button>
  )
}
```

**Step 3: Create documents list page**

Create `frontend/src/routes/documents.index.tsx`:

Follow the pattern from `cards.index.tsx`:
- Auth guard + household guard
- `useDocuments(householdId, filters)` with `useState` for `activeTypeTag`, `activeSubjectTag`, `search`
- `useDocumentTags(householdId)` for filter chips
- Grid layout: 2 columns for thumbnails, full-width for PDFs
- Each document card shows: thumbnail (via `useAuthenticatedImage`) or PDF icon, filename, tags as pills, file size, date
- Tap navigates to `/documents/$docId`
- FAB opens `UploadDocumentSheet`
- Search input at top (debounced)
- Two rows of filter chips (type tags in primary color, subject tags in secondary color)
- Empty state card

**Step 4: Create document detail page**

Create `frontend/src/routes/documents.$docId.tsx`:

Follow the pattern from `cards.$cardId.tsx`:
- `Route.useParams()` for `docId`
- `useDocument(householdId, docId)` for metadata
- `useAuthenticatedImage(getDocumentThumbnailUrl(...))` for image preview, or PDF icon for PDFs
- Full-width image display with `object-contain`
- For PDFs: download button using `getDocumentFileUrl(...)` opened in a new tab (construct authenticated URL)
- Display: filename, uploaded by, date, file size
- Tag chips (editable via `useUpdateDocument`)
- Delete button with confirmation
- Back button navigation

**Step 5: Regenerate route tree**

Run: `cd frontend && npx tsr generate`

**Step 6: Verify TypeScript**

Run: `docker compose -f docker-compose.yml exec frontend npx tsc --noEmit`
Expected: No errors.

**Step 7: Commit**

```bash
git add frontend/src/routes/documents.tsx frontend/src/routes/documents.index.tsx frontend/src/routes/documents.\$docId.tsx frontend/src/components/documents/upload-document-sheet.tsx frontend/src/routeTree.gen.ts
git commit -m "feat: add Documents pages (list, detail, upload sheet)"
```

---

### Task 12: Update CLAUDE.md

**Files:**
- Modify: `.claude/CLAUDE.md`

**Step 1: Update CLAUDE.md**

Add to relevant sections:
- Models: add `document`, `document_tag`, `document_tag_link`
- Services: add `document_service`
- Routers: add `documents` router
- API endpoints: all document + tag endpoints
- Components: `documents/` (upload-document-sheet), More page
- Frontend API: `documents.ts`
- Dependencies: `Pillow`
- Navigation: bottom nav now has "More" tab grouping Cards, Documents, Settings

**Step 2: Commit**

```bash
git add .claude/CLAUDE.md
git commit -m "docs: update CLAUDE.md with documents feature"
```

---

### Task 13: End-to-end smoke test

**Step 1: Verify backend loads**

Run: `docker compose -f docker-compose.yml exec backend python -c "from app.main import app; print('OK', len(app.routes))"`

**Step 2: Run all tests**

Run: `docker compose -f docker-compose.yml exec backend python -m pytest tests/ -v`

**Step 3: Verify frontend compiles**

Run: `docker compose -f docker-compose.yml exec frontend npx tsc --noEmit`

**Step 4: Commit any final changes**

```bash
git add -A
git commit -m "feat: documents feature complete"
```
