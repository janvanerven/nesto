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
    metadata: str = Form(default="{}", max_length=4096),
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
    if len(tag_ids) > 50:
        raise HTTPException(status_code=422, detail="Too many tags (max 50)")

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
        headers={
            "X-Content-Type-Options": "nosniff",
            "Content-Disposition": f'attachment; filename="{doc.filename}"',
        },
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
