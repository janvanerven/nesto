import { motion, AnimatePresence } from 'framer-motion'
import { useRef, useState, useEffect } from 'react'
import { Button, Input, Avatar } from '@/components/ui'
import type { CalendarEvent, EventUpdate } from '@/api/events'
import type { HouseholdMember } from '@/api/households'

interface EditEventSheetProps {
  event: CalendarEvent | null
  open: boolean
  onClose: () => void
  onSubmit: (update: EventUpdate & { eventId: string }) => void
  onDelete: (eventId: string) => void
  isPending: boolean
  members: HouseholdMember[]
}

const RECURRENCE_OPTIONS = [
  { label: 'None', value: null },
  { label: 'Daily', value: 'daily' },
  { label: 'Weekly', value: 'weekly' },
  { label: 'Monthly', value: 'monthly' },
] as const

function padTime(n: number): string {
  return String(n).padStart(2, '0')
}

function recurrenceUnit(rule: string): string {
  if (rule === 'daily') return 'day'
  if (rule === 'weekly') return 'week'
  return 'month'
}

export function EditEventSheet({
  event,
  open,
  onClose,
  onSubmit,
  onDelete,
  isPending,
  members,
}: EditEventSheetProps) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [eventDate, setEventDate] = useState('')
  const [startTime, setStartTime] = useState('')
  const [endTime, setEndTime] = useState('')
  const [recurrence, setRecurrence] = useState<string | null>(null)
  const [recurrenceInterval, setRecurrenceInterval] = useState(1)
  const [assignedTo, setAssignedTo] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const startTimeRef = useRef<HTMLInputElement>(null)
  const endTimeRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!event) return

    const start = new Date(event.start_time)
    const end = new Date(event.end_time)

    setTitle(event.title)
    setDescription(event.description ?? '')
    setEventDate(
      `${start.getFullYear()}-${padTime(start.getMonth() + 1)}-${padTime(start.getDate())}`
    )
    setStartTime(`${padTime(start.getHours())}:${padTime(start.getMinutes())}`)
    setEndTime(`${padTime(end.getHours())}:${padTime(end.getMinutes())}`)
    setRecurrence(event.recurrence_rule)
    setRecurrenceInterval(event.recurrence_interval ?? 1)
    setAssignedTo(event.assigned_to)
    setConfirmDelete(false)
  }, [event])

  if (!event) return null

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault()
    if (!event || !title.trim() || !startTime || !endTime) return

    const start_time = `${eventDate}T${startTime}:00`
    const end_time = `${eventDate}T${endTime}:00`

    const update: EventUpdate & { eventId: string } = {
      eventId: event.id,
      title: title.trim(),
      description: description.trim() || undefined,
      start_time,
      end_time,
      assigned_to: assignedTo ?? undefined,
      recurrence_rule: recurrence,
      recurrence_interval: recurrence ? recurrenceInterval : undefined,
    }

    onSubmit(update)
  }

  function handleDeleteClick(): void {
    if (!event) return

    if (confirmDelete) {
      onDelete(event.id)
    } else {
      setConfirmDelete(true)
    }
  }

  const canSubmit = title.trim() && startTime && endTime && !isPending

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
              <h2 className="text-xl font-bold text-text">Edit event</h2>
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
                label="Event title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />

              {/* Description — always visible for edit */}
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

              {/* Date picker */}
              <label className="flex flex-col gap-1.5">
                <span className="text-sm font-medium text-text-muted">Date</span>
                <input
                  type="date"
                  value={eventDate}
                  onChange={(e) => { if (e.target.value) setEventDate(e.target.value) }}
                  className="px-4 py-2.5 rounded-[var(--radius-input)] border-2 border-text/10 bg-surface text-text text-base font-medium focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all duration-200"
                />
              </label>

              {/* Start / End time pickers */}
              <div>
                <label className="text-sm font-medium text-text-muted mb-2 block">Time</label>
                <div className="flex gap-2">
                  <label className="relative flex-1 px-4 py-2.5 rounded-xl border-2 border-text/10 bg-surface text-text text-sm font-medium text-center transition-all cursor-pointer">
                    Start: {startTime || '--:--'}
                    <input
                      ref={startTimeRef}
                      type="time"
                      value={startTime}
                      className="absolute inset-0 opacity-0 w-full h-full cursor-pointer text-base"
                      onChange={(e) => {
                        if (e.target.value) setStartTime(e.target.value)
                      }}
                    />
                  </label>
                  <label className="relative flex-1 px-4 py-2.5 rounded-xl border-2 border-text/10 bg-surface text-text text-sm font-medium text-center transition-all cursor-pointer">
                    End: {endTime || '--:--'}
                    <input
                      ref={endTimeRef}
                      type="time"
                      value={endTime}
                      className="absolute inset-0 opacity-0 w-full h-full cursor-pointer text-base"
                      onChange={(e) => {
                        if (e.target.value) setEndTime(e.target.value)
                      }}
                    />
                  </label>
                </div>
              </div>

              {/* Recurrence toggle pills */}
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

              {/* Assignee picker */}
              {members.length > 0 && (
                <div>
                  <label className="text-sm font-medium text-text-muted mb-2 block">
                    Assign to
                  </label>
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

              {/* Recurring event note */}
              {event.recurrence_rule && (
                <p className="text-xs text-text-muted">
                  Changes apply to all occurrences of this recurring event.
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
