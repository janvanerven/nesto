import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch, hasToken } from './client'

export interface Notice {
  id: string
  household_id: string
  author_id: string
  content: string
  pinned: boolean
  created_at: string
  updated_at: string | null
}

export interface NoticeCreate {
  content: string
}

export interface NoticePatch {
  content?: string
  pinned?: boolean
}

export function useNotices(householdId: string, params?: { limit?: number; offset?: number }) {
  const query = new URLSearchParams()
  if (params?.limit) query.set('limit', String(params.limit))
  if (params?.offset) query.set('offset', String(params.offset))
  const qs = query.toString() ? `?${query}` : ''

  return useQuery({
    queryKey: ['notices', householdId, params],
    queryFn: () => apiFetch<Notice[]>(`/households/${householdId}/notices${qs}`),
    enabled: !!householdId && hasToken(),
  })
}

export function useCreateNotice(householdId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: NoticeCreate) =>
      apiFetch<Notice>(`/households/${householdId}/notices`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notices', householdId] }),
  })
}

export function usePatchNotice(householdId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ noticeId, ...patch }: NoticePatch & { noticeId: string }) =>
      apiFetch<Notice>(`/households/${householdId}/notices/${noticeId}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notices', householdId] }),
  })
}

export function useDeleteNotice(householdId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (noticeId: string) =>
      apiFetch<void>(`/households/${householdId}/notices/${noticeId}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notices', householdId] }),
  })
}
