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
let refreshInFlight: Promise<string | undefined> | null = null
let onSessionExpired: (() => void) | null = null

export function setTokenGetter(getter: () => string | undefined) {
  getToken = getter
}

export function setTokenRefresher(refresher: () => Promise<string | undefined>) {
  refreshToken = refresher
}

export function setSessionExpiredHandler(handler: () => void) {
  onSessionExpired = handler
}

export function hasToken(): boolean {
  return !!getToken?.()
}

async function doRefresh(): Promise<string | undefined> {
  if (!refreshToken) return undefined
  // Deduplicate: if a refresh is already in flight, share the same promise
  if (refreshInFlight) return refreshInFlight
  refreshInFlight = refreshToken().finally(() => {
    refreshInFlight = null
  })
  return refreshInFlight
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

  // If 401, try refreshing the token once (deduplicated across concurrent requests)
  if (response.status === 401 && refreshToken) {
    try {
      const newToken = await doRefresh()
      if (newToken && newToken !== token) {
        headers['Authorization'] = `Bearer ${newToken}`
        response = await fetch(`/api${path}`, { ...options, headers })
      }
    } catch {
      // Refresh failed — session is expired, redirect to re-authenticate
      onSessionExpired?.()
    }
  }

  if (!response.ok) {
    const body = await response.json().catch(() => ({ detail: response.statusText }))
    throw new ApiError(response.status, body.detail || response.statusText)
  }

  if (response.status === 204) return undefined as T
  return response.json()
}
