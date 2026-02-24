export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

let getToken: (() => string | undefined) | null = null
let refreshToken: (() => Promise<string | undefined>) | null = null

export function setTokenGetter(getter: () => string | undefined) {
  getToken = getter
}

export function setTokenRefresher(refresher: () => Promise<string | undefined>) {
  refreshToken = refresher
}

export function hasToken(): boolean {
  return !!getToken?.()
}

export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  let token = getToken?.()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  let response = await fetch(`/api${path}`, { ...options, headers })

  // If 401 and we have a refresh mechanism, try refreshing the token once
  if (response.status === 401 && refreshToken) {
    try {
      const newToken = await refreshToken()
      if (newToken && newToken !== token) {
        headers['Authorization'] = `Bearer ${newToken}`
        response = await fetch(`/api${path}`, { ...options, headers })
      }
    } catch {
      // Refresh failed, fall through to original 401
    }
  }

  if (!response.ok) {
    const body = await response.json().catch(() => ({ detail: response.statusText }))
    throw new ApiError(response.status, body.detail || response.statusText)
  }

  if (response.status === 204) return undefined as T
  return response.json()
}
