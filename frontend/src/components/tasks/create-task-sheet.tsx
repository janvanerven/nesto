import { motion, AnimatePresence } from 'framer-motion'
import { useEffect, useRef, useState } from 'react'
import { Button, Input, Avatar } from '@/components/ui'
import type { TaskCreate } from '@/api/tasks'
import type { HouseholdMember } from '@/api/households'
import { useScrollLock } from '@/utils/use-scroll-lock'

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

interface CreateReminderSheetProps {
  open: boolean
  onClose: () => void
  onSubmit: (task: TaskCreate) => void
  isPending: boolean
  members: HouseholdMember[]
  /** Prefill applied when the sheet opens; changes while open are ignored. */
  initialValues?: Partial<TaskCreate>
}

/** TaskCreate fields this sheet doesn't render; carried through to onSubmit. */
type HiddenTaskFields = Pick<TaskCreate, 'description' | 'category' | 'recurrence_end'>
const NO_HIDDEN_FIELDS: HiddenTaskFields = {}

export function CreateReminderSheet({ open, onClose, onSubmit, isPending, members, initialValues }: CreateReminderSheetProps) {
  const [title, setTitle] = useState('')
  const [priority, setPriority] = useState(3)
  const [assignedTo, setAssignedTo] = useState<string | null>(null)
  const [dueDate, setDueDate] = useState<string | null>(null)
  const [recurrence, setRecurrence] = useState<string | null>(null)
  const [recurrenceInterval, setRecurrenceInterval] = useState(1)
  const [hidden, setHidden] = useState<HiddenTaskFields>(NO_HIDDEN_FIELDS)
  const titleRef = useRef<HTMLInputElement>(null)

  useScrollLock(open)

  // Prefill when the sheet opens with initialValues. A plain open only drops
  // hidden fields left by an earlier prefilled open; visible state is untouched.
  useEffect(() => {
    if (!open) return
    if (!initialValues) {
      setHidden(NO_HIDDEN_FIELDS)
      return
    }
    const p = initialValues.priority
    const rule = initialValues.recurrence_rule
    const interval = initialValues.recurrence_interval
    setTitle(initialValues.title ?? '')
    setPriority(p !== undefined && Number.isInteger(p) && p >= 1 && p <= 4 ? p : 3)
    setAssignedTo(initialValues.assigned_to || null)
    setDueDate(initialValues.due_date || null)
    setRecurrence(RECURRENCE_OPTIONS.some((o) => o.value === rule) ? rule ?? null : null)
    setRecurrenceInterval(interval !== undefined && Number.isInteger(interval) && interval >= 1 ? interval : 1)
    const next: HiddenTaskFields = {}
    if (initialValues.description != null) next.description = initialValues.description
    if (initialValues.category != null) next.category = initialValues.category
    if (initialValues.recurrence_end != null) next.recurrence_end = initialValues.recurrence_end
    setHidden(next)
  }, [open])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return
    const task: TaskCreate = {
      title: title.trim(),
      priority,
      assigned_to: assignedTo || undefined,
      due_date: dueDate || undefined,
    }
    if (dueDate && recurrence) {
      task.recurrence_rule = recurrence
      task.recurrence_interval = recurrenceInterval
      if (hidden.recurrence_end !== undefined) task.recurrence_end = hidden.recurrence_end
    }
    if (hidden.description !== undefined) task.description = hidden.description
    if (hidden.category !== undefined) task.category = hidden.category
    onSubmit(task)
    setTitle('')
    setPriority(3)
    setAssignedTo(null)
    setDueDate(null)
    setRecurrence(null)
    setRecurrenceInterval(1)
    setHidden(NO_HIDDEN_FIELDS)
  }

  const priorities = [
    { value: 1, label: 'Urgent', color: 'bg-priority-urgent' },
    { value: 2, label: 'High', color: 'bg-priority-high' },
    { value: 3, label: 'Normal', color: 'bg-priority-normal' },
    { value: 4, label: 'Low', color: 'bg-priority-low' },
  ]

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
            onAnimationComplete={(def: { y?: string | number }) => {
              if (def.y === 0) titleRef.current?.focus()
            }}
            className="fixed bottom-0 left-0 right-0 bg-surface rounded-t-3xl p-6 pb-[env(safe-area-inset-bottom)] z-50 max-w-lg mx-auto max-h-[85vh] overflow-y-auto"
          >
            <div className="w-12 h-1.5 bg-text/10 rounded-full mx-auto mb-6" />
            <h2 className="text-xl font-bold text-text mb-4">New reminder</h2>

            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <Input
                ref={titleRef}
                label="What do you want to be reminded of?"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />

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

              {/* Due date */}
              <label className="flex flex-col gap-1.5">
                <span className="text-sm font-medium text-text-muted">Due date</span>
                <input
                  type="date"
                  value={dueDate ?? ''}
                  onChange={(e) => setDueDate(e.target.value || null)}
                  className="px-4 py-2.5 rounded-[var(--radius-input)] border-2 border-text/10 bg-surface text-text text-base font-medium focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all duration-200"
                />
              </label>

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

              <Button type="submit" disabled={!title.trim() || isPending}>
                {isPending ? 'Adding...' : 'Add reminder'}
              </Button>
            </form>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
