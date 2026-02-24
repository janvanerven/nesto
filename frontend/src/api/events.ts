import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch, hasToken } from './client'

export interface CalendarEvent {
  id: string
  household_id: string
  title: string
  description: string | null
  start_time: string
  end_time: string
  assigned_to: string | null
  created_by: string
  recurrence_rule: string | null
  recurrence_interval: number
  recurrence_end: string | null
  created_at: string
  updated_at: string
}

export interface EventCreate {
  title: string
  description?: string
  start_time: string
  end_time: string
  assigned_to?: string
  recurrence_rule?: string
  recurrence_interval?: number
  recurrence_end?: string
}

export interface EventUpdate {
  title?: string
  description?: string
  start_time?: string
  end_time?: string
  assigned_to?: string
  recurrence_rule?: string | null
  recurrence_interval?: number
  recurrence_end?: string | null
}

export function useEvents(householdId: string, start: string, end: string) {
  return useQuery({
    queryKey: ['events', householdId, start, end],
    queryFn: () =>
      apiFetch<CalendarEvent[]>(
        `/households/${householdId}/events?start=${start}&end=${end}`
      ),
    enabled: !!householdId && hasToken(),
  })
}

export function useCreateEvent(householdId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (event: EventCreate) =>
      apiFetch<CalendarEvent>(`/households/${householdId}/events`, {
        method: 'POST',
        body: JSON.stringify(event),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['events', householdId] }),
  })
}

export function useUpdateEvent(householdId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ eventId, ...update }: EventUpdate & { eventId: string }) =>
      apiFetch<CalendarEvent>(`/households/${householdId}/events/${eventId}`, {
        method: 'PATCH',
        body: JSON.stringify(update),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['events', householdId] }),
  })
}

export function useDeleteEvent(householdId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (eventId: string) =>
      apiFetch<void>(`/households/${householdId}/events/${eventId}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['events', householdId] }),
  })
}
