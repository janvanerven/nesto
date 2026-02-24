import { createFileRoute, Navigate } from '@tanstack/react-router'
import { useAuth } from 'react-oidc-context'

export const Route = createFileRoute('/callback')({
  component: CallbackPage,
})

function CallbackPage() {
  const auth = useAuth()

  if (auth.isLoading) {
    return (
      <div className="min-h-dvh flex items-center justify-center">
        <div className="text-primary text-xl font-bold animate-pulse">Loading...</div>
      </div>
    )
  }

  if (auth.isAuthenticated) {
    return <Navigate to="/" />
  }

  return <Navigate to="/login" />
}
