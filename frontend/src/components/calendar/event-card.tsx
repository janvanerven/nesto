import type { HouseholdMember } from '@/api/households'
import { Avatar, Card } from '@/components/ui'
import type { EventOccurrence } from '@/utils/recurrence'

interface EventCardProps {
  occurrence: EventOccurrence
  members: HouseholdMember[]
  commentCount?: number
  onClick: () => void
  onComments?: () => void
}

const RECURRENCE_LABELS: Record<string, string> = {
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
  yearly: 'Yearly',
}

const RECURRENCE_PLURAL_UNITS: Record<string, string> = {
  daily: 'days',
  weekly: 'weeks',
  monthly: 'months',
  yearly: 'years',
}

export function EventCard({ occurrence, members, commentCount = 0, onClick, onComments }: EventCardProps) {
  const { event, occurrenceStart, occurrenceEnd } = occurrence
  const isRecurring = !!event.recurrence_rule
  const assignee = event.assigned_to
    ? members.find((m) => m.id === event.assigned_to)
    : null

  const borderColor = event.all_day ? 'border-l-accent' : isRecurring ? 'border-l-secondary' : 'border-l-primary'
  const intervalLabel = getIntervalLabel(event.recurrence_rule, event.recurrence_interval)

  return (
    <Card
      interactive
      onClick={onClick}
      className={`relative overflow-hidden border-l-4 ${borderColor}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-text">{event.title}</p>
          {event.all_day ? (
            <p className="text-sm text-text-muted mt-0.5">
              {formatAllDayLabel(occurrenceStart, occurrenceEnd)}
            </p>
          ) : (
            <p className="text-sm text-text-muted mt-0.5">
              {formatTime(occurrenceStart)} – {formatTime(occurrenceEnd)}
            </p>
          )}
          {isRecurring && (
            <span className="inline-block mt-1.5 px-2 py-0.5 rounded-full bg-secondary/10 text-secondary text-xs font-medium">
              {intervalLabel}
            </span>
          )}
        </div>
        {/* Comment button */}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onComments?.() }}
          className="flex items-center gap-1 text-text-muted hover:text-primary transition-colors shrink-0"
          aria-label={`${commentCount} comments`}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
          </svg>
          {commentCount > 0 && (
            <span className="text-xs font-medium text-primary">{commentCount}</span>
          )}
        </button>

        {assignee && (
          <Avatar
            name={assignee.display_name}
            src={assignee.avatar_url}
            size="sm"
          />
        )}
      </div>
    </Card>
  )
}

function formatAllDayLabel(start: Date, end: Date): string {
  const startDay = new Date(start)
  startDay.setHours(0, 0, 0, 0)
  const endDay = new Date(end)
  endDay.setHours(0, 0, 0, 0)

  if (startDay.getTime() === endDay.getTime()) return 'All day'

  const endLabel = end.toLocaleDateString('en', { month: 'short', day: 'numeric' })
  return `All day · ends ${endLabel}`
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit', hour12: false })
}

function getIntervalLabel(rule: string | null, interval: number): string | undefined {
  if (!rule) return undefined
  if (interval > 1) {
    const unit = RECURRENCE_PLURAL_UNITS[rule] ?? rule
    return `Every ${interval} ${unit}`
  }
  return RECURRENCE_LABELS[rule]
}
