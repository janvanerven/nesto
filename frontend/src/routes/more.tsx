import { createFileRoute, Navigate, Link } from '@tanstack/react-router'
import { useAuth } from 'react-oidc-context'
import { Card } from '@/components/ui'

export const Route = createFileRoute('/more')({
  component: MorePage,
})

const items = [
  { to: '/cards' as const, label: 'Loyalty Cards', description: 'Store and scan your loyalty cards', icon: CardIcon },
  { to: '/documents' as const, label: 'Documents', description: 'Warranties, receipts, and manuals', icon: DocIcon },
  { to: '/settings' as const, label: 'Settings', description: 'Profile, household, and preferences', icon: GearIcon },
]

function MorePage() {
  const auth = useAuth()
  if (!auth.isAuthenticated) return <Navigate to="/login" />

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
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" />
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
