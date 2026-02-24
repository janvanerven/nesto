import { useQuery } from '@tanstack/react-query'
import { apiFetch } from './client'

export interface User {
  id: string
  email: string
  display_name: string
  avatar_url: string | null
  created_at: string
  last_login: string
}

export function useCurrentUser() {
  return useQuery({
    queryKey: ['user', 'me'],
    queryFn: () => apiFetch<User>('/auth/me'),
  })
}
