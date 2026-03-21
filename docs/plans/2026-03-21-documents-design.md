# Documents Feature Design

**Date:** 2026-03-21
**Status:** Approved

## Overview

Add a general-purpose document storage feature to Nesto. Household members can upload, tag, and browse documents (receipts, warranties, insurance papers, manuals, etc.). Files are stored on the filesystem with metadata in SQLite.

## Approach

Filesystem storage with metadata in DB. Files saved to `data/documents/{household_id}/{document_id}/{filename}` inside the existing Docker volume. Thumbnails generated server-side for images using Pillow.

## Data Model

### New table: `documents`

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | UUID |
| `household_id` | TEXT FK → households | CASCADE |
| `uploaded_by` | TEXT FK → users | Who uploaded |
| `filename` | TEXT | Original filename |
| `storage_path` | TEXT | Relative path on disk |
| `mime_type` | TEXT | e.g. `image/jpeg`, `application/pdf` |
| `size_bytes` | INTEGER | File size |
| `created_at` | DATETIME | Upload timestamp |

### New table: `document_tags`

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | UUID |
| `household_id` | TEXT FK → households | CASCADE |
| `name` | TEXT | e.g. "Washing machine", "Warranty" |
| `category` | TEXT | `type` or `subject` |

### New table: `document_tag_links` (join table)

| Column | Type | Notes |
|---|---|---|
| `document_id` | TEXT FK → documents | CASCADE |
| `tag_id` | TEXT FK → document_tags | CASCADE |
| (composite PK) | | |

Tags are household-scoped and reusable. The `category` column distinguishes type-tags (warranty, receipt, manual, insurance, contract) from subject-tags (washing machine, car, house) so the UI can show them in separate filter groups.

## File Storage

- **Location:** `data/documents/{household_id}/{document_id}/{filename}`
- **Thumbnails:** For images (JPEG/PNG/WebP), a 400px-wide thumbnail saved as `thumb_{filename}` alongside the original. PDFs get no thumbnail (PDF icon in UI).
- **Max file size:** 25 MB
- **Allowed mime types:** `image/jpeg`, `image/png`, `image/webp`, `application/pdf`
- **Volume:** Same Docker volume as the SQLite database

## API Endpoints

| Method | Endpoint | Notes |
|---|---|---|
| `GET` | `/api/households/{id}/documents` | List with tags. Filter: `?type_tag=...&subject_tag=...&search=...` |
| `POST` | `/api/households/{id}/documents` | Multipart upload (file + JSON metadata with tag IDs). Max 25MB |
| `GET` | `/api/households/{id}/documents/{docId}` | Document metadata |
| `GET` | `/api/households/{id}/documents/{docId}/file` | Serve actual file (authenticated) |
| `GET` | `/api/households/{id}/documents/{docId}/thumbnail` | Serve thumbnail (404 if none) |
| `DELETE` | `/api/households/{id}/documents/{docId}` | Delete document + file from disk |
| `PATCH` | `/api/households/{id}/documents/{docId}` | Update tags, rename |
| `GET` | `/api/households/{id}/document-tags` | List all tags |
| `POST` | `/api/households/{id}/document-tags` | Create tag |
| `DELETE` | `/api/households/{id}/document-tags/{tagId}` | Delete tag (unlinks, doesn't delete docs) |

**Upload flow:** `multipart/form-data` POST with file and a `metadata` JSON field containing `{ tags: [tagId, ...] }`. Backend validates size/mime, writes to disk, generates thumbnail if image, creates DB record.

## Frontend

### Navigation change

Bottom nav 5th tab becomes "More" (grid icon). More page links to:
- Cards (existing, moved from tab)
- Documents (new)
- Settings (existing, moved from tab)

All routes keep their current paths (`/cards`, `/settings`, `/documents`). Only the bottom nav changes.

### Documents page (`/documents`)

- Search bar + filter chips for type tags and subject tags (two rows, visually distinct)
- Document grid showing thumbnail (or PDF icon), filename, tags, upload date
- Tap opens detail view
- FAB (+) to upload

### Upload flow

- FAB → native file picker (camera + files on mobile)
- Bottom sheet: filename, tag selection (type + subject as pill selectors, "+" to create inline), upload button
- Progress indicator during upload

### Document detail

- Full-width image preview (pinch to zoom) or PDF download button
- Filename, uploaded by, date, size
- Tag chips (editable)
- Delete with confirmation

### Tag management

Tags created inline during upload/edit. No separate management page needed.

## Infrastructure

### Backup

Mount documents directory in backup service. Add `cp -r` of documents alongside the SQLite backup.

### nginx

Increase `client_max_body_size` to 25MB for the documents upload endpoint via a scoped location block.

### New dependency

`Pillow` — image thumbnail generation.

## Design Decisions

| Decision | Rationale |
|---|---|
| Filesystem storage | Simplest for self-hosted, single-server. No extra services needed |
| Two-category tags (type/subject) | Powerful filtering without complex folder hierarchies |
| Thumbnails only for images | PDFs are complex to render server-side; icon is sufficient |
| No folder hierarchy | Tags are more flexible and simpler to implement |
| "More" tab in nav | 6 tabs is too cramped on mobile; groups less-frequent features |
| Routes keep current paths | Minimal disruption; only bottom nav component changes |
| 25MB max file size | Generous for scanned docs and manuals |
| Upload date only | YAGNI — expiry dates and purchase dates add complexity for little value |
