import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch, hasToken } from './client'

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export type ProposalType = 'birthday' | 'task' | 'event' | 'list_items' | 'grocery_list'
  | 'address'
  | 'person'
  | 'person_update'
  | 'address_update'

export interface Proposal {
  id: string
  type: ProposalType
  summary: string
  payload: Record<string, unknown>
  list_id?: string | null
  target_id?: string | null
  replaces?: string | null
}

export interface AssistantResponse {
  reply: string
  assistant_content: string
  proposals: Proposal[]
}

export interface AiModelOption {
  id: string
  label: string
}

export interface AiSettings {
  has_key: boolean
  label: string
  model: string
  models: AiModelOption[]
}

export interface AiSettingsUpdate {
  api_key?: string
  model?: string
}

export interface AiKeyTestResult {
  ok: boolean
  label: string
}

export function useAssistant(householdId: string) {
  return useMutation({
    mutationFn: ({ messages }: { messages: ChatMessage[] }) =>
      apiFetch<AssistantResponse>(`/households/${householdId}/assistant`, {
        method: 'POST',
        body: JSON.stringify({
          messages,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
      }),
  })
}

export function useAiSettings(householdId: string) {
  return useQuery({
    queryKey: ['ai-settings', householdId],
    queryFn: () => apiFetch<AiSettings>(`/households/${householdId}/assistant/settings`),
    enabled: !!householdId && hasToken(),
  })
}

export function useSaveAiSettings(householdId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (update: AiSettingsUpdate) =>
      apiFetch<AiSettings>(`/households/${householdId}/assistant/settings`, {
        method: 'PUT',
        body: JSON.stringify(update),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ai-settings', householdId] }),
  })
}

export function useDeleteAiSettings(householdId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () =>
      apiFetch<void>(`/households/${householdId}/assistant/settings`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ai-settings', householdId] }),
  })
}

export function useTestAiSettings(householdId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () =>
      apiFetch<AiKeyTestResult>(`/households/${householdId}/assistant/settings/test`, {
        method: 'POST',
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ai-settings', householdId] }),
  })
}
