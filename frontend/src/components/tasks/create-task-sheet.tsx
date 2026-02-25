import { motion, AnimatePresence } from 'framer-motion'
import { useRef, useState } from 'react'
import { Button, Input, Avatar } from '@/components/ui'
import type { TaskCreate } from '@/api/tasks'
import type { HouseholdMember } from '@/api/households'

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
}

export function CreateReminderSheet({ open, onClose, onSubmit, isPending, members }: CreateReminderSheetProps) {
  const [title, setTitle] = useState('')
  const [priority, setPriority] = useState(3)
  const [assignedTo, setAssignedTo] = useState<string | null>(null)
  const [dueDate, setDueDate] = useState<string | null>(null)
  const [recurrence, setRecurrence] = useState<string | null>(null)
  const [recurrenceInterval, setRecurrenceInterval] = useState(1)
  const titleRef = useRef<HTMLInputElement>(null)
  const dateInputRef = useRef<HTMLInputElement>(null)
  const isCustomDate = dueDate && !getDateOptions().some(o => o.value === dueDate)

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
    }
    onSubmit(task)
    setTitle('')
    setPriority(3)
    setAssignedTo(null)
    setDueDate(null)
    setRecurrence(null)
    setRecurrenceInterval(1)
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
            onAnimationComplete={() => titleRef.current?.focus()}
            className="fixed bottom-0 left-0 right-0 bg-surface rounded-t-3xl p-6 pb-[env(safe-area-inset-bottom)] z-50 max-w-lg mx-auto"
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

function getDateOptions(): { label: string; value: string }[] {
  const today = new Date()
  const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
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
