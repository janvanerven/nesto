import { createFileRoute, Navigate } from '@tanstack/react-router'
import { useAuth } from 'react-oidc-context'
import { useHouseholds } from '@/api/households'

export const Route = createFileRoute('/')({
  component: DashboardPage,
})

function DashboardPage() {
  const auth = useAuth()
  const { data: households, isLoading } = useHouseholds()

  if (!auth.isAuthenticated) return <Navigate to="/login" />
  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[50dvh]">
        <div className="text-primary text-xl font-bold animate-pulse">Loading...</div>
      </div>
    )
  }
  if (!households || households.length === 0) return <Navigate to="/onboarding" />

  const name = auth.user?.profile?.preferred_username || auth.user?.profile?.name || 'there'

  return (
    <div>
      <h1 className="text-3xl font-extrabold text-text mt-2">
        Good morning, {name}
      </h1>
      <p className="text-text-muted mt-1">Welcome to Nesto</p>
    </div>
  )
}
