import { Link, useRouterState } from '@tanstack/react-router'
import { motion } from 'framer-motion'

const tabs = [
  { to: '/' as const, label: 'Home', icon: HomeIcon },
  { to: '/tasks' as const, label: 'Tasks', icon: CheckIcon },
  { to: '/calendar' as const, label: 'Calendar', icon: CalendarIcon },
  { to: '/settings' as const, label: 'More', icon: SettingsIcon },
]

export function BottomNav() {
  const routerState = useRouterState()
  const currentPath = routerState.location.pathname

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-surface border-t border-text/5 pb-[env(safe-area-inset-bottom)]">
      <div className="flex items-center justify-around h-16 max-w-lg mx-auto">
        {tabs.map((tab) => {
          const isActive = currentPath === tab.to || (tab.to !== '/' && currentPath.startsWith(tab.to))
          return (
            <Link
              key={tab.to}
              to={tab.to}
              className="flex flex-col items-center gap-1 px-4 py-2 relative"
            >
              {isActive && (
                <motion.div
                  layoutId="nav-indicator"
                  className="absolute -top-0.5 w-8 h-1 bg-primary rounded-full"
                  transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                />
              )}
              <tab.icon active={isActive} />
              <span className={`text-xs font-medium ${isActive ? 'text-primary' : 'text-text-muted'}`}>
                {tab.label}
              </span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}

// Inline SVG icons — small, no external dependency
function HomeIcon({ active }: { active: boolean }) {
  const color = active ? '#6C5CE7' : '#636E72'
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0a1 1 0 01-1-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 01-1 1" />
    </svg>
  )
}

function CheckIcon({ active }: { active: boolean }) {
  const color = active ? '#6C5CE7' : '#636E72'
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
    </svg>
  )
}

function CalendarIcon({ active }: { active: boolean }) {
  const color = active ? '#6C5CE7' : '#636E72'
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  )
}

function SettingsIcon({ active }: { active: boolean }) {
  const color = active ? '#6C5CE7' : '#636E72'
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="1" /><circle cx="12" cy="5" r="1" /><circle cx="12" cy="19" r="1" />
    </svg>
  )
}
