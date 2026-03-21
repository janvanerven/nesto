import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch, hasToken } from './client'

export interface CalendarConnection {
  id: string
  user_id: string
  household_id: string
  name: string
  provider: string
  server_url: string
  calendar_url: string
  username: string
  color: string
  sync_token: string | null
  last_synced_at: string | null
  enabled: boolean
  error_count: number
  last_error: string | null
  created_at: string
}

export interface CalendarConnectionCreate {
  name: string
  provider?: string
  server_url: string
  calendar_url: string
  username: string
  password: string
  color?: string
}

export interface CalendarConnectionUpdate {
  name?: string
  color?: string
  enabled?: boolean
  password?: string
}

export interface ExternalEventOccurrence {
  id: string
  connection_id: string
  title: string
  description: string | null
  start_time: string
  end_time: string
  all_day: boolean
  location: string | null
  source_calendar_name: string
  source_calendar_color: string
  provider: string
}

export interface FeedToken {
  token: string
  url: string
}

export function useCalendarConnections() {
  return useQuery({
    queryKey: ['calendar-connections'],
    queryFn: () => apiFetch<CalendarConnection[]>('/calendar/connections'),
    enabled: hasToken(),
  })
}

export function useCreateCalendarConnection() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: CalendarConnectionCreate) =>
      apiFetch<CalendarConnection>('/calendar/connections', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['calendar-connections'] })
      qc.invalidateQueries({ queryKey: ['external-events'] })
    },
  })
}

export function useUpdateCalendarConnection() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ connectionId, ...data }: CalendarConnectionUpdate & { connectionId: string }) =>
      apiFetch<CalendarConnection>(`/calendar/connections/${connectionId}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['calendar-connections'] }),
  })
}

export function useDeleteCalendarConnection() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (connectionId: string) =>
      apiFetch<void>(`/calendar/connections/${connectionId}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['calendar-connections'] })
      qc.invalidateQueries({ queryKey: ['external-events'] })
    },
  })
}

export function useTriggerSync() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (connectionId: string) =>
      apiFetch<CalendarConnection>(`/calendar/connections/${connectionId}/sync`, {
        method: 'POST',
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['calendar-connections'] })
      qc.invalidateQueries({ queryKey: ['external-events'] })
    },
  })
}

export function useExternalEvents(householdId: string, start: string, end: string) {
  return useQuery({
    queryKey: ['external-events', householdId, start, end],
    queryFn: () =>
      apiFetch<ExternalEventOccurrence[]>(
        `/households/${householdId}/external-events?start=${start}&end=${end}`
      ),
    enabled: !!householdId && hasToken(),
  })
}

export function useFeedToken() {
  return useQuery({
    queryKey: ['feed-token'],
    queryFn: () => apiFetch<FeedToken>('/calendar/feed-token'),
    enabled: hasToken(),
  })
}

export function useRegenerateFeedToken() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () =>
      apiFetch<FeedToken>('/calendar/feed-token/regenerate', { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['feed-token'] }),
  })
}
