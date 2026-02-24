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

  // Log OIDC token lifecycle events and diagnostics
  useEffect(() => {
    if (auth.user) {
      const expiresAt = auth.user.expires_at
      const now = Math.floor(Date.now() / 1000)
      const remaining = expiresAt ? expiresAt - now : 'unknown'
      console.log('[OIDC] Token info:', {
        hasAccessToken: !!auth.user.access_token,
        hasRefreshToken: !!auth.user.refresh_token,
        expiresAt: expiresAt ? new Date(expiresAt * 1000).toISOString() : 'unknown',
        remainingSeconds: remaining,
        tokenType: auth.user.token_type,
        scopes: auth.user.scope,
      })
    }
  }, [auth.user])

  useEffect(() => {
    const mgr = auth.events
    if (!mgr) return
    const onExpiring = () => console.log('[OIDC] Access token expiring soon, automatic renewal should fire')
    const onExpired = () => console.warn('[OIDC] Access token expired — renewal did not complete in time')
    const onError = (err: Error) => console.error('[OIDC] Silent renew error:', err.message)
    const onLoaded = () => console.log('[OIDC] User loaded — token refreshed successfully')
    mgr.addAccessTokenExpiring(onExpiring)
    mgr.addAccessTokenExpired(onExpired)
    mgr.addSilentRenewError(onError)
    mgr.addUserLoaded(onLoaded)
    return () => {
      mgr.removeAccessTokenExpiring(onExpiring)
      mgr.removeAccessTokenExpired(onExpired)
      mgr.removeSilentRenewError(onError)
      mgr.removeUserLoaded(onLoaded)
    }
  }, [auth.events])

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
