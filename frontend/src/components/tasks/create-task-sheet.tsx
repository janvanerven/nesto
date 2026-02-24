import { motion, AnimatePresence } from 'framer-motion'
import { useRef, useState } from 'react'
import { Button, Input, Avatar } from '@/components/ui'
import type { TaskCreate } from '@/api/tasks'
import type { HouseholdMember } from '@/api/households'

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
  const dateInputRef = useRef<HTMLInputElement>(null)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return
    onSubmit({
      title: title.trim(),
      priority,
      assigned_to: assignedTo || undefined,
      due_date: dueDate || undefined,
    })
    setTitle('')
    setPriority(3)
    setAssignedTo(null)
    setDueDate(null)
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
            className="fixed bottom-0 left-0 right-0 bg-surface rounded-t-3xl p-6 pb-[env(safe-area-inset-bottom)] z-50 max-w-lg mx-auto"
          >
            <div className="w-12 h-1.5 bg-text/10 rounded-full mx-auto mb-6" />
            <h2 className="text-xl font-bold text-text mb-4">New reminder</h2>

            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <Input
                label="What needs to be done?"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                autoFocus
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
                  <button
                    type="button"
                    onClick={() => dateInputRef.current?.showPicker()}
                    className={`
                      px-3 py-1.5 rounded-full text-sm font-medium transition-all
                      ${dueDate && !getDateOptions().some(o => o.value === dueDate)
                        ? 'bg-primary text-white shadow-md'
                        : 'bg-text/5 text-text-muted'
                      }
                    `}
                  >
                    {dueDate && !getDateOptions().some(o => o.value === dueDate)
                      ? new Date(dueDate + 'T00:00:00').toLocaleDateString('en', { month: 'short', day: 'numeric' })
                      : 'Pick date'}
                  </button>
                  <input
                    ref={dateInputRef}
                    type="date"
                    className="absolute opacity-0 pointer-events-none"
                    onChange={(e) => setDueDate(e.target.value || null)}
                  />
                </div>
              </div>

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
