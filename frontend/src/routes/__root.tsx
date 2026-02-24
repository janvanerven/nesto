import { createRootRoute, Outlet } from '@tanstack/react-router'
import { useAuth } from 'react-oidc-context'
import { useEffect } from 'react'
import { setTokenGetter, setTokenRefresher, setSessionExpiredHandler } from '@/api/client'
import { BottomNav } from '@/components/layout/bottom-nav'
import '@/stores/theme-store'

export const Route = createRootRoute({
  component: RootComponent,
})

const SHELL_EXCLUDED = ['/login', '/callback']

function RootComponent() {
  const auth = useAuth()

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

  const pathname = window.location.pathname
  const showShell = !SHELL_EXCLUDED.includes(pathname) && auth.isAuthenticated

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
