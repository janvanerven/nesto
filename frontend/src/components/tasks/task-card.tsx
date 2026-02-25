import { useState } from 'react'
import { Avatar, Card, PriorityDot } from '@/components/ui'
import type { Task } from '@/api/tasks'
import type { HouseholdMember } from '@/api/households'

interface TaskCardProps {
  task: Task
  members?: HouseholdMember[]
  onComplete: (id: string) => void
  onDelete: (id: string) => void
  onEdit?: (task: Task) => void
}

export function TaskCard({ task, members = [], onComplete, onDelete, onEdit }: TaskCardProps) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const isDone = task.status === 'done'
  const assignee = task.assigned_to ? members.find((m) => m.id === task.assigned_to) : null

  return (
    <Card className={isDone ? 'opacity-60' : ''}>
      <div className="flex items-start gap-3">
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

        {/* Content — tappable to edit */}
        <div
          className="flex-1 min-w-0 cursor-pointer"
          onClick={() => onEdit?.(task)}
        >
          <div className="flex items-center gap-2">
            <PriorityDot priority={task.priority} />
            <p className={`font-semibold text-text ${isDone ? 'line-through text-text-muted' : ''}`}>
              {task.title}
            </p>
          </div>
          {task.due_date && (
            <div className="flex items-center gap-2 mt-1 ml-4">
              <p className="text-xs text-text-muted">
                {formatDueDate(task.due_date)}
              </p>
              {task.recurrence_rule && (
                <span className="inline-flex items-center gap-1 text-xs text-text-muted bg-text/5 px-1.5 py-0.5 rounded-full">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17 2l4 4-4 4" /><path d="M3 11v-1a4 4 0 014-4h14" /><path d="M7 22l-4-4 4-4" /><path d="M21 13v1a4 4 0 01-4 4H3" />
                  </svg>
                  {formatRecurrence(task.recurrence_rule, task.recurrence_interval)}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Assignee avatar */}
        {assignee && (
          <Avatar
            name={assignee.display_name}
            src={assignee.avatar_url}
            size="sm"
          />
        )}

        {/* Delete button */}
        <button
          onClick={() => {
            if (confirmDelete) {
              onDelete(task.id)
              setConfirmDelete(false)
            } else {
              setConfirmDelete(true)
            }
          }}
          className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 transition-all ${
            confirmDelete ? 'text-accent bg-accent/10' : 'text-text-muted hover:text-accent hover:bg-accent/10'
          }`}
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

function formatRecurrence(rule: string, interval: number): string {
  const labels: Record<string, [string, string]> = {
    daily: ['Daily', 'days'],
    weekly: ['Weekly', 'weeks'],
    monthly: ['Monthly', 'months'],
    yearly: ['Yearly', 'years'],
  }
  const [single, plural] = labels[rule] ?? ['', '']
  if (interval === 1) return single
  return `${interval} ${plural}`
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
