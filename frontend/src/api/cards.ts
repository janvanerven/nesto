import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch, hasToken } from './client'

export interface LoyaltyCard {
  id: string
  household_id: string
  store_name: string
  barcode_number: string
  barcode_format: string
  color: string
  created_by: string
  created_at: string
  updated_at: string
}

export interface LoyaltyCardCreate {
  store_name: string
  barcode_number: string
  barcode_format: 'code128' | 'ean13' | 'qr' | 'code39'
  color: string
}

export interface LoyaltyCardUpdate {
  store_name?: string
  barcode_number?: string
  barcode_format?: 'code128' | 'ean13' | 'qr' | 'code39'
  color?: string
}

export function useLoyaltyCards(householdId: string) {
  return useQuery({
    queryKey: ['cards', householdId],
    queryFn: () => apiFetch<LoyaltyCard[]>(`/households/${householdId}/cards`),
    enabled: !!householdId && hasToken(),
  })
}

export function useCreateLoyaltyCard(householdId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (card: LoyaltyCardCreate) =>
      apiFetch<LoyaltyCard>(`/households/${householdId}/cards`, {
        method: 'POST',
        body: JSON.stringify(card),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cards', householdId] }),
  })
}

export function useUpdateLoyaltyCard(householdId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ cardId, ...update }: LoyaltyCardUpdate & { cardId: string }) =>
      apiFetch<LoyaltyCard>(`/households/${householdId}/cards/${cardId}`, {
        method: 'PATCH',
        body: JSON.stringify(update),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cards', householdId] }),
  })
}

export function useDeleteLoyaltyCard(householdId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (cardId: string) =>
      apiFetch<void>(`/households/${householdId}/cards/${cardId}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cards', householdId] }),
  })
}
