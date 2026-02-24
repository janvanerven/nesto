import { Card, PriorityDot } from '@/components/ui'
import type { Task } from '@/api/tasks'

interface TaskCardProps {
  task: Task
  onComplete: (id: string) => void
  onDelete: (id: string) => void
}

export function TaskCard({ task, onComplete, onDelete }: TaskCardProps) {
  const isDone = task.status === 'done'

  return (
    <Card className={isDone ? 'opacity-60' : ''}>
      <div className="flex items-center gap-3">
        {/* Complete button */}
        <button
          onClick={() => onComplete(task.id)}
          className={`
            w-7 h-7 rounded-full border-2 flex items-center justify-center shrink-0 transition-all
            ${isDone
              ? 'bg-success border-success text-white'
              : 'border-text/20 hover:border-success hover:bg-success/10'
            }
          `}
          aria-label={isDone ? 'Completed' : 'Mark as done'}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 6L9 17l-5-5" />
          </svg>
        </button>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <PriorityDot priority={task.priority} />
            <p className={`font-semibold text-text truncate ${isDone ? 'line-through text-text-muted' : ''}`}>
              {task.title}
            </p>
          </div>
          {task.due_date && (
            <p className="text-xs text-text-muted mt-1 ml-4">
              {formatDueDate(task.due_date)}
            </p>
          )}
        </div>

        {/* Delete button */}
        <button
          onClick={() => onDelete(task.id)}
          className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-text-muted hover:text-accent hover:bg-accent/10 transition-all"
          aria-label="Delete"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 6h18" /><path d="M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2" /><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
          </svg>
        </button>
      </div>
    </Card>
  )
}

function formatDueDate(dateStr: string): string {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const date = new Date(dateStr + 'T00:00:00')
  const diffDays = Math.round((date.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))

  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Tomorrow'
  if (diffDays === -1) return 'Yesterday'
  if (diffDays < -1) return `${Math.abs(diffDays)} days ago`
  if (diffDays <= 7) return date.toLocaleDateString('en', { weekday: 'long' })
  return date.toLocaleDateString('en', { month: 'short', day: 'numeric' })
}
