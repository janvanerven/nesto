import { createFileRoute, Navigate } from '@tanstack/react-router'
import { useAuth } from 'react-oidc-context'
import { Card } from '@/components/ui'

export const Route = createFileRoute('/calendar')({
  component: CalendarPage,
})

function CalendarPage() {
  const auth = useAuth()
  if (!auth.isAuthenticated) return <Navigate to="/login" />

  return (
    <div className="pb-4">
      <h1 className="text-2xl font-extrabold text-text mt-2 mb-4">Calendar</h1>
      <Card className="text-center py-12">
        <p className="text-4xl mb-3">&#128197;</p>
        <p className="font-semibold text-text">Coming soon</p>
        <p className="text-sm text-text-muted mt-1">Shared calendar is on the way.</p>
      </Card>
    </div>
  )
}
