import { createFileRoute, Navigate } from '@tanstack/react-router'
import { useAuth } from 'react-oidc-context'
import { useCurrentUser, useUpdateUser } from '@/api/user'
import { useHouseholds, useCreateInvite } from '@/api/households'
import { Avatar, Button, Card, Input } from '@/components/ui'
import { useState } from 'react'
import { useThemeStore } from '@/stores/theme-store'

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
        <div className="flex items-center gap-4 mb-4">
          <Avatar name={user?.display_name || '?'} src={user?.avatar_url} size="lg" />
          <div>
            <p className="font-bold text-lg text-text">{user?.first_name || user?.display_name}</p>
            <p className="text-sm text-text-muted">{user?.email}</p>
          </div>
        </div>
        <EditNameSection currentName={user?.first_name || ''} />
      </Card>

      {/* Household */}
      {household && (
        <Card className="mb-4">
          <h2 className="font-bold text-text mb-3">Household</h2>
          <p className="text-text-muted mb-4">{household.name}</p>
          <InviteSection householdId={household.id} />
        </Card>
      )}

      {/* Appearance */}
      <Card className="mb-4">
        <h2 className="font-bold text-text mb-3">Appearance</h2>
        <ThemeToggle />
      </Card>

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

function EditNameSection({ currentName }: { currentName: string }) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(currentName)
  const updateUser = useUpdateUser()

  const handleSave = async () => {
    if (!name.trim()) return
    await updateUser.mutateAsync({ first_name: name.trim() })
    setEditing(false)
  }

  if (!editing) {
    return (
      <button
        onClick={() => { setName(currentName); setEditing(true) }}
        className="text-sm text-primary font-medium"
      >
        Edit name
      </button>
    )
  }

  return (
    <div className="flex gap-2">
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Your first name"
        className="flex-1 !h-10 !text-sm"
        autoFocus
      />
      <Button size="sm" onClick={handleSave} disabled={!name.trim() || updateUser.isPending}>
        {updateUser.isPending ? '...' : 'Save'}
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
        Cancel
      </Button>
    </div>
  )
}

function ThemeToggle() {
  const { mode, setMode } = useThemeStore()
  const options: { value: 'system' | 'light' | 'dark'; label: string }[] = [
    { value: 'system', label: 'System' },
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' },
  ]

  return (
    <div className="flex gap-2">
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => setMode(opt.value)}
          className={`
            flex-1 py-2 rounded-xl text-sm font-medium transition-all
            ${mode === opt.value
              ? 'bg-primary text-white shadow-md'
              : 'bg-text/5 text-text-muted'
            }
          `}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}
