import { createFileRoute, Navigate } from '@tanstack/react-router'
import { useAuth } from 'react-oidc-context'
import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useHouseholds, useHouseholdMembers } from '@/api/households'
import { useTasks, useCreateTask, useUpdateTask, useDeleteTask } from '@/api/tasks'
import { TaskCard } from '@/components/tasks/task-card'
import { CreateReminderSheet } from '@/components/tasks/create-task-sheet'
import { EditReminderSheet } from '@/components/tasks/edit-task-sheet'
import { Fab, Card } from '@/components/ui'
import type { Task } from '@/api/tasks'

export const Route = createFileRoute('/tasks')({
  component: TasksPage,
})

function TasksPage() {
  const auth = useAuth()
  const { data: households } = useHouseholds()
  const [showCreate, setShowCreate] = useState(false)
  const [editingTask, setEditingTask] = useState<Task | null>(null)
  const [filter, setFilter] = useState<'pending' | 'done'>('pending')

  if (!auth.isAuthenticated) return <Navigate to="/login" />
  if (!households?.length) return <Navigate to="/onboarding" />

  const householdId = households[0].id

  return (
    <TasksContent
      householdId={householdId}
      filter={filter}
      setFilter={setFilter}
      showCreate={showCreate}
      setShowCreate={setShowCreate}
      editingTask={editingTask}
      setEditingTask={setEditingTask}
    />
  )
}

function TasksContent({
  householdId,
  filter,
  setFilter,
  showCreate,
  setShowCreate,
  editingTask,
  setEditingTask,
}: {
  householdId: string
  filter: 'pending' | 'done'
  setFilter: (f: 'pending' | 'done') => void
  showCreate: boolean
  setShowCreate: (v: boolean) => void
  editingTask: Task | null
  setEditingTask: (t: Task | null) => void
}) {
  const { data: tasks, isLoading } = useTasks(householdId, { status: filter })
  const { data: members = [] } = useHouseholdMembers(householdId)
  const createMutation = useCreateTask(householdId)
  const updateMutation = useUpdateTask(householdId)
  const deleteMutation = useDeleteTask(householdId)

  const sortedTasks = tasks?.slice().sort((a, b) => {
    if (!a.due_date && !b.due_date) return 0
    if (!a.due_date) return 1
    if (!b.due_date) return -1
    return a.due_date.localeCompare(b.due_date)
  })

  const filters = [
    { key: 'pending' as const, label: 'Active' },
    { key: 'done' as const, label: 'Completed' },
  ]

  return (
    <div className="pb-4">
      <h1 className="text-2xl font-extrabold text-text mt-2 mb-4">Reminders</h1>

      {/* Filter tabs */}
      <div className="flex gap-2 mb-4">
        {filters.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`
              px-4 py-2 rounded-full text-sm font-medium transition-all
              ${filter === f.key
                ? 'bg-primary text-white'
                : 'bg-text/5 text-text-muted hover:bg-text/10'
              }
            `}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Task list */}
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-20 bg-surface rounded-[var(--radius-card)] animate-pulse" />
          ))}
        </div>
      ) : !sortedTasks?.length ? (
        <Card className="text-center py-8">
          <p className="text-4xl mb-3">&#10024;</p>
          <p className="font-semibold text-text">
            {filter === 'done' ? 'No completed reminders' : 'No reminders yet'}
          </p>
          <p className="text-sm text-text-muted mt-1">
            {filter === 'done' ? 'Complete some reminders to see them here.' : 'Tap + to add your first reminder.'}
          </p>
        </Card>
      ) : (
        <motion.div className="space-y-3">
          <AnimatePresence>
            {sortedTasks.map((task, i) => (
              <motion.div
                key={task.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, x: -200 }}
                transition={{ delay: i * 0.05 }}
              >
                <TaskCard
                  task={task}
                  onComplete={(id) => updateMutation.mutate({ taskId: id, status: 'done' })}
                  onDelete={(id) => deleteMutation.mutate(id)}
                  onEdit={(t) => setEditingTask(t)}
                />
              </motion.div>
            ))}
          </AnimatePresence>
        </motion.div>
      )}

      {/* FAB */}
      <Fab pulse={!sortedTasks?.length} onClick={() => setShowCreate(true)}>
        +
      </Fab>

      {/* Edit sheet */}
      <EditReminderSheet
        task={editingTask}
        open={!!editingTask}
        onClose={() => setEditingTask(null)}
        onSubmit={async (update) => {
          await updateMutation.mutateAsync(update)
          setEditingTask(null)
        }}
        onDelete={async (id) => {
          await deleteMutation.mutateAsync(id)
          setEditingTask(null)
        }}
        isPending={updateMutation.isPending || deleteMutation.isPending}
        members={members}
      />

      {/* Create sheet */}
      <CreateReminderSheet
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onSubmit={async (task) => {
          await createMutation.mutateAsync(task)
          setShowCreate(false)
        }}
        isPending={createMutation.isPending}
        members={members}
      />
    </div>
  )
}
