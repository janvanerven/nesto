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

export function getDocumentFileUrl(householdId: string, docId: string): string {
  return `/api/households/${householdId}/documents/${docId}/file`
}

export function getDocumentThumbnailUrl(householdId: string, docId: string): string {
  return `/api/households/${householdId}/documents/${docId}/thumbnail`
}
