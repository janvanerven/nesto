import { createRootRoute, Outlet, useLocation } from '@tanstack/react-router'
import { useAuth } from 'react-oidc-context'
import { useEffect } from 'react'
import { setTokenGetter, setTokenRefresher, setSessionExpiredHandler } from '@/api/client'
import { BottomNav } from '@/components/layout/bottom-nav'
import '@/stores/theme-store'

function GlobalError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="min-h-dvh bg-background flex items-center justify-center p-6">
      <div className="text-center max-w-sm">
        <p className="text-4xl mb-4">&#9888;&#65039;</p>
        <h1 className="text-xl font-bold text-text mb-2">Something went wrong</h1>
        <p className="text-sm text-text-muted mb-6">{error.message || 'An unexpected error occurred.'}</p>
        <button
          onClick={reset}
          className="px-6 py-2.5 rounded-xl bg-primary text-white font-medium text-sm"
        >
          Try again
        </button>
      </div>
    </div>
  )
}

export const Route = createRootRoute({
  component: RootComponent,
  errorComponent: GlobalError,
})

const SHELL_EXCLUDED = ['/login', '/callback']

function RootComponent() {
  const auth = useAuth()
  const location = useLocation()

  useEffect(() => {
    setTokenGetter(() => auth.user?.access_token)
    setTokenRefresher(async () => {
      const user = await auth.signinSilent()
      return user?.access_token
    })
    setSessionExpiredHandler(() => {
      auth.signinRedirect()
    })
  }, [auth.user, auth.signinSilent, auth.signinRedirect])

  const showShell = !SHELL_EXCLUDED.includes(location.pathname) && auth.isAuthenticated

  if (!showShell) {
    return <Outlet />
  }

  return (
    <div className="min-h-dvh bg-background pb-20">
      <main className="max-w-lg mx-auto px-4 pt-4">
        <Outlet />
      </main>
      <BottomNav />
    </div>
  )
}
