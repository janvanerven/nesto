import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch, hasToken, getAccessToken } from './client'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SekuraConnection {
  configured: boolean
  key_scope?: 'read' | 'readwrite'
}

export interface SekuraTestResult {
  ok: boolean
  message: string
}

export interface FolderItem {
  id: string
  name: string
  parent_id: string | null
  item_count: number
  created_at: string
  updated_at: string
}

export interface FileItem {
  id: string
  name: string
  folder_id: string | null
  mime_type: string
  size_bytes: number
  etag: string | null
  has_thumbnail: boolean
  created_at: string
  updated_at: string
}

export interface FolderContentsResponse {
  folder: FolderItem | null
  ancestors: FolderItem[]
  folders: FolderItem[]
  files: FileItem[]
}

export interface FolderTreeNode {
  id: string
  name: string
  children: FolderTreeNode[]
}

// ─── Connection hooks ─────────────────────────────────────────────────────────

export function useSekuraConnection() {
  return useQuery({
    queryKey: ['sekura', 'connection'],
    queryFn: () => apiFetch<SekuraConnection>('/auth/me/sekura'),
    enabled: hasToken(),
  })
}

export function useSaveSekuraKey() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (apiKey: string) =>
      apiFetch<SekuraConnection>('/auth/me/sekura', {
        method: 'POST',
        body: JSON.stringify({ api_key: apiKey }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sekura', 'connection'] }),
  })
}

export function useDeleteSekuraKey() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => apiFetch<void>('/auth/me/sekura', { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sekura', 'connection'] }),
  })
}

export function useTestSekuraConnection() {
  return useMutation({
    mutationFn: () => apiFetch<SekuraTestResult>('/auth/me/sekura/test', { method: 'POST' }),
  })
}

// ─── Folder hooks ─────────────────────────────────────────────────────────────

export function useFolderContents(householdId: string, folderId?: string) {
  const path = folderId
    ? `/households/${householdId}/documents/folders/${folderId}/contents`
    : `/households/${householdId}/documents/folders`
  return useQuery({
    queryKey: ['sekura', 'folder', folderId ?? 'root', householdId],
    queryFn: () => apiFetch<FolderContentsResponse>(path),
    enabled: !!householdId && hasToken(),
  })
}

export function useFolderTree(householdId: string) {
  return useQuery({
    queryKey: ['sekura', 'folder-tree', householdId],
    queryFn: () => apiFetch<FolderTreeNode[]>(`/households/${householdId}/documents/folders/tree`),
    enabled: !!householdId && hasToken(),
  })
}

export function useCreateFolder(householdId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ name, parentId }: { name: string; parentId?: string }) =>
      apiFetch<FolderItem>(`/households/${householdId}/documents/folders`, {
        method: 'POST',
        body: JSON.stringify({ name, parent_id: parentId ?? null }),
      }),
    onSuccess: (_data, { parentId }) => {
      qc.invalidateQueries({ queryKey: ['sekura', 'folder', parentId ?? 'root', householdId] })
      qc.invalidateQueries({ queryKey: ['sekura', 'folder-tree', householdId] })
    },
  })
}

export function useRenameFolder(householdId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ folderId, name }: { folderId: string; name: string; parentId?: string }) =>
      apiFetch<FolderItem>(`/households/${householdId}/documents/folders/${folderId}`, {
        method: 'PUT',
        body: JSON.stringify({ name }),
      }),
    onSuccess: (_data, { parentId }) => {
      qc.invalidateQueries({ queryKey: ['sekura', 'folder', parentId ?? 'root', householdId] })
      qc.invalidateQueries({ queryKey: ['sekura', 'folder-tree', householdId] })
    },
  })
}

export function useDeleteFolder(householdId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ folderId }: { folderId: string; parentId?: string }) =>
      apiFetch<void>(`/households/${householdId}/documents/folders/${folderId}`, {
        method: 'DELETE',
      }),
    onSuccess: (_data, { parentId }) => {
      qc.invalidateQueries({ queryKey: ['sekura', 'folder', parentId ?? 'root', householdId] })
      qc.invalidateQueries({ queryKey: ['sekura', 'folder-tree', householdId] })
    },
  })
}

// ─── File hooks ───────────────────────────────────────────────────────────────

export function useFile(householdId: string, fileId: string) {
  return useQuery({
    queryKey: ['sekura', 'file', fileId, householdId],
    queryFn: () => apiFetch<FileItem>(`/households/${householdId}/documents/files/${fileId}`),
    enabled: !!householdId && !!fileId && hasToken(),
  })
}

export function useUploadFile(householdId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ file, folderId }: { file: File; folderId?: string }) => {
      const formData = new FormData()
      formData.append('file', file)
      if (folderId) formData.append('folder_id', folderId)

      const token = getAccessToken()
      const res = await fetch(`/api/households/${householdId}/documents/files`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: 'Upload failed' }))
        throw new Error(err.detail || 'Upload failed')
      }
      return res.json() as Promise<FileItem>
    },
    onSuccess: (_data, { folderId }) => {
      qc.invalidateQueries({ queryKey: ['sekura', 'folder', folderId ?? 'root', householdId] })
    },
  })
}

export function useRenameFile(householdId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ fileId, name }: { fileId: string; name: string; folderId?: string }) =>
      apiFetch<FileItem>(`/households/${householdId}/documents/files/${fileId}`, {
        method: 'PUT',
        body: JSON.stringify({ name }),
      }),
    onSuccess: (_data, { fileId, folderId }) => {
      qc.invalidateQueries({ queryKey: ['sekura', 'file', fileId, householdId] })
      qc.invalidateQueries({ queryKey: ['sekura', 'folder', folderId ?? 'root', householdId] })
    },
  })
}

export function useDeleteFile(householdId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ fileId }: { fileId: string; folderId?: string }) =>
      apiFetch<void>(`/households/${householdId}/documents/files/${fileId}`, { method: 'DELETE' }),
    onSuccess: (_data, { folderId }) => {
      qc.invalidateQueries({ queryKey: ['sekura', 'folder', folderId ?? 'root', householdId] })
    },
  })
}

// ─── URL helpers ──────────────────────────────────────────────────────────────

export function getFileDownloadUrl(householdId: string, fileId: string): string {
  return `/api/households/${householdId}/documents/files/${fileId}/download`
}

export function getFileThumbnailUrl(householdId: string, fileId: string): string {
  return `/api/households/${householdId}/documents/files/${fileId}/thumbnail`
}
