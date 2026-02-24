export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

let getToken: (() => string | undefined) | null = null

export function setTokenGetter(getter: () => string | undefined) {
  getToken = getter
}

export function hasToken(): boolean {
  return !!getToken?.()
}

export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken?.()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  const response = await fetch(`/api${path}`, { ...options, headers })

  if (!response.ok) {
    const body = await response.json().catch(() => ({ detail: response.statusText }))
    throw new ApiError(response.status, body.detail || response.statusText)
  }

  if (response.status === 204) return undefined as T
  return response.json()
}
