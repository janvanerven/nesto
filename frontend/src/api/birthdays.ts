import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch, hasToken } from './client'

export interface Birthday {
  id: string
  household_id: string
  person_name: string
  birth_month: number
  birth_day: number
  birth_year: number | null
  age: number | null
  created_by: string
  created_at: string
  updated_at: string
}

export interface BirthdayCreate {
  person_name: string
  birth_month: number
  birth_day: number
  birth_year?: number | null
}

export interface BirthdayUpdate {
  person_name?: string
  birth_month?: number
  birth_day?: number
  birth_year?: number | null
}

export function useBirthdays(householdId: string) {
  return useQuery({
    queryKey: ['birthdays', householdId],
    queryFn: () => apiFetch<Birthday[]>(`/households/${householdId}/birthdays`),
    enabled: !!householdId && hasToken(),
  })
}

export function useCreateBirthday(householdId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (birthday: BirthdayCreate) =>
      apiFetch<Birthday>(`/households/${householdId}/birthdays`, {
        method: 'POST',
        body: JSON.stringify(birthday),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['birthdays', householdId] }),
  })
}

export function useUpdateBirthday(householdId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ birthdayId, ...update }: BirthdayUpdate & { birthdayId: string }) =>
      apiFetch<Birthday>(`/households/${householdId}/birthdays/${birthdayId}`, {
        method: 'PATCH',
        body: JSON.stringify(update),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['birthdays', householdId] }),
  })
}

export function useDeleteBirthday(householdId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (birthdayId: string) =>
      apiFetch<void>(`/households/${householdId}/birthdays/${birthdayId}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['birthdays', householdId] }),
  })
}
