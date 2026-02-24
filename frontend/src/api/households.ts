import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch, hasToken } from './client'

export interface Household {
  id: string
  name: string
  created_at: string
  created_by: string
}

export interface InviteResponse {
  code: string
  expires_at: string
}

export function useHouseholds() {
  return useQuery({
    queryKey: ['households'],
    queryFn: () => apiFetch<Household[]>('/households'),
    enabled: hasToken(),
  })
}

export function useCreateHousehold() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (name: string) =>
      apiFetch<Household>('/households', {
        method: 'POST',
        body: JSON.stringify({ name }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['households'] }),
  })
}

export function useJoinHousehold() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (code: string) =>
      apiFetch<Household>('/households/join', {
        method: 'POST',
        body: JSON.stringify({ code }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['households'] }),
  })
}

export function useCreateInvite(householdId: string) {
  return useMutation({
    mutationFn: () => apiFetch<InviteResponse>(`/households/${householdId}/invite`, { method: 'POST' }),
  })
}

export interface HouseholdMember {
  id: string
  display_name: string
  first_name: string | null
  avatar_url: string | null
}

export function useHouseholdMembers(householdId: string) {
  return useQuery({
    queryKey: ['households', householdId, 'members'],
    queryFn: () => apiFetch<HouseholdMember[]>(`/households/${householdId}/members`),
    enabled: !!householdId && hasToken(),
  })
}
