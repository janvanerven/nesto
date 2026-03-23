import { createFileRoute, Navigate, Link } from '@tanstack/react-router'
import { useAuth } from 'react-oidc-context'
import type { ReactNode } from 'react'
import { Card } from '@/components/ui'
import { useSekuraConnection } from '@/api/sekura'

export const Route = createFileRoute('/more')({
  component: MorePage,
})

type MoreItem = {
  to: '/cards' | '/documents' | '/birthdays' | '/settings'
  label: string
  description: string
  icon: () => ReactNode
}

const allItems: MoreItem[] = [
  { to: '/cards', label: 'Loyalty Cards', description: 'Store and scan your loyalty cards', icon: CardIcon },
  { to: '/documents', label: 'Documents', description: 'Browse files and folders via Sekura', icon: DocIcon },
  { to: '/birthdays', label: 'Birthdays', description: 'Never forget a birthday', icon: BirthdayIcon },
  { to: '/settings', label: 'Settings', description: 'Profile, household, and preferences', icon: GearIcon },
]

function MorePage() {
  const auth = useAuth()
  // Prefetch connection status on mount — avoids flash of Documents item
  const { data: connection, isLoading: connectionLoading } = useSekuraConnection()

  if (!auth.isAuthenticated) return <Navigate to="/login" />

  // While loading, hide Documents entirely rather than flash it in then out.
  // Once the query resolves, show Documents only if Sekura is configured.
  const items = allItems.filter((item) => {
    if (item.to === '/documents') {
      if (connectionLoading) return false
      return connection?.configured === true
    }
    return true
  })

  return (
    <div className="pb-4">
      <h1 className="text-2xl font-extrabold text-text mt-2 mb-4">More</h1>
      <div className="space-y-3">
        {items.map((item) => (
          <Link key={item.to} to={item.to}>
            <Card interactive className="flex items-center gap-4">
              <item.icon />
              <div>
                <p className="font-semibold text-text">{item.label}</p>
                <p className="text-sm text-text-muted">{item.description}</p>
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  )
}

function CardIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-primary shrink-0">
      <rect x="1" y="4" width="22" height="16" rx="2" /><line x1="1" y1="10" x2="23" y2="10" />
    </svg>
  )
}

function DocIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-primary shrink-0">
      <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
    </svg>
  )
}

function GearIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-primary shrink-0">
      <circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
    </svg>
  )
}

function BirthdayIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-primary shrink-0">
      <path d="M20 21H4v-4a2 2 0 012-2h12a2 2 0 012 2v4z" />
      <path d="M2 21h20" />
      <path d="M6 15v-2a2 2 0 012-2h8a2 2 0 012 2v2" />
      <path d="M12 7V4" /><path d="M8 7V5" /><path d="M16 7V5" />
      <circle cx="12" cy="3" r="1" /><circle cx="8" cy="4" r="1" /><circle cx="16" cy="4" r="1" />
      <path d="M6 11h12" />
    </svg>
  )
}
