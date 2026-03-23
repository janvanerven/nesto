import logging

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile
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
from app.services.sekura_connection_service import get_decrypted_api_key

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/households/{household_id}/documents",
    tags=["documents"],
)


# ---------------------------------------------------------------------------
# Dependencies
# ---------------------------------------------------------------------------

async def _get_sekura_key(
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> str:
    """Resolve and return the user's decrypted Sekura API key."""
    key = await get_decrypted_api_key(db, user_id)
    if key is None:
        raise HTTPException(status_code=400, detail="Sekura not configured")
    return key


def _get_sekura(request: Request):
    """Get the SekuraService instance from app state."""
    sekura = getattr(request.app.state, "sekura", None)
    if sekura is None:
        raise HTTPException(status_code=503, detail="Sekura not enabled on this server")
    return sekura


# ---------------------------------------------------------------------------
# Folders
# ---------------------------------------------------------------------------

@router.get("/folders")
async def list_root_folders(
    request: Request,
    api_key: str = Depends(_get_sekura_key),
):
    """Root folder listing (folder contents for root)."""
    sekura = _get_sekura(request)
    return await sekura.get_folder_contents(api_key)


@router.post("/folders")
async def create_folder(
    request: Request,
    body: SekuraCreateFolder,
    api_key: str = Depends(_get_sekura_key),
):
    sekura = _get_sekura(request)
    return await sekura.create_folder(api_key, body.name, body.parent_id)


@router.get("/folders/tree")
async def get_folder_tree(
    request: Request,
    api_key: str = Depends(_get_sekura_key),
):
    sekura = _get_sekura(request)
    return await sekura.get_folder_tree(api_key)


@router.get("/folders/{folder_id}/contents")
async def get_folder_contents(
    request: Request,
    folder_id: str,
    api_key: str = Depends(_get_sekura_key),
):
    sekura = _get_sekura(request)
    return await sekura.get_folder_contents(api_key, folder_id)


@router.get("/folders/{folder_id}")
async def get_folder(
    request: Request,
    folder_id: str,
    api_key: str = Depends(_get_sekura_key),
):
    sekura = _get_sekura(request)
    return await sekura.get_folder(api_key, folder_id)


@router.put("/folders/{folder_id}")
async def update_folder(
    request: Request,
    folder_id: str,
    body: dict,
    api_key: str = Depends(_get_sekura_key),
):
    sekura = _get_sekura(request)
    if "name" in body:
        return await sekura.rename_folder(api_key, folder_id, body["name"])
    if "parent_id" in body:
        return await sekura.move_folder(api_key, folder_id, body.get("parent_id"))
    raise HTTPException(status_code=400, detail="Must provide name or parent_id")


@router.delete("/folders/{folder_id}")
async def delete_folder(
    request: Request,
    folder_id: str,
    api_key: str = Depends(_get_sekura_key),
):
    sekura = _get_sekura(request)
    await sekura.delete_folder(api_key, folder_id)
    logger.info("folder deleted: %s", folder_id)
    return {"ok": True}


# ---------------------------------------------------------------------------
# Files
# ---------------------------------------------------------------------------

@router.post("/files")
async def upload_file(
    request: Request,
    file: UploadFile = File(...),
    folder_id: str | None = Form(None),
    api_key: str = Depends(_get_sekura_key),
):
    sekura = _get_sekura(request)
    result = await sekura.upload_file(api_key, file, folder_id)
    logger.info("file uploaded: %s to folder %s", file.filename, folder_id)
    return result


@router.get("/files/{file_id}/download")
async def download_file(
    request: Request,
    file_id: str,
    api_key: str = Depends(_get_sekura_key),
):
    sekura = _get_sekura(request)
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
    request: Request,
    file_id: str,
    api_key: str = Depends(_get_sekura_key),
):
    sekura = _get_sekura(request)
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
    request: Request,
    file_id: str,
    version_id: str,
    api_key: str = Depends(_get_sekura_key),
):
    sekura = _get_sekura(request)
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
    request: Request,
    file_id: str,
    api_key: str = Depends(_get_sekura_key),
):
    sekura = _get_sekura(request)
    return await sekura.list_versions(api_key, file_id)


@router.post("/files/{file_id}/versions")
async def upload_version(
    request: Request,
    file_id: str,
    file: UploadFile = File(...),
    api_key: str = Depends(_get_sekura_key),
):
    sekura = _get_sekura(request)
    result = await sekura.upload_new_version(api_key, file_id, file)
    logger.info("new version uploaded for file: %s", file_id)
    return result


@router.get("/files/{file_id}")
async def get_file(
    request: Request,
    file_id: str,
    api_key: str = Depends(_get_sekura_key),
):
    sekura = _get_sekura(request)
    return await sekura.get_file(api_key, file_id)


@router.put("/files/{file_id}")
async def update_file(
    request: Request,
    file_id: str,
    body: dict,
    api_key: str = Depends(_get_sekura_key),
):
    sekura = _get_sekura(request)
    if "name" in body:
        return await sekura.rename_file(api_key, file_id, body["name"])
    if "parent_id" in body:
        return await sekura.move_file(api_key, file_id, body.get("parent_id"))
    raise HTTPException(status_code=400, detail="Must provide name or parent_id")


@router.delete("/files/{file_id}")
async def delete_file(
    request: Request,
    file_id: str,
    api_key: str = Depends(_get_sekura_key),
):
    sekura = _get_sekura(request)
    await sekura.delete_file(api_key, file_id)
    logger.info("file soft-deleted: %s", file_id)
    return {"ok": True}


# ---------------------------------------------------------------------------
# Trash
# ---------------------------------------------------------------------------

@router.get("/trash")
async def list_trash(
    request: Request,
    api_key: str = Depends(_get_sekura_key),
):
    sekura = _get_sekura(request)
    return await sekura.list_trash(api_key)


@router.post("/trash/{item_type}/{item_id}/restore")
async def restore_item(
    request: Request,
    item_type: str,
    item_id: str,
    api_key: str = Depends(_get_sekura_key),
):
    sekura = _get_sekura(request)
    await sekura.restore_item(api_key, item_type, item_id)
    logger.info("trash item restored: %s/%s", item_type, item_id)
    return {"ok": True}


@router.delete("/trash/{item_type}/{item_id}")
async def delete_permanently(
    request: Request,
    item_type: str,
    item_id: str,
    api_key: str = Depends(_get_sekura_key),
):
    sekura = _get_sekura(request)
    await sekura.delete_permanently(api_key, item_type, item_id)
    logger.info("trash item permanently deleted: %s/%s", item_type, item_id)
    return {"ok": True}


@router.delete("/trash")
async def empty_trash(
    request: Request,
    api_key: str = Depends(_get_sekura_key),
):
    sekura = _get_sekura(request)
    await sekura.empty_trash(api_key)
    logger.info("trash emptied")
    return {"ok": True}


# ---------------------------------------------------------------------------
# Sharing
# ---------------------------------------------------------------------------

@router.post("/shares")
async def create_share(
    request: Request,
    body: SekuraCreateShare,
    api_key: str = Depends(_get_sekura_key),
):
    sekura = _get_sekura(request)
    result = await sekura.create_share(
        api_key, body.resource_type, body.resource_id, body.shared_with, body.permission
    )
    logger.info("share created: %s/%s -> %s", body.resource_type, body.resource_id, body.shared_with)
    return result


@router.get("/shares")
async def list_shares(
    request: Request,
    type: str = Query("owned"),
    api_key: str = Depends(_get_sekura_key),
):
    sekura = _get_sekura(request)
    return await sekura.list_shares(api_key, type)


@router.put("/shares/{share_id}")
async def update_share(
    request: Request,
    share_id: str,
    body: SekuraUpdateShare,
    api_key: str = Depends(_get_sekura_key),
):
    sekura = _get_sekura(request)
    return await sekura.update_share(api_key, share_id, body.permission)


@router.delete("/shares/{share_id}")
async def delete_share(
    request: Request,
    share_id: str,
    api_key: str = Depends(_get_sekura_key),
):
    sekura = _get_sekura(request)
    await sekura.delete_share(api_key, share_id)
    logger.info("share revoked: %s", share_id)
    return {"ok": True}


@router.get("/users/search")
async def search_users(
    request: Request,
    q: str = Query(""),
    api_key: str = Depends(_get_sekura_key),
):
    sekura = _get_sekura(request)
    return await sekura.search_users(api_key, q)
