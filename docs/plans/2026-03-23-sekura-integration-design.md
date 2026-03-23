# Sekura Integration Design

**Date:** 2026-03-23
**Status:** Approved

## Overview

Replace Nesto's local document storage with Sekura as the document backend. Nesto becomes a frontend to Sekura's document vault via a thin backend proxy. All file storage, versioning, trash, and sharing are handled by Sekura. Nesto handles authentication, proxying, thumbnail caching, and the UI.

## Architecture

**Pattern:** Thin proxy. Nesto's backend proxies all Sekura API calls. The frontend never talks to Sekura directly.

- `SEKURA_URL` is a server-level env var (not per-user/per-household)
- Per-user Sekura API keys stored encrypted in Nesto's DB (Fernet/HKDF, same as CalDAV credentials)
- API key decrypted per-request, passed to `SekuraService`
- File uploads/downloads streamed (not buffered) via `httpx.AsyncClient.stream()` + `StreamingResponse`
- Thumbnails cached locally in `data/thumbnail-cache/` keyed by `{file_id}_{etag}.jpg`

**Why proxy, not frontend-direct:**
- API keys stay server-side only
- No CORS/CSP configuration needed on Sekura
- Works regardless of network topology (Sekura can be on an internal network)
- Matches existing CalDAV integration pattern

## Configuration & Data Model

### Environment Variable

`SEKURA_URL` — optional, added to `config.py`. Empty string means Sekura is not available.

### Database

New table `sekura_connections`:

| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | UUID |
| user_id | TEXT FK -> users | NOT NULL, unique |
| encrypted_api_key | TEXT | Fernet-encrypted |
| key_scope | TEXT | `read` or `readwrite` |
| created_at | DATETIME | server default |

No `household_id` — the key is per-user. Sekura's own permissions handle visibility.

### Migration

Single Alembic migration:
1. Create `sekura_connections`
2. Drop `document_tag_links`, `document_tags`, `documents`

Existing files in `data/documents/` are orphaned — manual cleanup documented.

### Removed

- Models: `Document`, `DocumentTag`, `DocumentTagLink`
- Service: `document_service.py`
- Schemas: document schemas
- Router: document and document-tag routers (rewritten)
- Frontend: `api/documents.ts`, old document components
- Lifespan: `os.makedirs("data/documents")` removed

## Backend Architecture

### SekuraService

`backend/app/services/sekura_service.py` — single class, stateless, ~200-300 lines.

Receives decrypted API key per call. Holds a reference to the shared `httpx.AsyncClient` and the Sekura base URL.

Methods:

**Folders:** `list_root_folders`, `get_folder`, `get_folder_contents`, `get_folder_tree`, `create_folder`, `rename_folder`, `move_folder`, `delete_folder`

**Files:** `upload_file`, `get_file`, `download_file`, `rename_file`, `move_file`, `delete_file`, `fetch_file_for_thumbnail` (size-capped)

**Versioning:** `upload_new_version`, `list_versions`, `download_version`

**Trash:** `list_trash`, `restore_item`, `delete_permanently`, `empty_trash`

**Sharing:** `create_share`, `list_shares`, `update_share`, `delete_share`, `search_users`

### httpx Client

Singleton `httpx.AsyncClient` in FastAPI lifespan on `app.state`:
- `Timeout(30.0, read=300.0)`
- `Limits(max_connections=20, max_keepalive_connections=10)`
- Closed on shutdown

### Router

All under `/api/households/{household_id}/documents/...`:

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/folders` | Root folder listing |
| POST | `/folders` | Create folder |
| GET | `/folders/tree` | Full folder tree |
| GET | `/folders/{id}` | Folder detail |
| GET | `/folders/{id}/contents` | Folder contents |
| PUT | `/folders/{id}` | Rename/move folder |
| DELETE | `/folders/{id}` | Soft-delete folder |
| POST | `/files` | Upload file |
| GET | `/files/{id}` | File metadata |
| GET | `/files/{id}/download` | Stream download |
| GET | `/files/{id}/thumbnail` | Cached thumbnail |
| PUT | `/files/{id}` | Rename/move file |
| DELETE | `/files/{id}` | Soft-delete file |
| POST | `/files/{id}/versions` | Upload new version |
| GET | `/files/{id}/versions` | List versions |
| GET | `/files/{id}/versions/{vid}/download` | Download version |
| GET | `/trash` | List trash |
| POST | `/trash/{type}/{id}/restore` | Restore |
| DELETE | `/trash/{type}/{id}` | Permanent delete |
| DELETE | `/trash` | Empty trash |
| POST | `/shares` | Create share |
| GET | `/shares` | List shares |
| PUT | `/shares/{id}` | Update share permission |
| DELETE | `/shares/{id}` | Revoke share |
| GET | `/users/search` | Search users for sharing |

### Sekura Connection API

Under `/api/auth/me/sekura` (user-scoped, not household-scoped):

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/auth/me/sekura` | Check if configured (`{ configured, key_scope? }`) |
| POST | `/api/auth/me/sekura` | Save API key (encrypt + store, detect scope via Sekura API) |
| DELETE | `/api/auth/me/sekura` | Remove stored key |
| POST | `/api/auth/me/sekura/test` | Test connection (calls Sekura `/health` + `/auth/me`) |

### Error Handling

Single `raise_for_sekura_error(resp)` helper:
- Sekura 401/403 -> Nesto 502 (bad gateway, not user auth failure)
- Sekura 404 -> 404
- Sekura 413 -> 413
- Sekura 429 -> 503
- Error messages sanitized (no internal URLs/paths leaked)

### Thumbnail Caching

- Cache dir: `data/thumbnail-cache/`
- Cache key: `{file_id}_{etag}.jpg`
- Flow: check cache -> hit: serve. Miss: fetch from Sekura (cap 25MB), validate magic bytes, PIL resize in `asyncio.to_thread()`, save to cache, serve.
- `Image.MAX_IMAGE_PIXELS = 20_000_000`
- Failure does not block the request — return 404 for thumbnail

### Audit Logging

Log upload, delete, share, and trash operations with user_id, household_id, and Sekura resource path to application log.

### nginx

Separate location block for document routes:
- `client_max_body_size 100m`
- `proxy_read_timeout 300s`

## Frontend Architecture

### API Hooks

`frontend/src/api/sekura.ts` — replaces `documents.ts`. Query key namespace: `['sekura', ...]`.

**Connection:** `useSekuraConnection`, `useSaveSekuraKey`, `useDeleteSekuraKey`, `useTestSekuraConnection`

**Folders:** `useFolderContents(householdId, folderId?)`, `useFolderTree(householdId)`, `useCreateFolder`, `useRenameFolder`, `useMoveFolder`, `useDeleteFolder`

**Files:** `useFile(householdId, fileId)`, `useUploadFile`, `useRenameFile`, `useMoveFile`, `useDeleteFile`

**Versioning:** `useFileVersions(householdId, fileId)`, `useUploadVersion`

**Trash:** `useTrash`, `useRestoreItem`, `useDeletePermanently`, `useEmptyTrash`

**Sharing:** `useShares`, `useCreateShare`, `useUpdateShare`, `useDeleteShare`, `useSearchUsers`

All queries gated on `hasToken()`.

### Cache Invalidation

- Upload/create folder/delete/rename: invalidate `['sekura', 'folder', parentFolderId]`
- Move: invalidate source + destination folder
- Trash/restore: invalidate source folder + `['sekura', 'trash']`

### Route Structure

```
routes/
  documents.tsx                    -> layout with Outlet (keep)
  documents.index.tsx              -> root folder contents (rewrite)
  documents.folder.$folderId.tsx   -> subfolder contents (new)
  documents.file.$fileId.tsx       -> file detail (new, replaces $docId)
  documents.trash.tsx              -> trash view (v2)
```

Both `documents.index.tsx` and `documents.folder.$folderId.tsx` render a shared `<FolderContents folderId={folderId ?? "root"} />` component.

### Components

| Component | Purpose |
|-----------|---------|
| `folder-contents.tsx` | Grid of folders + files, shared by index and folder routes |
| `breadcrumbs.tsx` | Horizontal scrollable path from API ancestors |
| `upload-file-sheet.tsx` | Bottom sheet, accepts target folderId |
| `create-folder-sheet.tsx` | Bottom sheet, name input |
| `file-card.tsx` | File entry — thumbnail or icon, name, size |
| `folder-card.tsx` | Folder entry — icon, name, item count |
| `rename-sheet.tsx` | Bottom sheet for renaming files/folders |
| `move-sheet.tsx` | One-level-at-a-time folder picker (v2) |
| `share-sheet.tsx` | Share management on file/folder (v2) |

Deleted: `upload-document-sheet.tsx`, tag-related document components, `documents.$docId.tsx`

### Key UI Details

**Folder contents view:** Breadcrumb bar (scrollable), folders first then files, client-side search with debounce, FAB with upload + create folder actions.

**File detail view:** Back button navigates to parent folder (not /documents). Image preview via `useAuthenticatedImage` or file type icon. Metadata card. Download, rename, delete actions. Versions section (v2). Sharing section (v2).

**Settings page:** New "Sekura" card section. API Key input (password field), Test Connection button, Save/Remove buttons, status indicator.

**Conditional nav:** Documents item in `more.tsx` filtered by `useSekuraConnection()`. Prefetch on More page load to avoid flash.

**Read-only mode:** If key_scope is `read`, hide upload/create/rename/delete UI elements.

## Build Order

### v1

1. Settings: Sekura connection config (save/test/remove API key)
2. Folder browsing + breadcrumbs (read-only listing)
3. Upload to current folder
4. File detail page (metadata, download, thumbnail)
5. Create folder
6. Rename (file and folder)
7. Delete (soft-delete to Sekura trash)

### v2

8. Trash view + restore + permanent delete
9. Move (file and folder)
10. Versioning (list versions, upload new version, download old version)
11. Sharing (create/manage shares, search users)

## Security Considerations

- **API keys server-side only** — never exposed to frontend
- **SSRF eliminated** — `SEKURA_URL` is a server env var, not user-configurable
- **Streaming** — no buffering large files in memory
- **Thumbnail safety** — magic byte validation, pixel limit, size cap, PIL in thread
- **Error sanitization** — no internal URLs/paths leaked to frontend
- **Scope enforcement** — Nesto hides write UI for read-only keys; Sekura enforces server-side
- **Audit trail** — mutations logged with user context
- **Sekura 401/403 -> 502** — prevents frontend token refresh confusion
