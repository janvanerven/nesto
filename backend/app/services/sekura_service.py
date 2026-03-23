import asyncio
import logging
import os
from io import BytesIO

import httpx
from fastapi import HTTPException
from PIL import Image, ImageOps

logger = logging.getLogger(__name__)

Image.MAX_IMAGE_PIXELS = 20_000_000
THUMBNAIL_MAX_SIZE = (400, 800)
THUMBNAIL_FETCH_LIMIT = 25 * 1024 * 1024  # 25MB

# Magic bytes for supported image formats
_IMAGE_MAGIC_BYTES = (
    b"\xff\xd8\xff",  # JPEG
    b"\x89PNG",       # PNG
    b"RIFF",          # WebP (RIFF header)
)

# Sekura error status -> Nesto status
_STATUS_MAP = {
    400: 400,
    401: 502,
    403: 502,
    404: 404,
    413: 413,
    429: 503,
}


class SekuraService:
    """Thin proxy to the Sekura document API.

    The instance is stateless with respect to the API key — callers supply
    the decrypted key on every method call. This keeps the instance safe to
    share across requests without risk of key leakage.
    """

    def __init__(self, base_url: str, client: httpx.AsyncClient) -> None:
        self.base_url = base_url.rstrip("/")
        self.client = client

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _headers(self, api_key: str) -> dict:
        return {"Authorization": f"Bearer {api_key}"}

    def _url(self, path: str) -> str:
        return f"{self.base_url}/api/v1{path}"

    def _raise_for_error(self, resp: httpx.Response) -> None:
        if resp.is_success:
            return
        try:
            body = resp.json()
            detail = body.get("detail", resp.reason_phrase)
        except Exception:
            detail = resp.reason_phrase

        status = _STATUS_MAP.get(resp.status_code, 502)
        raise HTTPException(status_code=status, detail=detail)

    # ------------------------------------------------------------------
    # Connection testing
    # ------------------------------------------------------------------

    async def test_connection(self, api_key: str) -> tuple[bool, str | None]:
        """Test connectivity and API key validity. Returns (ok, error_message)."""
        try:
            resp = await self.client.get(
                self._url("/health"),
                headers=self._headers(api_key),
                timeout=10.0,
            )
            if not resp.is_success:
                return False, f"Sekura returned {resp.status_code}"

            me_resp = await self.client.get(
                self._url("/auth/me"),
                headers=self._headers(api_key),
                timeout=10.0,
            )
            if not me_resp.is_success:
                return False, "API key is invalid"

            return True, None
        except httpx.ConnectError:
            return False, "Could not connect to Sekura"
        except httpx.TimeoutException:
            return False, "Connection timed out"
        except Exception as exc:
            return False, str(exc)

    async def detect_key_scope(self, api_key: str) -> str:
        """Detect whether a Sekura API key has read or readwrite scope."""
        try:
            resp = await self.client.get(
                self._url("/api-keys"),
                headers=self._headers(api_key),
                timeout=10.0,
            )
            if resp.is_success:
                keys = resp.json()
                key_prefix = api_key[:20]
                for k in keys:
                    if k.get("prefix") and key_prefix.startswith(k["prefix"]):
                        return k.get("scope", "readwrite")
        except Exception:
            pass
        return "readwrite"  # safe default

    # ------------------------------------------------------------------
    # Folders
    # ------------------------------------------------------------------

    async def list_root_folders(self, api_key: str) -> list[dict]:
        resp = await self.client.get(
            self._url("/folders"), headers=self._headers(api_key)
        )
        self._raise_for_error(resp)
        return resp.json()

    async def get_folder(self, api_key: str, folder_id: str) -> dict:
        resp = await self.client.get(
            self._url(f"/folders/{folder_id}"), headers=self._headers(api_key)
        )
        self._raise_for_error(resp)
        return resp.json()

    async def get_folder_contents(
        self, api_key: str, folder_id: str | None = None
    ) -> dict:
        if folder_id:
            url = self._url(f"/folders/{folder_id}/contents")
        else:
            url = self._url("/folders/root/contents")
        resp = await self.client.get(url, headers=self._headers(api_key))
        self._raise_for_error(resp)
        return resp.json()

    async def get_folder_tree(self, api_key: str) -> list[dict]:
        resp = await self.client.get(
            self._url("/folders/tree"), headers=self._headers(api_key)
        )
        self._raise_for_error(resp)
        return resp.json()

    async def create_folder(
        self, api_key: str, name: str, parent_id: str | None = None
    ) -> dict:
        body: dict = {"name": name}
        if parent_id:
            body["parent_id"] = parent_id
        resp = await self.client.post(
            self._url("/folders"), headers=self._headers(api_key), json=body
        )
        self._raise_for_error(resp)
        return resp.json()

    async def rename_folder(
        self, api_key: str, folder_id: str, name: str
    ) -> dict:
        resp = await self.client.put(
            self._url(f"/folders/{folder_id}"),
            headers=self._headers(api_key),
            json={"name": name},
        )
        self._raise_for_error(resp)
        return resp.json()

    async def move_folder(
        self, api_key: str, folder_id: str, parent_id: str | None
    ) -> dict:
        resp = await self.client.put(
            self._url(f"/folders/{folder_id}"),
            headers=self._headers(api_key),
            json={"parent_folder_id": parent_id},
        )
        self._raise_for_error(resp)
        return resp.json()

    async def delete_folder(self, api_key: str, folder_id: str) -> None:
        resp = await self.client.delete(
            self._url(f"/folders/{folder_id}"), headers=self._headers(api_key)
        )
        self._raise_for_error(resp)

    # ------------------------------------------------------------------
    # Files
    # ------------------------------------------------------------------

    async def upload_file(
        self,
        api_key: str,
        file: "UploadFile",  # type: ignore[name-defined]
        folder_id: str | None = None,
    ) -> dict:
        data: dict = {}
        if folder_id:
            data["folder_id"] = folder_id
        files = {"file": (file.filename, file.file, file.content_type)}
        resp = await self.client.post(
            self._url("/files"),
            headers=self._headers(api_key),
            files=files,
            data=data,
            timeout=httpx.Timeout(30.0, read=300.0, write=300.0),
        )
        self._raise_for_error(resp)
        return resp.json()

    async def get_file(self, api_key: str, file_id: str) -> dict:
        resp = await self.client.get(
            self._url(f"/files/{file_id}"), headers=self._headers(api_key)
        )
        self._raise_for_error(resp)
        return resp.json()

    async def download_file_stream(self, api_key: str, file_id: str) -> httpx.Response:
        """Return a streaming httpx Response. Caller is responsible for closing it."""
        req = self.client.build_request(
            "GET",
            self._url(f"/files/{file_id}/download"),
            headers=self._headers(api_key),
        )
        resp = await self.client.send(req, stream=True)
        self._raise_for_error(resp)
        return resp

    async def rename_file(
        self, api_key: str, file_id: str, name: str
    ) -> dict:
        resp = await self.client.put(
            self._url(f"/files/{file_id}"),
            headers=self._headers(api_key),
            json={"name": name},
        )
        self._raise_for_error(resp)
        return resp.json()

    async def move_file(
        self, api_key: str, file_id: str, folder_id: str | None
    ) -> dict:
        resp = await self.client.put(
            self._url(f"/files/{file_id}"),
            headers=self._headers(api_key),
            json={"parent_folder_id": folder_id},
        )
        self._raise_for_error(resp)
        return resp.json()

    async def delete_file(self, api_key: str, file_id: str) -> None:
        resp = await self.client.delete(
            self._url(f"/files/{file_id}"), headers=self._headers(api_key)
        )
        self._raise_for_error(resp)

    # ------------------------------------------------------------------
    # Versioning
    # ------------------------------------------------------------------

    async def upload_new_version(
        self,
        api_key: str,
        file_id: str,
        file: "UploadFile",  # type: ignore[name-defined]
    ) -> dict:
        files = {"file": (file.filename, file.file, file.content_type)}
        resp = await self.client.post(
            self._url(f"/files/{file_id}/upload"),
            headers=self._headers(api_key),
            files=files,
            timeout=httpx.Timeout(30.0, read=300.0, write=300.0),
        )
        self._raise_for_error(resp)
        return resp.json()

    async def list_versions(self, api_key: str, file_id: str) -> list[dict]:
        resp = await self.client.get(
            self._url(f"/files/{file_id}/versions"), headers=self._headers(api_key)
        )
        self._raise_for_error(resp)
        return resp.json()

    async def download_version_stream(
        self, api_key: str, file_id: str, version_id: str
    ) -> httpx.Response:
        req = self.client.build_request(
            "GET",
            self._url(f"/files/{file_id}/versions/{version_id}/download"),
            headers=self._headers(api_key),
        )
        resp = await self.client.send(req, stream=True)
        self._raise_for_error(resp)
        return resp

    # ------------------------------------------------------------------
    # Trash
    # ------------------------------------------------------------------

    async def list_trash(self, api_key: str) -> list[dict]:
        resp = await self.client.get(
            self._url("/trash"), headers=self._headers(api_key)
        )
        self._raise_for_error(resp)
        return resp.json()

    async def restore_item(
        self, api_key: str, item_type: str, item_id: str
    ) -> None:
        resp = await self.client.post(
            self._url(f"/trash/{item_type}/{item_id}/restore"),
            headers=self._headers(api_key),
        )
        self._raise_for_error(resp)

    async def delete_permanently(
        self, api_key: str, item_type: str, item_id: str
    ) -> None:
        resp = await self.client.delete(
            self._url(f"/trash/{item_type}/{item_id}"),
            headers=self._headers(api_key),
        )
        self._raise_for_error(resp)

    async def empty_trash(self, api_key: str) -> None:
        resp = await self.client.delete(
            self._url("/trash"), headers=self._headers(api_key)
        )
        self._raise_for_error(resp)

    # ------------------------------------------------------------------
    # Sharing
    # ------------------------------------------------------------------

    async def create_share(
        self,
        api_key: str,
        resource_type: str,
        resource_id: str,
        shared_with: str,
        permission: str,
    ) -> dict:
        resp = await self.client.post(
            self._url("/shares"),
            headers=self._headers(api_key),
            json={
                "resource_type": resource_type,
                "resource_id": resource_id,
                "shared_with": shared_with,
                "permission": permission,
            },
        )
        self._raise_for_error(resp)
        return resp.json()

    async def list_shares(
        self, api_key: str, share_type: str = "owned"
    ) -> list[dict]:
        resp = await self.client.get(
            self._url("/shares"),
            headers=self._headers(api_key),
            params={"type": share_type},
        )
        self._raise_for_error(resp)
        return resp.json()

    async def update_share(
        self, api_key: str, share_id: str, permission: str
    ) -> dict:
        resp = await self.client.put(
            self._url(f"/shares/{share_id}"),
            headers=self._headers(api_key),
            json={"permission": permission},
        )
        self._raise_for_error(resp)
        return resp.json()

    async def delete_share(self, api_key: str, share_id: str) -> None:
        resp = await self.client.delete(
            self._url(f"/shares/{share_id}"), headers=self._headers(api_key)
        )
        self._raise_for_error(resp)

    async def search_users(
        self, api_key: str, query: str = ""
    ) -> list[dict]:
        resp = await self.client.get(
            self._url("/users/search"),
            headers=self._headers(api_key),
            params={"q": query} if query else {},
        )
        self._raise_for_error(resp)
        return resp.json()

    # ------------------------------------------------------------------
    # Thumbnails
    # ------------------------------------------------------------------

    async def get_thumbnail(
        self,
        api_key: str,
        file_id: str,
        cache_dir: str = "data/thumbnail-cache",
    ) -> bytes | None:
        """Return thumbnail bytes, generating and caching on first access.

        Returns None if the file is not an image, exceeds the size cap, or
        thumbnail generation fails. Never raises — callers should return 404.
        """
        os.makedirs(cache_dir, exist_ok=True)

        # Cache hit: any file starting with file_id prefix
        for fname in os.listdir(cache_dir):
            if fname.startswith(file_id):
                cached_path = os.path.join(cache_dir, fname)
                with open(cached_path, "rb") as f:
                    return f.read()

        # Cache miss: fetch metadata first to check mime type and size
        try:
            meta_resp = await self.client.get(
                self._url(f"/files/{file_id}"), headers=self._headers(api_key)
            )
            if not meta_resp.is_success:
                return None
            meta = meta_resp.json()

            mime = meta.get("mime_type", "")
            if not mime.startswith("image/"):
                return None

            size = meta.get("size", 0)
            if size > THUMBNAIL_FETCH_LIMIT:
                return None

            # Download the full file for thumbnail generation
            dl_resp = await self.client.get(
                self._url(f"/files/{file_id}/download"),
                headers=self._headers(api_key),
            )
            if not dl_resp.is_success:
                return None

            content = dl_resp.content

            # Validate magic bytes before passing to PIL
            if not any(content.startswith(magic) for magic in _IMAGE_MAGIC_BYTES):
                return None

            # PIL is CPU-bound — run in a thread to avoid blocking the event loop
            thumb_bytes = await asyncio.to_thread(self._generate_thumbnail, content)
            if thumb_bytes is None:
                return None

            # Cache with etag-like key derived from updated_at
            etag = meta.get("updated_at", "none").replace(":", "-").replace(" ", "_")
            cache_path = os.path.join(cache_dir, f"{file_id}_{etag}.jpg")
            with open(cache_path, "wb") as f:
                f.write(thumb_bytes)

            return thumb_bytes

        except Exception:
            logger.warning("Thumbnail generation failed for file %s", file_id, exc_info=True)
            return None

    @staticmethod
    def _generate_thumbnail(content: bytes) -> bytes | None:
        """Generate a JPEG thumbnail from raw image bytes. CPU-bound; run in thread."""
        try:
            img = Image.open(BytesIO(content))
            img = ImageOps.exif_transpose(img)
            img.thumbnail(THUMBNAIL_MAX_SIZE, Image.Resampling.LANCZOS)
            if img.mode != "RGB":
                img = img.convert("RGB")
            buf = BytesIO()
            img.save(buf, format="JPEG", quality=80)
            return buf.getvalue()
        except Exception:
            return None
