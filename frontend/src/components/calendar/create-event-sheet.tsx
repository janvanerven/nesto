import { motion, AnimatePresence } from 'framer-motion'
import { useEffect, useRef, useState } from 'react'
import { Button, Input, Avatar } from '@/components/ui'
import type { EventCreate } from '@/api/events'
import type { HouseholdMember } from '@/api/households'

interface CreateEventSheetProps {
  open: boolean
  onClose: () => void
  onSubmit: (event: EventCreate) => void
  isPending: boolean
  members: HouseholdMember[]
  defaultDate: Date
}

const TIME_PRESETS = [
  { label: 'Morning', value: '09:00' },
  { label: 'Afternoon', value: '13:00' },
  { label: 'Evening', value: '18:00' },
] as const

const DURATION_PRESETS = [
  { label: '30 min', minutes: 30 },
  { label: '1 hour', minutes: 60 },
  { label: '2 hours', minutes: 120 },
] as const

const RECURRENCE_OPTIONS = [
  { label: 'None', value: null },
  { label: 'Daily', value: 'daily' },
  { label: 'Weekly', value: 'weekly' },
  { label: 'Monthly', value: 'monthly' },
] as const

function formatDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

function addMinutes(timeStr: string, minutes: number): string {
  const [h, m] = timeStr.split(':').map(Number)
  const total = h * 60 + m + minutes
  const newH = Math.floor(total / 60) % 24
  const newM = total % 60
  return `${String(newH).padStart(2, '0')}:${String(newM).padStart(2, '0')}`
}

function recurrenceUnit(rule: string): string {
  if (rule === 'daily') return 'day'
  if (rule === 'weekly') return 'week'
  return 'month'
}

export function CreateEventSheet({
  open,
  onClose,
  onSubmit,
  isPending,
  members,
  defaultDate,
}: CreateEventSheetProps) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [showDetails, setShowDetails] = useState(false)
  const [eventDate, setEventDate] = useState(formatDate(defaultDate))
  const [startTime, setStartTime] = useState<string | null>(null)
  const [customStart, setCustomStart] = useState(false)
  const [durationMinutes, setDurationMinutes] = useState<number | null>(60)
  const [customDuration, setCustomDuration] = useState(false)
  const [customEndTime, setCustomEndTime] = useState('')
  const [recurrence, setRecurrence] = useState<string | null>(null)
  const [recurrenceInterval, setRecurrenceInterval] = useState(1)
  const [assignedTo, setAssignedTo] = useState<string | null>(null)
  const [allDay, setAllDay] = useState(false)
  const [endDate, setEndDate] = useState(formatDate(defaultDate))

  const titleRef = useRef<HTMLInputElement>(null)
  const dateInputRef = useRef<HTMLInputElement>(null)
  const timeInputRef = useRef<HTMLInputElement>(null)
  const endTimeInputRef = useRef<HTMLInputElement>(null)

  function resetForm(): void {
    setTitle('')
    setDescription('')
    setShowDetails(false)
    setEventDate(formatDate(defaultDate))
    setStartTime(null)
    setCustomStart(false)
    setDurationMinutes(60)
    setCustomDuration(false)
    setCustomEndTime('')
    setRecurrence(null)
    setRecurrenceInterval(1)
    setAssignedTo(null)
    setAllDay(false)
    setEndDate(formatDate(defaultDate))
  }

  // Reset form when sheet opens (handles reopening with different defaultDate)
  useEffect(() => {
    if (open) resetForm()
  }, [open])

  // Keep endDate >= eventDate
  useEffect(() => {
    if (endDate < eventDate) setEndDate(eventDate)
  }, [eventDate])

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault()
    if (!title.trim()) return
    if (!allDay && !startTime) return

    let start_time: string
    let end_time: string

    if (allDay) {
      start_time = `${eventDate}T00:00:00`
      end_time = `${endDate}T23:59:59`
    } else {
      let endTimeVal: string
      if (customDuration && customEndTime) {
        endTimeVal = customEndTime
      } else {
        endTimeVal = addMinutes(startTime!, durationMinutes ?? 60)
      }
      start_time = `${eventDate}T${startTime}:00`
      end_time = `${eventDate}T${endTimeVal}:00`
    }

    const event: EventCreate = {
      title: title.trim(),
      start_time,
      end_time,
      all_day: allDay || undefined,
    }

    if (description.trim()) event.description = description.trim()
    if (assignedTo) event.assigned_to = assignedTo
    if (recurrence) {
      event.recurrence_rule = recurrence
      event.recurrence_interval = recurrenceInterval
    }

    onSubmit(event)
    resetForm()
  }

  function getDateOptions(): { label: string; value: string }[] {
    const today = new Date()
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)

    const options: { label: string; value: string }[] = []

    // Add the selected calendar day as first option if it's not today or tomorrow
    if (!isSameDay(defaultDate, today) && !isSameDay(defaultDate, tomorrow)) {
      options.push({
        label: defaultDate.toLocaleDateString('en', { month: 'short', day: 'numeric' }),
        value: formatDate(defaultDate),
      })
    }

    options.push(
      { label: 'Today', value: formatDate(today) },
      { label: 'Tomorrow', value: formatDate(tomorrow) },
    )

    return options
  }

  const dateOptions = getDateOptions()
  const isCustomDate = eventDate && !dateOptions.some((o) => o.value === eventDate)
  const isPresetTime = TIME_PRESETS.some((p) => p.value === startTime)
  const canSubmit = title.trim() && (allDay || startTime) && !isPending

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
            <h2 className="text-xl font-bold text-text mb-4">New event</h2>

            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <Input
                ref={titleRef}
                label="Event title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />

              {/* Collapsible description */}
              {!showDetails ? (
                <button
                  type="button"
                  onClick={() => setShowDetails(true)}
                  className="text-sm text-primary font-medium text-left"
                >
                  Add details...
                </button>
              ) : (
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
              )}

              {/* All-day toggle */}
              <div>
                <label className="text-sm font-medium text-text-muted mb-2 block">Type</label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setAllDay(false)}
                    className={`px-3 py-1.5 rounded-full text-sm font-medium transition-all ${
                      !allDay ? 'bg-primary text-white shadow-md' : 'bg-text/5 text-text-muted'
                    }`}
                  >
                    Timed
                  </button>
                  <button
                    type="button"
                    onClick={() => setAllDay(true)}
                    className={`px-3 py-1.5 rounded-full text-sm font-medium transition-all ${
                      allDay ? 'bg-primary text-white shadow-md' : 'bg-text/5 text-text-muted'
                    }`}
                  >
                    All day
                  </button>
                </div>
              </div>

              {/* Date quick-pick */}
              <div>
                <label className="text-sm font-medium text-text-muted mb-2 block">Date</label>
                <div className="flex gap-2 flex-wrap relative">
                  {dateOptions.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setEventDate(opt.value)}
                      className={`
                        px-3 py-1.5 rounded-full text-sm font-medium transition-all
                        ${eventDate === opt.value
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
                      ? new Date(eventDate + 'T00:00:00').toLocaleDateString('en', {
                          month: 'short',
                          day: 'numeric',
                        })
                      : 'Pick date'}
                    <input
                      ref={dateInputRef}
                      type="date"
                      className="absolute inset-0 opacity-0 w-full h-full cursor-pointer text-base"
                      onChange={(e) => {
                        if (e.target.value) setEventDate(e.target.value)
                      }}
                    />
                  </label>
                </div>
              </div>

              {/* End date (for all-day events) */}
              {allDay && (
                <label className="flex flex-col gap-1.5">
                  <span className="text-sm font-medium text-text-muted">End date</span>
                  <input
                    type="date"
                    value={endDate}
                    min={eventDate}
                    onChange={(e) => { if (e.target.value) setEndDate(e.target.value) }}
                    className="px-4 py-2.5 rounded-[var(--radius-input)] border-2 border-text/10 bg-surface text-text text-base font-medium focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all duration-200"
                  />
                </label>
              )}

              {/* Start time quick-pick */}
              {!allDay && (
              <div>
                <label className="text-sm font-medium text-text-muted mb-2 block">
                  Start time
                </label>
                <div className="flex gap-2 flex-wrap relative">
                  {TIME_PRESETS.map((preset) => (
                    <button
                      key={preset.value}
                      type="button"
                      onClick={() => {
                        setStartTime(preset.value)
                        setCustomStart(false)
                      }}
                      className={`
                        px-3 py-1.5 rounded-full text-sm font-medium transition-all
                        ${startTime === preset.value && !customStart
                          ? 'bg-primary text-white shadow-md'
                          : 'bg-text/5 text-text-muted'
                        }
                      `}
                    >
                      {preset.label}
                    </button>
                  ))}
                  <label
                    className={`
                      relative px-3 py-1.5 rounded-full text-sm font-medium transition-all cursor-pointer
                      ${customStart || (startTime && !isPresetTime)
                        ? 'bg-primary text-white shadow-md'
                        : 'bg-text/5 text-text-muted'
                      }
                    `}
                  >
                    {customStart || (startTime && !isPresetTime) ? startTime : 'Custom'}
                    <input
                      ref={timeInputRef}
                      type="time"
                      className="absolute inset-0 opacity-0 w-full h-full cursor-pointer text-base"
                      onChange={(e) => {
                        if (e.target.value) {
                          setStartTime(e.target.value)
                          setCustomStart(true)
                        }
                      }}
                    />
                  </label>
                </div>
              </div>
              )}

              {/* Duration quick-pick (shown after start time selected) */}
              {!allDay && startTime && (
                <div>
                  <label className="text-sm font-medium text-text-muted mb-2 block">
                    Duration
                  </label>
                  <div className="flex gap-2 flex-wrap relative">
                    {DURATION_PRESETS.map((preset) => (
                      <button
                        key={preset.minutes}
                        type="button"
                        onClick={() => {
                          setDurationMinutes(preset.minutes)
                          setCustomDuration(false)
                          setCustomEndTime('')
                        }}
                        className={`
                          px-3 py-1.5 rounded-full text-sm font-medium transition-all
                          ${durationMinutes === preset.minutes && !customDuration
                            ? 'bg-primary text-white shadow-md'
                            : 'bg-text/5 text-text-muted'
                          }
                        `}
                      >
                        {preset.label}
                      </button>
                    ))}
                    <label
                      className={`
                        relative px-3 py-1.5 rounded-full text-sm font-medium transition-all cursor-pointer
                        ${customDuration
                          ? 'bg-primary text-white shadow-md'
                          : 'bg-text/5 text-text-muted'
                        }
                      `}
                    >
                      {customDuration && customEndTime
                        ? `Until ${customEndTime}`
                        : 'Custom'}
                      <input
                        ref={endTimeInputRef}
                        type="time"
                        className="absolute inset-0 opacity-0 w-full h-full cursor-pointer text-base"
                        onChange={(e) => {
                          if (e.target.value) {
                            setCustomEndTime(e.target.value)
                            setCustomDuration(true)
                            setDurationMinutes(null)
                          }
                        }}
                      />
                    </label>
                  </div>
                </div>
              )}

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

              <Button type="submit" disabled={!canSubmit}>
                {isPending ? 'Creating...' : 'Create event'}
              </Button>
            </form>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
