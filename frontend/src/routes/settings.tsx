import { createFileRoute, Navigate } from '@tanstack/react-router'
import { useAuth } from 'react-oidc-context'
import { useCurrentUser, useUpdateUser } from '@/api/user'
import { useHouseholds, useHouseholdMembers, useCreateInvite, useUpdateHousehold } from '@/api/households'
import { Avatar, Button, Card, Input } from '@/components/ui'
import { useState, useRef } from 'react'
import { useThemeStore } from '@/stores/theme-store'
import {
  useCalendarConnections,
  useUpdateCalendarConnection,
  useDeleteCalendarConnection,
  useTriggerSync,
  useFeedToken,
  useRegenerateFeedToken,
} from '@/api/calendar-sync'
import { AddCalendarSheet } from '@/components/calendar/add-calendar-sheet'

export const Route = createFileRoute('/settings')({
  component: SettingsPage,
})

function resizeImage(file: File, maxSize: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const blobUrl = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(blobUrl)
      const canvas = document.createElement('canvas')
      canvas.width = maxSize
      canvas.height = maxSize
      const ctx = canvas.getContext('2d')!
      const min = Math.min(img.width, img.height)
      const sx = (img.width - min) / 2
      const sy = (img.height - min) / 2
      ctx.drawImage(img, sx, sy, min, min, 0, 0, maxSize, maxSize)
      resolve(canvas.toDataURL('image/jpeg', 0.85))
    }
    img.onerror = () => {
      URL.revokeObjectURL(blobUrl)
      reject(new Error('Failed to load image'))
    }
    img.src = blobUrl
  })
}

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
          <AvatarUpload
            name={user?.display_name || '?'}
            src={user?.avatar_url}
          />
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
          <EditHouseholdNameSection householdId={household.id} currentName={household.name} />
          <MembersSection householdId={household.id} />
          <InviteSection householdId={household.id} />
        </Card>
      )}

      {/* Calendar Sync */}
      {household && (
        <Card className="mb-4">
          <h2 className="font-bold text-text mb-3">Calendar Sync</h2>
          <CalendarSyncSection householdId={household.id} />
        </Card>
      )}

      {/* Notifications */}
      <Card className="mb-4">
        <h2 className="font-bold text-text mb-3">Notifications</h2>
        <NotificationsSection
          dailyEnabled={user?.email_digest_daily ?? false}
          weeklyEnabled={user?.email_digest_weekly ?? false}
        />
      </Card>

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

function AvatarUpload({ name, src }: { name: string; src?: string | null }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const updateUser = useUpdateUser()
  const [error, setError] = useState('')

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setError('')
    try {
      const dataUrl = await resizeImage(file, 256)
      if (dataUrl.length > 150_000) {
        setError('Image too large')
        return
      }
      await updateUser.mutateAsync({ avatar_url: dataUrl })
    } catch {
      setError('Upload failed')
    }
    e.target.value = ''
  }

  return (
    <div>
      <button
        type="button"
        className="relative shrink-0"
        onClick={() => fileRef.current?.click()}
      >
        <Avatar name={name} src={src} size="lg" />
        <span className="absolute bottom-0 right-0 bg-primary text-white rounded-full w-6 h-6 flex items-center justify-center text-xs shadow-md">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
            <path fillRule="evenodd" d="M1 8a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 018.07 3h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0016.07 6H17a2 2 0 012 2v7a2 2 0 01-2 2H3a2 2 0 01-2-2V8zm13.5 3a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0zM10 14a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
          </svg>
        </span>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleFile}
        />
      </button>
      {error && <p className="text-xs text-accent mt-1">{error}</p>}
    </div>
  )
}

function MembersSection({ householdId }: { householdId: string }) {
  const { data: members = [] } = useHouseholdMembers(householdId)

  if (!members.length) return null

  return (
    <div className="mb-4">
      <p className="text-sm font-medium text-text-muted mb-2">Members</p>
      <div className="space-y-2">
        {members.map((m) => (
          <div key={m.id} className="flex items-center gap-3">
            <Avatar name={m.display_name} src={m.avatar_url} size="sm" />
            <span className="text-sm font-medium text-text">{m.first_name || m.display_name}</span>
          </div>
        ))}
      </div>
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

function CalendarSyncSection({ householdId }: { householdId: string }) {
  const { data: connections = [] } = useCalendarConnections()
  const [showAdd, setShowAdd] = useState(false)

  return (
    <div>
      {connections.length > 0 && (
        <div className="space-y-3 mb-4">
          {connections.map((conn) => (
            <ConnectedCalendarRow key={conn.id} connection={conn} />
          ))}
        </div>
      )}

      <Button variant="secondary" size="sm" onClick={() => setShowAdd(true)}>
        Add calendar
      </Button>

      <div className="mt-4 pt-4 border-t border-text/10">
        <IcsSubscriptionSection />
      </div>

      <AddCalendarSheet open={showAdd} onClose={() => setShowAdd(false)} />
    </div>
  )
}

function ConnectedCalendarRow({ connection }: { connection: import('@/api/calendar-sync').CalendarConnection }) {
  const updateMutation = useUpdateCalendarConnection()
  const deleteMutation = useDeleteCalendarConnection()
  const syncMutation = useTriggerSync()
  const [confirmDelete, setConfirmDelete] = useState(false)

  return (
    <div className="bg-background rounded-xl p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="w-3 h-3 rounded-full shrink-0"
            style={{ backgroundColor: connection.color }}
          />
          <div className="min-w-0">
            <p className="text-sm font-medium text-text truncate">{connection.name}</p>
            <p className="text-xs text-text-muted">
              {connection.provider} · {connection.last_synced_at
                ? `Synced ${new Date(connection.last_synced_at).toLocaleString()}`
                : 'Never synced'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => syncMutation.mutate(connection.id)}
            disabled={syncMutation.isPending}
            className="text-xs text-primary font-medium px-2 py-1"
          >
            {syncMutation.isPending ? '...' : 'Sync'}
          </button>
          <button
            type="button"
            role="switch"
            aria-checked={connection.enabled}
            aria-label={`Toggle ${connection.name}`}
            onClick={() => updateMutation.mutate({ connectionId: connection.id, enabled: !connection.enabled })}
            className={`relative shrink-0 w-9 h-5 rounded-full transition-colors ${connection.enabled ? 'bg-primary' : 'bg-text/15'}`}
          >
            <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${connection.enabled ? 'translate-x-4' : 'translate-x-0'}`} />
          </button>
        </div>
      </div>
      {connection.error_count > 0 && connection.last_error && (
        <p className="text-xs text-accent mt-2">{connection.last_error}</p>
      )}
      <div className="mt-2 flex justify-end">
        {confirmDelete ? (
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>Cancel</Button>
            <Button size="sm" variant="danger" onClick={() => deleteMutation.mutate(connection.id)} disabled={deleteMutation.isPending}>
              {deleteMutation.isPending ? '...' : 'Confirm'}
            </Button>
          </div>
        ) : (
          <button type="button" onClick={() => setConfirmDelete(true)} className="text-xs text-accent font-medium">
            Remove
          </button>
        )}
      </div>
    </div>
  )
}

function IcsSubscriptionSection() {
  const { data: feedToken } = useFeedToken()
  const regenerateMutation = useRegenerateFeedToken()
  const [copied, setCopied] = useState(false)
  const [confirmRegen, setConfirmRegen] = useState(false)

  const handleCopy = async () => {
    if (!feedToken?.url) return
    await navigator.clipboard.writeText(feedToken.url)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div>
      <p className="text-sm font-medium text-text mb-1">Calendar subscription</p>
      <p className="text-xs text-text-muted mb-2">Subscribe to this URL in your calendar app to see Nesto events.</p>
      {feedToken ? (
        <>
          <div className="bg-background rounded-xl p-3 mb-2">
            <p className="font-mono text-xs text-primary break-all">{feedToken.url}</p>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={handleCopy}>
              {copied ? 'Copied!' : 'Copy URL'}
            </Button>
            {confirmRegen ? (
              <>
                <Button size="sm" variant="danger" onClick={() => { regenerateMutation.mutate(); setConfirmRegen(false) }}>
                  Confirm
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmRegen(false)}>
                  Cancel
                </Button>
              </>
            ) : (
              <Button size="sm" variant="ghost" onClick={() => setConfirmRegen(true)}>
                Regenerate
              </Button>
            )}
          </div>
        </>
      ) : (
        <p className="text-xs text-text-muted">Loading...</p>
      )}
    </div>
  )
}

function EditHouseholdNameSection({ householdId, currentName }: { householdId: string; currentName: string }) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(currentName)
  const updateHousehold = useUpdateHousehold(householdId)

  const handleSave = async () => {
    if (!name.trim()) return
    await updateHousehold.mutateAsync(name.trim())
    setEditing(false)
  }

  if (!editing) {
    return (
      <button
        onClick={() => { setName(currentName); setEditing(true) }}
        className="text-text-muted mb-4 block"
      >
        {currentName}
      </button>
    )
  }

  return (
    <div className="flex gap-2 mb-4">
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Household name"
        className="flex-1 !h-10"
        autoFocus
      />
      <Button size="sm" onClick={handleSave} disabled={!name.trim() || updateHousehold.isPending}>
        {updateHousehold.isPending ? '...' : 'Save'}
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
        Cancel
      </Button>
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
        className="flex-1 !h-10"
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

function NotificationsSection({ dailyEnabled, weeklyEnabled }: { dailyEnabled: boolean; weeklyEnabled: boolean }) {
  const updateUser = useUpdateUser()

  return (
    <div className="space-y-3">
      <ToggleRow
        label="Daily digest"
        description="Morning email with today's events and reminders"
        enabled={dailyEnabled}
        onChange={(v) => updateUser.mutate({ email_digest_daily: v })}
        disabled={updateUser.isPending}
      />
      <ToggleRow
        label="Weekly digest"
        description="Sunday evening summary of the week ahead"
        enabled={weeklyEnabled}
        onChange={(v) => updateUser.mutate({ email_digest_weekly: v })}
        disabled={updateUser.isPending}
      />
    </div>
  )
}

function ToggleRow({ label, description, enabled, onChange, disabled }: {
  label: string
  description: string
  enabled: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-sm font-medium text-text">{label}</p>
        <p className="text-xs text-text-muted">{description}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!enabled)}
        className={`
          relative shrink-0 w-11 h-6 rounded-full transition-colors
          ${enabled ? 'bg-primary' : 'bg-text/15'}
          ${disabled ? 'opacity-50' : ''}
        `}
      >
        <span
          className={`
            absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform
            ${enabled ? 'translate-x-5' : 'translate-x-0'}
          `}
        />
      </button>
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
