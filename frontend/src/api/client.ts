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

// Read user data directly from OIDC sessionStorage (source of truth,
// always fresher than the React state closure)
function getStoredOidcUser(): { access_token?: string; expires_at?: number } | null {
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key?.startsWith('oidc.user:')) {
      try {
        return JSON.parse(localStorage.getItem(key)!)
      } catch {
        return null
      }
    }
  }
  return null
}

// Get the freshest token: prefer sessionStorage over React state
function getFreshToken(): string | undefined {
  const stored = getStoredOidcUser()
  if (stored?.access_token) return stored.access_token
  return getToken?.()
}

// True if token will expire within the next 30 seconds
function isTokenExpiring(): boolean {
  const stored = getStoredOidcUser()
  if (!stored?.expires_at) return false
  return stored.expires_at < Date.now() / 1000 + 30
}

export function hasToken(): boolean {
  return !!getFreshToken()
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
  // Pre-flight: proactively refresh if token expires within 30s
  if (isTokenExpiring() && refreshToken) {
    try {
      await doRefresh()
    } catch {
      onSessionExpired?.()
      throw new ApiError(401, 'Session expired')
    }
  }

  let token = getFreshToken()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  let response = await fetch(`/api${path}`, { ...options, headers })

  // Safety net: if we still get 401, try one refresh cycle
  if (response.status === 401 && refreshToken) {
    try {
      const newToken = await doRefresh()
      if (newToken && newToken !== token) {
        headers['Authorization'] = `Bearer ${newToken}`
        response = await fetch(`/api${path}`, { ...options, headers })
      }
    } catch {
      onSessionExpired?.()
      throw new ApiError(401, 'Session expired')
    }
  }

  if (!response.ok) {
    const body = await response.json().catch(() => ({ detail: response.statusText }))
    throw new ApiError(response.status, body.detail || response.statusText)
  }

  if (response.status === 204) return undefined as T
  return response.json()
}
