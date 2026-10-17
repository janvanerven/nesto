import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch, hasToken } from './client'

export interface Person {
  id: string
  household_id: string
  address_id: string | null
  name: string
  birth_month: number | null
  birth_day: number | null
  birth_year: number | null
  age: number | null
  phone: string
  email: string
  notes: string
  created_at: string
  updated_at: string
}

export interface ContactAddress {
  id: string
  household_id: string
  label: string
  street: string
  postcode: string
  city: string
  country: string
  notes: string
  people: Person[]
  created_at: string
  updated_at: string
}

export interface ContactsData {
  addresses: ContactAddress[]
  people_without_address: Person[]
}

export interface PersonCreate {
  name: string
  address_id?: string | null
  birth_month?: number | null
  birth_day?: number | null
  birth_year?: number | null
  phone?: string
  email?: string
  notes?: string
}

export interface PersonUpdate {
  name?: string
  address_id?: string | null
  birth_month?: number | null
  birth_day?: number | null
  birth_year?: number | null
  phone?: string
  email?: string
  notes?: string
}

export interface AddressCreate {
  label: string
  street?: string
  postcode?: string
  city?: string
  country?: string
  notes?: string
  people?: PersonCreate[]
  move_people?: string[]
}

export interface AddressUpdate {
  label?: string
  street?: string
  postcode?: string
  city?: string
  country?: string
  notes?: string
}

export function useContacts(householdId: string) {
  return useQuery({
    queryKey: ['contacts', householdId],
    queryFn: () => apiFetch<ContactsData>(`/households/${householdId}/contacts`),
    enabled: !!householdId && hasToken(),
  })
}

// Contact changes can alter birthdays (people carry them), so refresh both.
// awaitRefresh=false resolves as soon as the request succeeds (refetch continues in the
// background), e.g. so a deleted address's page can navigate away before it re-renders.
function useContactMutation<TVars, TResult>(
  householdId: string,
  fn: (vars: TVars) => Promise<TResult>,
  awaitRefresh = true,
) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: async () => {
      const refresh = Promise.all([
        qc.invalidateQueries({ queryKey: ['contacts', householdId] }),
        qc.invalidateQueries({ queryKey: ['birthdays', householdId] }),
      ])
      if (awaitRefresh) await refresh
      else refresh.catch(() => undefined)
    },
  })
}

const base = (householdId: string) => `/households/${householdId}/contacts`

export function useCreateAddress(householdId: string) {
  return useContactMutation(householdId, (data: AddressCreate) =>
    apiFetch<ContactAddress>(`${base(householdId)}/addresses`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  )
}

export function useUpdateAddress(householdId: string) {
  return useContactMutation(householdId, ({ id, data }: { id: string; data: AddressUpdate }) =>
    apiFetch<ContactAddress>(`${base(householdId)}/addresses/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  )
}

export function useDeleteAddress(householdId: string) {
  return useContactMutation(
    householdId,
    ({ id, deletePeople }: { id: string; deletePeople: boolean }) =>
      apiFetch<void>(`${base(householdId)}/addresses/${id}?delete_people=${deletePeople}`, {
        method: 'DELETE',
      }),
    false,
  )
}

export function useCreatePerson(householdId: string) {
  return useContactMutation(householdId, (data: PersonCreate) =>
    apiFetch<Person>(`${base(householdId)}/people`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  )
}

export function useUpdatePerson(householdId: string) {
  return useContactMutation(householdId, ({ id, data }: { id: string; data: PersonUpdate }) =>
    apiFetch<Person>(`${base(householdId)}/people/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  )
}

export function useDeletePerson(householdId: string) {
  return useContactMutation(householdId, (id: string) =>
    apiFetch<void>(`${base(householdId)}/people/${id}`, { method: 'DELETE' }),
  )
}
