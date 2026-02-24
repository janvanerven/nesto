import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch, hasToken } from './client'

export interface Task {
  id: string
  household_id: string
  title: string
  description: string | null
  status: string
  priority: number
  assigned_to: string | null
  created_by: string
  due_date: string | null
  completed_at: string | null
  category: string | null
  created_at: string
  updated_at: string
}

export interface TaskCreate {
  title: string
  description?: string
  priority?: number
  assigned_to?: string
  due_date?: string
  category?: string
}

export interface TaskUpdate {
  title?: string
  description?: string
  status?: string
  priority?: number
  assigned_to?: string
  due_date?: string
  category?: string
}

export function useTasks(householdId: string, filters?: { status?: string; priority?: number; assigned_to?: string }) {
  const params = new URLSearchParams()
  if (filters?.status) params.set('status', filters.status)
  if (filters?.priority) params.set('priority', String(filters.priority))
  if (filters?.assigned_to) params.set('assigned_to', filters.assigned_to)
  const qs = params.toString()

  return useQuery({
    queryKey: ['tasks', householdId, filters],
    queryFn: () => apiFetch<Task[]>(`/households/${householdId}/tasks${qs ? `?${qs}` : ''}`),
    enabled: !!householdId && hasToken(),
  })
}

export function useCreateTask(householdId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (task: TaskCreate) =>
      apiFetch<Task>(`/households/${householdId}/tasks`, {
        method: 'POST',
        body: JSON.stringify(task),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks', householdId] }),
  })
}

export function useUpdateTask(householdId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ taskId, ...update }: TaskUpdate & { taskId: string }) =>
      apiFetch<Task>(`/households/${householdId}/tasks/${taskId}`, {
        method: 'PATCH',
        body: JSON.stringify(update),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks', householdId] }),
  })
}

export function useDeleteTask(householdId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (taskId: string) =>
      apiFetch<void>(`/households/${householdId}/tasks/${taskId}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks', householdId] }),
  })
}
