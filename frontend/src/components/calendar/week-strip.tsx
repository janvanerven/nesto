import type { EventOccurrence } from '@/utils/recurrence'

interface WeekStripProps {
  weekStart: Date
  selectedDate: Date
  onSelectDate: (date: Date) => void
  onNavigate: (direction: -1 | 1) => void
  occurrences: EventOccurrence[]
}

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export function WeekStrip({ weekStart, selectedDate, onSelectDate, onNavigate, occurrences }: WeekStripProps) {
  const days = getDaysOfWeek(weekStart)
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const monthLabel = weekStart.toLocaleDateString('en', { month: 'long', year: 'numeric' })

  return (
    <div>
      {/* Month header with navigation */}
      <div className="flex items-center justify-between mb-3">
        <button
          onClick={() => onNavigate(-1)}
          className="w-9 h-9 rounded-full flex items-center justify-center text-text-muted hover:bg-text/5 transition-colors"
          aria-label="Previous week"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <h2 className="text-lg font-bold text-text">{monthLabel}</h2>
        <button
          onClick={() => onNavigate(1)}
          className="w-9 h-9 rounded-full flex items-center justify-center text-text-muted hover:bg-text/5 transition-colors"
          aria-label="Next week"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 18l6-6-6-6" />
          </svg>
        </button>
      </div>

      {/* Day cells */}
      <div className="grid grid-cols-7 gap-1">
        {days.map((day, i) => {
          const isToday = isSameDay(day, today)
          const isSelected = isSameDay(day, selectedDate)
          const dayEvents = getEventsForDay(day, occurrences)
          const dotCount = Math.min(dayEvents.length, 3)

          return (
            <button
              key={i}
              onClick={() => onSelectDate(day)}
              className="flex flex-col items-center py-2 rounded-2xl transition-all"
            >
              <span className="text-xs font-medium text-text-muted mb-1">
                {DAY_NAMES[i]}
              </span>
              <span
                className={`
                  w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold transition-all
                  ${isSelected
                    ? 'bg-primary text-white shadow-md'
                    : isToday
                      ? 'bg-primary/15 text-primary'
                      : 'text-text hover:bg-text/5'
                  }
                `}
              >
                {day.getDate()}
              </span>
              {/* Event dots */}
              <div className="flex gap-0.5 mt-1 h-2">
                {Array.from({ length: dotCount }).map((_, j) => (
                  <div
                    key={j}
                    className={`w-1.5 h-1.5 rounded-full ${
                      isSelected ? 'bg-primary' : 'bg-secondary'
                    }`}
                  />
                ))}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function getDaysOfWeek(weekStart: Date): Date[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart)
    d.setDate(d.getDate() + i)
    return d
  })
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
}

function getEventsForDay(day: Date, occurrences: EventOccurrence[]): EventOccurrence[] {
  return occurrences.filter((occ) => {
    const occDate = new Date(occ.occurrenceStart)
    return isSameDay(occDate, day)
  })
}
