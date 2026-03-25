import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch, hasToken } from './client'

export interface Comment {
  id: string
  entity_type: string
  entity_id: string
  author_id: string
  author_name: string
  content: string
  created_at: string
}

export interface CommentCreate {
  content: string
  mentions?: string[]
}

export function useComments(householdId: string, entityType: 'task' | 'event', entityId: string) {
  return useQuery({
    queryKey: ['comments', householdId, entityType, entityId],
    queryFn: () =>
      apiFetch<Comment[]>(`/households/${householdId}/comments/${entityType}/${entityId}`),
    enabled: !!householdId && !!entityId && hasToken(),
  })
}

export function useCreateComment(householdId: string, entityType: 'task' | 'event', entityId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: CommentCreate) =>
      apiFetch<Comment>(`/households/${householdId}/comments/${entityType}/${entityId}`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['comments', householdId, entityType, entityId] }),
  })
}

export function useDeleteComment(householdId: string, entityType: 'task' | 'event', entityId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (commentId: string) =>
      apiFetch<void>(
        `/households/${householdId}/comments/${entityType}/${entityId}/${commentId}`,
        { method: 'DELETE' },
      ),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['comments', householdId, entityType, entityId] }),
  })
}
