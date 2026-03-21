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
