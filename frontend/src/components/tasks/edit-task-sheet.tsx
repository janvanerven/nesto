import { motion, AnimatePresence } from 'framer-motion'
import { useRef, useState, useEffect } from 'react'
import { Button, Input, Avatar } from '@/components/ui'
import type { Task, TaskUpdate } from '@/api/tasks'
import type { HouseholdMember } from '@/api/households'

interface EditReminderSheetProps {
  task: Task | null
  open: boolean
  onClose: () => void
  onSubmit: (update: TaskUpdate & { taskId: string }) => void
  onDelete: (taskId: string) => void
  isPending: boolean
  members: HouseholdMember[]
}

const RECURRENCE_OPTIONS = [
  { label: 'None', value: null },
  { label: 'Daily', value: 'daily' },
  { label: 'Weekly', value: 'weekly' },
  { label: 'Monthly', value: 'monthly' },
  { label: 'Yearly', value: 'yearly' },
] as const

function recurrenceUnit(rule: string): string {
  if (rule === 'daily') return 'day'
  if (rule === 'weekly') return 'week'
  if (rule === 'monthly') return 'month'
  return 'year'
}

function getDateOptions(): { label: string; value: string }[] {
  const today = new Date()
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)
  const nextWeek = new Date(today)
  nextWeek.setDate(nextWeek.getDate() + 7)

  return [
    { label: 'Today', value: fmt(today) },
    { label: 'Tomorrow', value: fmt(tomorrow) },
    { label: 'Next week', value: fmt(nextWeek) },
  ]
}

export function EditReminderSheet({
  task,
  open,
  onClose,
  onSubmit,
  onDelete,
  isPending,
  members,
}: EditReminderSheetProps) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState(3)
  const [assignedTo, setAssignedTo] = useState<string | null>(null)
  const [dueDate, setDueDate] = useState<string | null>(null)
  const [recurrence, setRecurrence] = useState<string | null>(null)
  const [recurrenceInterval, setRecurrenceInterval] = useState(1)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const dateInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!task) return
    setTitle(task.title)
    setDescription(task.description ?? '')
    setPriority(task.priority)
    setAssignedTo(task.assigned_to)
    setDueDate(task.due_date)
    setRecurrence(task.recurrence_rule)
    setRecurrenceInterval(task.recurrence_interval ?? 1)
    setConfirmDelete(false)
  }, [task])

  if (!task) return null

  const isCustomDate = dueDate && !getDateOptions().some((o) => o.value === dueDate)

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault()
    if (!task || !title.trim()) return

    const update: TaskUpdate & { taskId: string } = {
      taskId: task.id,
      title: title.trim(),
      description: description.trim() || undefined,
      priority,
      assigned_to: assignedTo ?? undefined,
      due_date: dueDate ?? undefined,
      recurrence_rule: dueDate && recurrence ? recurrence : undefined,
      recurrence_interval: dueDate && recurrence ? recurrenceInterval : undefined,
    }

    onSubmit(update)
  }

  function handleDeleteClick(): void {
    if (!task) return
    if (confirmDelete) {
      onDelete(task.id)
    } else {
      setConfirmDelete(true)
    }
  }

  const priorities = [
    { value: 1, label: 'Urgent', color: 'bg-priority-urgent' },
    { value: 2, label: 'High', color: 'bg-priority-high' },
    { value: 3, label: 'Normal', color: 'bg-priority-normal' },
    { value: 4, label: 'Low', color: 'bg-priority-low' },
  ]

  const canSubmit = title.trim() && !isPending

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/30 z-40"
            onClick={onClose}
          />
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="fixed bottom-0 left-0 right-0 bg-surface rounded-t-3xl p-6 pb-[env(safe-area-inset-bottom)] z-50 max-w-lg mx-auto max-h-[85vh] overflow-y-auto"
          >
            <div className="w-12 h-1.5 bg-text/10 rounded-full mx-auto mb-6" />
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-text">Edit reminder</h2>
              <button
                type="button"
                onClick={onClose}
                className="p-1.5 -mr-1.5 rounded-full text-text-muted hover:bg-text/5 transition-colors"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <Input
                label="Reminder"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />

              {/* Description */}
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-text-muted">Details</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                  className="px-4 py-3 rounded-[var(--radius-input)] border-2 border-text/10 bg-surface text-text text-base placeholder:text-text-muted/50 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all duration-200 resize-none"
                  placeholder="Add a description..."
                />
              </div>

              {/* Assignee picker */}
              {members.length > 0 && (
                <div>
                  <label className="text-sm font-medium text-text-muted mb-2 block">Assign to</label>
                  <div className="flex gap-3 overflow-x-auto py-1">
                    {members.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => setAssignedTo(assignedTo === m.id ? null : m.id)}
                        className={`flex flex-col items-center gap-1 min-w-[3.5rem] transition-all ${
                          assignedTo === m.id ? 'opacity-100 scale-105' : 'opacity-50'
                        }`}
                      >
                        <Avatar
                          name={m.display_name}
                          src={m.avatar_url}
                          size="md"
                          ring={assignedTo === m.id}
                        />
                        <span className="text-xs text-text-muted truncate w-full text-center">
                          {m.first_name || m.display_name.split(' ')[0]}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Due date quick-pick */}
              <div>
                <label className="text-sm font-medium text-text-muted mb-2 block">Due date</label>
                <div className="flex gap-2 flex-wrap relative">
                  {getDateOptions().map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setDueDate(dueDate === opt.value ? null : opt.value)}
                      className={`
                        px-3 py-1.5 rounded-full text-sm font-medium transition-all
                        ${dueDate === opt.value
                          ? 'bg-primary text-white shadow-md'
                          : 'bg-text/5 text-text-muted'
                        }
                      `}
                    >
                      {opt.label}
                    </button>
                  ))}
                  <label
                    className={`
                      relative px-3 py-1.5 rounded-full text-sm font-medium transition-all cursor-pointer
                      ${isCustomDate
                        ? 'bg-primary text-white shadow-md'
                        : 'bg-text/5 text-text-muted'
                      }
                    `}
                  >
                    {isCustomDate
                      ? new Date(dueDate + 'T00:00:00').toLocaleDateString('en', { month: 'short', day: 'numeric' })
                      : 'Pick date'}
                    <input
                      ref={dateInputRef}
                      type="date"
                      className="absolute inset-0 opacity-0 w-full h-full cursor-pointer text-base"
                      onChange={(e) => setDueDate(e.target.value || null)}
                    />
                  </label>
                </div>
              </div>

              {/* Recurrence (only when due date is set) */}
              {dueDate && (
                <div>
                  <label className="text-sm font-medium text-text-muted mb-2 block">Repeat</label>
                  <div className="flex gap-2 flex-wrap">
                    {RECURRENCE_OPTIONS.map((opt) => (
                      <button
                        key={opt.label}
                        type="button"
                        onClick={() => {
                          setRecurrence(opt.value)
                          setRecurrenceInterval(1)
                        }}
                        className={`
                          px-3 py-1.5 rounded-full text-sm font-medium transition-all
                          ${recurrence === opt.value
                            ? 'bg-primary text-white shadow-md'
                            : 'bg-text/5 text-text-muted'
                          }
                        `}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                  {recurrence && (
                    <div className="flex items-center gap-2 mt-3 text-sm text-text-muted">
                      <span>Every</span>
                      <input
                        type="number"
                        min={1}
                        max={99}
                        value={recurrenceInterval}
                        onChange={(e) =>
                          setRecurrenceInterval(Math.max(1, parseInt(e.target.value) || 1))
                        }
                        className="w-14 h-8 px-2 rounded-lg border-2 border-text/10 bg-surface text-text text-base text-center focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all duration-200"
                      />
                      <span>
                        {recurrenceUnit(recurrence)}
                        {recurrenceInterval !== 1 ? 's' : ''}
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* Priority selector */}
              <div>
                <label className="text-sm font-medium text-text-muted mb-2 block">Priority</label>
                <div className="flex gap-2">
                  {priorities.map((p) => (
                    <button
                      key={p.value}
                      type="button"
                      onClick={() => setPriority(p.value)}
                      className={`
                        flex-1 py-2 rounded-xl text-sm font-medium transition-all
                        ${priority === p.value
                          ? `${p.color} text-white shadow-md`
                          : 'bg-text/5 text-text-muted'
                        }
                      `}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Recurring reminder note */}
              {task.recurrence_rule && (
                <p className="text-xs text-text-muted">
                  Changes apply to all future occurrences of this recurring reminder.
                </p>
              )}

              {/* Action buttons */}
              <div className="flex gap-3">
                <Button type="submit" disabled={!canSubmit} className="flex-1">
                  {isPending ? 'Saving...' : 'Save changes'}
                </Button>
                <Button
                  type="button"
                  variant={confirmDelete ? 'danger' : 'ghost'}
                  onClick={handleDeleteClick}
                  disabled={isPending}
                >
                  {confirmDelete ? 'Confirm' : 'Delete'}
                </Button>
              </div>
            </form>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
