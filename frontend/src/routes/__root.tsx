import { createRootRoute, Outlet } from '@tanstack/react-router'
import { useAuth } from 'react-oidc-context'
import { useEffect } from 'react'
import { setTokenGetter } from '@/api/client'

export const Route = createRootRoute({
  component: RootComponent,
})

function RootComponent() {
  const auth = useAuth()

  useEffect(() => {
    setTokenGetter(() => auth.user?.access_token)
  }, [auth.user])

  return <Outlet />
}
