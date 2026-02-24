import { createFileRoute, Navigate } from '@tanstack/react-router'
import { useAuth } from 'react-oidc-context'
import { useCurrentUser } from '@/api/user'
import { useHouseholds, useCreateInvite } from '@/api/households'
import { Avatar, Button, Card } from '@/components/ui'
import { useState } from 'react'

export const Route = createFileRoute('/settings')({
  component: SettingsPage,
})

function SettingsPage() {
  const auth = useAuth()
  const { data: user } = useCurrentUser()
  const { data: households } = useHouseholds()

  if (!auth.isAuthenticated) return <Navigate to="/login" />

  const household = households?.[0]

  return (
    <div className="pb-4">
      <h1 className="text-2xl font-extrabold text-text mt-2 mb-6">Settings</h1>

      {/* Profile */}
      <Card className="mb-4">
        <div className="flex items-center gap-4">
          <Avatar name={user?.display_name || '?'} src={user?.avatar_url} size="lg" />
          <div>
            <p className="font-bold text-lg text-text">{user?.display_name}</p>
            <p className="text-sm text-text-muted">{user?.email}</p>
          </div>
        </div>
      </Card>

      {/* Household */}
      {household && (
        <Card className="mb-4">
          <h2 className="font-bold text-text mb-3">Household</h2>
          <p className="text-text-muted mb-4">{household.name}</p>
          <InviteSection householdId={household.id} />
        </Card>
      )}

      {/* Sign out */}
      <Button variant="ghost" className="w-full" onClick={() => auth.signoutRedirect()}>
        Sign out
      </Button>
    </div>
  )
}

function InviteSection({ householdId }: { householdId: string }) {
  const inviteMutation = useCreateInvite(householdId)
  const [code, setCode] = useState<string | null>(null)

  const handleInvite = async () => {
    const result = await inviteMutation.mutateAsync()
    setCode(result.code)
  }

  return (
    <div>
      {code ? (
        <div className="bg-background rounded-xl p-3">
          <p className="text-xs text-text-muted mb-1">Share this invite code:</p>
          <p className="font-mono text-sm text-primary break-all">{code}</p>
        </div>
      ) : (
        <Button variant="secondary" size="sm" onClick={handleInvite} disabled={inviteMutation.isPending}>
          {inviteMutation.isPending ? 'Generating...' : 'Invite member'}
        </Button>
      )}
    </div>
  )
}
