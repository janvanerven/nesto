import logging

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.background import BackgroundTask
from starlette.responses import Response, StreamingResponse

from app.auth import get_current_user_id
from app.database import get_db
from app.schemas.sekura import (
    SekuraCreateFolder,
    SekuraCreateShare,
    SekuraUpdateShare,
)
from app.services.household_service import get_household
from app.services.sekura_connection_service import get_decrypted_api_key
from app.services.sekura_service import SekuraService

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/households/{household_id}/documents",
    tags=["documents"],
)


# ---------------------------------------------------------------------------
# Dependencies
# ---------------------------------------------------------------------------

async def _get_sekura_key(
    household_id: str,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> str:
    """Resolve and return the user's decrypted Sekura API key after verifying household membership."""
    await get_household(db, household_id, user_id)
    key = await get_decrypted_api_key(db, user_id)
    if key is None:
        raise HTTPException(status_code=400, detail="Sekura not configured")
    return key


async def _get_sekura(request: Request) -> SekuraService:
    """Get the SekuraService instance from app state."""
    sekura = getattr(request.app.state, "sekura", None)
    if sekura is None:
        raise HTTPException(status_code=503, detail="Sekura not enabled on this server")
    return sekura


# ---------------------------------------------------------------------------
# Typed request bodies for update endpoints
# ---------------------------------------------------------------------------

class UpdateResourceRequest(BaseModel):
    name: str | None = None
    parent_id: str | None = None


# ---------------------------------------------------------------------------
# Folders
# ---------------------------------------------------------------------------

@router.get("/folders")
async def list_root_folders(
    sekura: SekuraService = Depends(_get_sekura),
    api_key: str = Depends(_get_sekura_key),
):
    """Root folder listing (folder contents for root)."""
    return await sekura.get_folder_contents(api_key)


@router.post("/folders")
async def create_folder(
    body: SekuraCreateFolder,
    sekura: SekuraService = Depends(_get_sekura),
    api_key: str = Depends(_get_sekura_key),
):
    return await sekura.create_folder(api_key, body.name, body.parent_id)


@router.get("/folders/tree")
async def get_folder_tree(
    sekura: SekuraService = Depends(_get_sekura),
    api_key: str = Depends(_get_sekura_key),
):
    return await sekura.get_folder_tree(api_key)


@router.get("/folders/{folder_id}/contents")
async def get_folder_contents(
    folder_id: str,
    sekura: SekuraService = Depends(_get_sekura),
    api_key: str = Depends(_get_sekura_key),
):
    return await sekura.get_folder_contents(api_key, folder_id)


@router.get("/folders/{folder_id}")
async def get_folder(
    folder_id: str,
    sekura: SekuraService = Depends(_get_sekura),
    api_key: str = Depends(_get_sekura_key),
):
    return await sekura.get_folder(api_key, folder_id)


@router.put("/folders/{folder_id}")
async def update_folder(
    folder_id: str,
    body: UpdateResourceRequest,
    sekura: SekuraService = Depends(_get_sekura),
    api_key: str = Depends(_get_sekura_key),
):
    if body.name is not None:
        return await sekura.rename_folder(api_key, folder_id, body.name)
    if body.parent_id is not None:
        return await sekura.move_folder(api_key, folder_id, body.parent_id)
    raise HTTPException(status_code=400, detail="Must provide name or parent_id")


@router.delete("/folders/{folder_id}")
async def delete_folder(
    folder_id: str,
    sekura: SekuraService = Depends(_get_sekura),
    api_key: str = Depends(_get_sekura_key),
):
    await sekura.delete_folder(api_key, folder_id)
    logger.info("folder deleted: %s", folder_id)
    return {"ok": True}


# ---------------------------------------------------------------------------
# Files
# ---------------------------------------------------------------------------

@router.post("/files")
async def upload_file(
    file: UploadFile = File(...),
    folder_id: str | None = Form(None),
    sekura: SekuraService = Depends(_get_sekura),
    api_key: str = Depends(_get_sekura_key),
):
    result = await sekura.upload_file(api_key, file, folder_id)
    logger.info("file uploaded: %s to folder %s", file.filename, folder_id)
    return result


@router.get("/files/{file_id}/download")
async def download_file(
    file_id: str,
    sekura: SekuraService = Depends(_get_sekura),
    api_key: str = Depends(_get_sekura_key),
):
    resp = await sekura.download_file_stream(api_key, file_id)
    return StreamingResponse(
        resp.aiter_bytes(chunk_size=65536),
        media_type=resp.headers.get("content-type", "application/octet-stream"),
        headers={
            "Content-Disposition": resp.headers.get("content-disposition", "attachment"),
            "X-Content-Type-Options": "nosniff",
        },
        background=BackgroundTask(resp.aclose),
    )


@router.get("/files/{file_id}/thumbnail")
async def get_thumbnail(
    file_id: str,
    sekura: SekuraService = Depends(_get_sekura),
    api_key: str = Depends(_get_sekura_key),
):
    thumb = await sekura.get_thumbnail(api_key, file_id)
    if thumb is None:
        raise HTTPException(status_code=404, detail="No thumbnail available")
    return Response(
        content=thumb,
        media_type="image/jpeg",
        headers={"X-Content-Type-Options": "nosniff"},
    )


@router.get("/files/{file_id}/versions/{version_id}/download")
async def download_version(
    file_id: str,
    version_id: str,
    sekura: SekuraService = Depends(_get_sekura),
    api_key: str = Depends(_get_sekura_key),
):
    resp = await sekura.download_version_stream(api_key, file_id, version_id)
    return StreamingResponse(
        resp.aiter_bytes(chunk_size=65536),
        media_type=resp.headers.get("content-type", "application/octet-stream"),
        headers={
            "Content-Disposition": resp.headers.get("content-disposition", "attachment"),
            "X-Content-Type-Options": "nosniff",
        },
        background=BackgroundTask(resp.aclose),
    )


@router.get("/files/{file_id}/versions")
async def list_versions(
    file_id: str,
    sekura: SekuraService = Depends(_get_sekura),
    api_key: str = Depends(_get_sekura_key),
):
    return await sekura.list_versions(api_key, file_id)


@router.post("/files/{file_id}/versions")
async def upload_version(
    file_id: str,
    file: UploadFile = File(...),
    sekura: SekuraService = Depends(_get_sekura),
    api_key: str = Depends(_get_sekura_key),
):
    result = await sekura.upload_new_version(api_key, file_id, file)
    logger.info("new version uploaded for file: %s", file_id)
    return result


@router.get("/files/{file_id}")
async def get_file(
    file_id: str,
    sekura: SekuraService = Depends(_get_sekura),
    api_key: str = Depends(_get_sekura_key),
):
    return await sekura.get_file(api_key, file_id)


@router.put("/files/{file_id}")
async def update_file(
    file_id: str,
    body: UpdateResourceRequest,
    sekura: SekuraService = Depends(_get_sekura),
    api_key: str = Depends(_get_sekura_key),
):
    if body.name is not None:
        return await sekura.rename_file(api_key, file_id, body.name)
    if body.parent_id is not None:
        return await sekura.move_file(api_key, file_id, body.parent_id)
    raise HTTPException(status_code=400, detail="Must provide name or parent_id")


@router.delete("/files/{file_id}")
async def delete_file(
    file_id: str,
    sekura: SekuraService = Depends(_get_sekura),
    api_key: str = Depends(_get_sekura_key),
):
    await sekura.delete_file(api_key, file_id)
    logger.info("file soft-deleted: %s", file_id)
    return {"ok": True}


# ---------------------------------------------------------------------------
# Trash
# ---------------------------------------------------------------------------

_VALID_TRASH_TYPES = {"file", "folder"}


@router.get("/trash")
async def list_trash(
    sekura: SekuraService = Depends(_get_sekura),
    api_key: str = Depends(_get_sekura_key),
):
    return await sekura.list_trash(api_key)


@router.post("/trash/{item_type}/{item_id}/restore")
async def restore_item(
    item_type: str,
    item_id: str,
    sekura: SekuraService = Depends(_get_sekura),
    api_key: str = Depends(_get_sekura_key),
):
    if item_type not in _VALID_TRASH_TYPES:
        raise HTTPException(status_code=400, detail="item_type must be 'file' or 'folder'")
    await sekura.restore_item(api_key, item_type, item_id)
    logger.info("trash item restored: %s/%s", item_type, item_id)
    return {"ok": True}


@router.delete("/trash/{item_type}/{item_id}")
async def delete_permanently(
    item_type: str,
    item_id: str,
    sekura: SekuraService = Depends(_get_sekura),
    api_key: str = Depends(_get_sekura_key),
):
    if item_type not in _VALID_TRASH_TYPES:
        raise HTTPException(status_code=400, detail="item_type must be 'file' or 'folder'")
    await sekura.delete_permanently(api_key, item_type, item_id)
    logger.info("trash item permanently deleted: %s/%s", item_type, item_id)
    return {"ok": True}


@router.delete("/trash")
async def empty_trash(
    sekura: SekuraService = Depends(_get_sekura),
    api_key: str = Depends(_get_sekura_key),
):
    await sekura.empty_trash(api_key)
    logger.info("trash emptied")
    return {"ok": True}


# ---------------------------------------------------------------------------
# Sharing
# ---------------------------------------------------------------------------

@router.post("/shares")
async def create_share(
    body: SekuraCreateShare,
    sekura: SekuraService = Depends(_get_sekura),
    api_key: str = Depends(_get_sekura_key),
):
    result = await sekura.create_share(
        api_key, body.resource_type, body.resource_id, body.shared_with, body.permission
    )
    logger.info("share created: %s/%s -> %s", body.resource_type, body.resource_id, body.shared_with)
    return result


@router.get("/shares")
async def list_shares(
    type: str = Query("owned"),
    sekura: SekuraService = Depends(_get_sekura),
    api_key: str = Depends(_get_sekura_key),
):
    return await sekura.list_shares(api_key, type)


@router.put("/shares/{share_id}")
async def update_share(
    share_id: str,
    body: SekuraUpdateShare,
    sekura: SekuraService = Depends(_get_sekura),
    api_key: str = Depends(_get_sekura_key),
):
    return await sekura.update_share(api_key, share_id, body.permission)


@router.delete("/shares/{share_id}")
async def delete_share(
    share_id: str,
    sekura: SekuraService = Depends(_get_sekura),
    api_key: str = Depends(_get_sekura_key),
):
    await sekura.delete_share(api_key, share_id)
    logger.info("share revoked: %s", share_id)
    return {"ok": True}


@router.get("/users/search")
async def search_users(
    q: str = Query(""),
    sekura: SekuraService = Depends(_get_sekura),
    api_key: str = Depends(_get_sekura_key),
):
    return await sekura.search_users(api_key, q)
