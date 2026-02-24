import { createFileRoute, Navigate, Link } from '@tanstack/react-router'
import { useAuth } from 'react-oidc-context'
import { motion } from 'framer-motion'
import { useHouseholds } from '@/api/households'
import { useCurrentUser } from '@/api/user'
import { useTasks } from '@/api/tasks'
import { Avatar, Card, PriorityDot } from '@/components/ui'

export const Route = createFileRoute('/')({
  component: DashboardPage,
})

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

      {/* Task Summary */}
      <TaskSummary householdId={household.id} />
    </div>
  )
}

function TaskSummary({ householdId }: { householdId: string }) {
  const { data: tasks, isLoading } = useTasks(householdId)

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-20 bg-surface rounded-[var(--radius-card)] animate-pulse" />
        ))}
      </div>
    )
  }

  const pendingTasks = tasks?.filter((t) => t.status !== 'done') || []
  const todayStr = new Date().toISOString().split('T')[0]
  const todayTasks = pendingTasks.filter((t) => t.due_date === todayStr)
  const overdueTasks = pendingTasks.filter((t) => t.due_date && t.due_date < todayStr)

  return (
    <div>
      {/* Stats row */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <StatCard label="Open" value={pendingTasks.length} color="text-primary" />
        <StatCard label="Today" value={todayTasks.length} color="text-secondary" />
        <StatCard label="Overdue" value={overdueTasks.length} color="text-accent" />
      </div>

      {/* Recent tasks */}
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-bold text-text">Upcoming reminders</h2>
        <Link to="/tasks" className="text-sm font-medium text-primary">
          View all
        </Link>
      </div>

      {pendingTasks.length === 0 ? (
        <EmptyState />
      ) : (
        <motion.div className="space-y-3">
          {pendingTasks.slice(0, 5).map((task, i) => (
            <motion.div
              key={task.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
            >
              <Card>
                <div className="flex items-start gap-3">
                  <PriorityDot priority={task.priority} />
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-text truncate">{task.title}</p>
                    <p className="text-sm text-text-muted mt-0.5">
                      {task.due_date ? `Due ${task.due_date}` : 'No due date'}
                    </p>
                  </div>
                </div>
              </Card>
            </motion.div>
          ))}
        </motion.div>
      )}
    </div>
  )
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <Card className="text-center">
      <p className={`text-2xl font-extrabold ${color}`}>{value}</p>
      <p className="text-xs font-medium text-text-muted uppercase tracking-wide mt-1">{label}</p>
    </Card>
  )
}

function EmptyState() {
  return (
    <Card className="text-center py-8">
      <p className="text-4xl mb-3">&#127968;</p>
      <p className="font-semibold text-text">All caught up!</p>
      <p className="text-sm text-text-muted mt-1">Time to put your feet up.</p>
    </Card>
  )
}
