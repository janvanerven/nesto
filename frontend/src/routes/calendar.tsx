import { createFileRoute, Navigate } from '@tanstack/react-router'
import { useAuth } from 'react-oidc-context'
import { useState, useMemo } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useHouseholds, useHouseholdMembers } from '@/api/households'
import { useEvents, useCreateEvent, useUpdateEvent, useDeleteEvent } from '@/api/events'
import type { CalendarEvent } from '@/api/events'
import { expandRecurrences } from '@/utils/recurrence'
import { WeekStrip } from '@/components/calendar/week-strip'
import { EventCard } from '@/components/calendar/event-card'
import { CreateEventSheet } from '@/components/calendar/create-event-sheet'
import { EditEventSheet } from '@/components/calendar/edit-event-sheet'
import { Fab, Card } from '@/components/ui'

export const Route = createFileRoute('/calendar')({
  component: CalendarPage,
})

function CalendarPage() {
  const auth = useAuth()
  const { data: households } = useHouseholds()

  if (!auth.isAuthenticated) return <Navigate to="/login" />
  if (!households?.length) return <Navigate to="/onboarding" />

  return <CalendarContent householdId={households[0].id} />
}

function getMonday(d: Date): Date {
  const date = new Date(d)
  date.setHours(0, 0, 0, 0)
  const day = date.getDay()
  // getDay() returns 0 for Sunday, 1 for Monday, etc.
  // Shift so Monday = 0: (day + 6) % 7
  const diff = (day + 6) % 7
  date.setDate(date.getDate() - diff)
  return date
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

function formatSelectedLabel(date: Date): string {
  return date.toLocaleDateString('en', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  })
}

function CalendarContent({ householdId }: { householdId: string }) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const [selectedDate, setSelectedDate] = useState<Date>(today)
  const [weekStart, setWeekStart] = useState<Date>(() => getMonday(today))
  const [showCreate, setShowCreate] = useState(false)
  const [editEvent, setEditEvent] = useState<CalendarEvent | null>(null)

  const fetchStart = useMemo(() => {
    const d = new Date(weekStart)
    d.setDate(d.getDate() - 7)
    return d.toISOString()
  }, [weekStart])

  const fetchEnd = useMemo(() => {
    const d = new Date(weekStart)
    d.setDate(d.getDate() + 14)
    return d.toISOString()
  }, [weekStart])

  const { data: events = [], isLoading } = useEvents(householdId, fetchStart, fetchEnd)
  const { data: members = [] } = useHouseholdMembers(householdId)
  const createMutation = useCreateEvent(householdId)
  const updateMutation = useUpdateEvent(householdId)
  const deleteMutation = useDeleteEvent(householdId)

  const weekEnd = useMemo(() => {
    const d = new Date(weekStart)
    d.setDate(d.getDate() + 7)
    return d
  }, [weekStart])

  const occurrences = useMemo(
    () => expandRecurrences(events, weekStart, weekEnd),
    [events, weekStart, weekEnd],
  )

  const dayOccurrences = useMemo(
    () => occurrences.filter((occ) => isSameDay(occ.occurrenceStart, selectedDate)),
    [occurrences, selectedDate],
  )

  function navigateWeek(direction: -1 | 1): void {
    setWeekStart((prev) => {
      const next = new Date(prev)
      next.setDate(next.getDate() + direction * 7)
      return next
    })
  }

  const selectedLabel = formatSelectedLabel(selectedDate)

  return (
    <div className="pb-4">
      <h1 className="text-2xl font-extrabold text-text mt-2 mb-4">Calendar</h1>

      <Card className="mb-4">
        <WeekStrip
          weekStart={weekStart}
          selectedDate={selectedDate}
          onSelectDate={setSelectedDate}
          onNavigate={navigateWeek}
          occurrences={occurrences}
        />
      </Card>

      <h2 className="text-lg font-bold text-text mb-3">{selectedLabel}</h2>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2].map((i) => (
            <div
              key={i}
              className="h-20 bg-surface rounded-[var(--radius-card)] animate-pulse"
            />
          ))}
        </div>
      ) : dayOccurrences.length === 0 ? (
        <Card className="text-center py-8">
          <p className="text-4xl mb-3">&#9728;&#65039;</p>
          <p className="font-semibold text-text">No events</p>
          <p className="text-sm text-text-muted mt-1">Tap + to add an event.</p>
        </Card>
      ) : (
        <motion.div className="space-y-3">
          <AnimatePresence>
            {dayOccurrences.map((occ, i) => (
              <motion.div
                key={`${occ.event.id}-${occ.occurrenceStart.toISOString()}`}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, x: -200 }}
                transition={{ delay: i * 0.05 }}
              >
                <EventCard
                  occurrence={occ}
                  members={members}
                  onClick={() => setEditEvent(occ.event)}
                />
              </motion.div>
            ))}
          </AnimatePresence>
        </motion.div>
      )}

      <Fab pulse={dayOccurrences.length === 0} onClick={() => setShowCreate(true)}>
        +
      </Fab>

      <CreateEventSheet
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onSubmit={async (event) => {
          await createMutation.mutateAsync(event)
          setShowCreate(false)
        }}
        isPending={createMutation.isPending}
        members={members}
        defaultDate={selectedDate}
      />

      <EditEventSheet
        event={editEvent}
        open={editEvent !== null}
        onClose={() => setEditEvent(null)}
        onSubmit={async (update) => {
          await updateMutation.mutateAsync(update)
          setEditEvent(null)
        }}
        onDelete={async (eventId) => {
          await deleteMutation.mutateAsync(eventId)
          setEditEvent(null)
        }}
        isPending={updateMutation.isPending || deleteMutation.isPending}
        members={members}
      />
    </div>
  )
}
