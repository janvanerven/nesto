import { createFileRoute, Navigate, Link } from '@tanstack/react-router'
import { useAuth } from 'react-oidc-context'
import { motion } from 'framer-motion'
import { useHouseholds } from '@/api/households'
import { useCurrentUser } from '@/api/user'
import { useTasks } from '@/api/tasks'
import { useEvents } from '@/api/events'
import { useShoppingLists } from '@/api/lists'
import { Avatar, Card, PriorityDot } from '@/components/ui'

export const Route = createFileRoute('/')({
  component: DashboardPage,
})

function fmt(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function getGreeting(): string {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

function DashboardPage() {
  const auth = useAuth()
  const { data: user } = useCurrentUser()
  const { data: households, isLoading: loadingHouseholds } = useHouseholds()

  if (!auth.isAuthenticated) return <Navigate to="/login" />
  if (loadingHouseholds) {
    return (
      <div className="flex items-center justify-center min-h-[50dvh]">
        <div className="text-primary text-xl font-bold animate-pulse">Loading...</div>
      </div>
    )
  }
  if (!households || households.length === 0) return <Navigate to="/onboarding" />

  const household = households[0]

  return (
    <div className="pb-4">
      {/* Header */}
      <div className="flex items-center justify-between mt-2 mb-6">
        <div>
          <h1 className="text-2xl font-extrabold text-text">
            {getGreeting()}, {user?.first_name || user?.display_name?.split(' ')[0] || 'there'}
          </h1>
          <p className="text-xl font-semibold text-text mt-1">{household.name}</p>
        </div>
        <Avatar name={user?.display_name || '?'} src={user?.avatar_url} />
      </div>

      <div className="space-y-6">
        <RemindersSummary householdId={household.id} />
        <TodaySummary householdId={household.id} />
        <ListsSummary householdId={household.id} />
      </div>
    </div>
  )
}

function RemindersSummary({ householdId }: { householdId: string }) {
  const { data: tasks, isLoading } = useTasks(householdId)

  const pending = tasks?.filter((t) => t.status !== 'done') || []
  const todayStr = fmt(new Date())
  const overdue = pending.filter((t) => t.due_date && t.due_date < todayStr)

  return (
    <section>
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-lg font-bold text-text">Reminders</h2>
        <Link to="/tasks" className="text-sm font-medium text-primary">View all</Link>
      </div>

      {isLoading ? (
        <Skeleton count={2} />
      ) : pending.length === 0 ? (
        <Card>
          <p className="text-sm text-text-muted">All caught up!</p>
        </Card>
      ) : (
        <Card>
          <p className="text-sm text-text-muted mb-3">
            <span className="font-semibold text-text">{pending.length}</span> open
            {overdue.length > 0 && (
              <span className="text-accent"> · {overdue.length} overdue</span>
            )}
          </p>
          <div className="space-y-2.5">
            {pending.slice(0, 3).map((task) => (
              <div key={task.id} className="flex items-center gap-2.5">
                <PriorityDot priority={task.priority} />
                <p className="flex-1 text-sm font-medium text-text truncate">{task.title}</p>
                {task.due_date && (
                  <p className="text-xs text-text-muted shrink-0">{formatDueShort(task.due_date)}</p>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}
    </section>
  )
}

function TodaySummary({ householdId }: { householdId: string }) {
  const today = new Date()
  const todayStr = fmt(today)
  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)
  const tomorrowStr = fmt(tomorrow)

  const { data: events, isLoading } = useEvents(householdId, todayStr, tomorrowStr)

  const sorted = [...(events || [])].sort(
    (a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime()
  )

  return (
    <section>
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-lg font-bold text-text">Today</h2>
        <Link to="/calendar" className="text-sm font-medium text-primary">View all</Link>
      </div>

      {isLoading ? (
        <Skeleton count={2} />
      ) : sorted.length === 0 ? (
        <Card>
          <p className="text-sm text-text-muted">Nothing scheduled</p>
        </Card>
      ) : (
        <Card>
          <p className="text-sm text-text-muted mb-3">
            <span className="font-semibold text-text">{sorted.length}</span> event{sorted.length !== 1 ? 's' : ''} today
          </p>
          <div className="space-y-2.5">
            {sorted.slice(0, 3).map((event) => (
              <div key={event.id} className="flex items-center gap-2.5">
                <span className="text-xs font-medium text-primary shrink-0 w-12">
                  {new Date(event.start_time).toLocaleTimeString('en', { hour: 'numeric', minute: '2-digit' })}
                </span>
                <p className="flex-1 text-sm font-medium text-text truncate">{event.title}</p>
              </div>
            ))}
          </div>
        </Card>
      )}
    </section>
  )
}

function ListsSummary({ householdId }: { householdId: string }) {
  const { data: lists, isLoading } = useShoppingLists(householdId, 'active')

  return (
    <section>
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-lg font-bold text-text">Lists</h2>
        <Link to="/lists" className="text-sm font-medium text-primary">View all</Link>
      </div>

      {isLoading ? (
        <Skeleton count={2} />
      ) : !lists?.length ? (
        <Card>
          <p className="text-sm text-text-muted">No active lists</p>
        </Card>
      ) : (
        <Card>
          <p className="text-sm text-text-muted mb-3">
            <span className="font-semibold text-text">{lists.length}</span> active list{lists.length !== 1 ? 's' : ''}
          </p>
          <div className="space-y-2.5">
            {lists.slice(0, 3).map((list) => (
              <div key={list.id} className="flex items-center gap-2.5">
                <PriorityDot priority={list.priority} />
                <p className="flex-1 text-sm font-medium text-text truncate">
                  {list.name || 'Untitled list'}
                </p>
                <p className="text-xs text-text-muted shrink-0">
                  {list.item_count > 0 ? `${list.checked_count}/${list.item_count}` : 'Empty'}
                </p>
              </div>
            ))}
          </div>
        </Card>
      )}
    </section>
  )
}

function Skeleton({ count }: { count: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="h-10 bg-surface rounded-[var(--radius-card)] animate-pulse" />
      ))}
    </div>
  )
}

function formatDueShort(dateStr: string): string {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const date = new Date(dateStr + 'T00:00:00')
  const diffDays = Math.round((date.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))

  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Tomorrow'
  if (diffDays === -1) return 'Yesterday'
  if (diffDays < -1) return `${Math.abs(diffDays)}d ago`
  if (diffDays <= 7) return date.toLocaleDateString('en', { weekday: 'short' })
  return date.toLocaleDateString('en', { month: 'short', day: 'numeric' })
}
