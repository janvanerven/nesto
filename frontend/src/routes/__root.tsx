import { createRootRoute, Outlet } from '@tanstack/react-router'
import { useAuth } from 'react-oidc-context'
import { useEffect } from 'react'
import { setTokenGetter } from '@/api/client'
import { BottomNav } from '@/components/layout/bottom-nav'

export const Route = createRootRoute({
  component: RootComponent,
})

const SHELL_EXCLUDED = ['/login', '/callback']

function RootComponent() {
  const auth = useAuth()

  useEffect(() => {
    setTokenGetter(() => auth.user?.access_token)
  }, [auth.user])

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
