import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch, hasToken } from './client'

export interface User {
  id: string
  email: string
  display_name: string
  first_name: string | null
  avatar_url: string | null
  created_at: string
  last_login: string
}

export function useCurrentUser() {
  return useQuery({
    queryKey: ['user', 'me'],
    queryFn: () => apiFetch<User>('/auth/me'),
    enabled: hasToken(),
  })
}

export function useUpdateUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: { first_name: string }) =>
      apiFetch<User>('/auth/me', {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['user', 'me'] }),
  })
}
