import type { HouseholdMember } from '@/api/households'
import { Avatar, Card } from '@/components/ui'
import type { EventOccurrence } from '@/utils/recurrence'

interface EventCardProps {
  occurrence: EventOccurrence
  members: HouseholdMember[]
  onClick: () => void
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

export function EventCard({ occurrence, members, onClick }: EventCardProps) {
  const { event, occurrenceStart, occurrenceEnd } = occurrence
  const isRecurring = !!event.recurrence_rule
  const assignee = event.assigned_to
    ? members.find((m) => m.id === event.assigned_to)
    : null

  const borderColor = isRecurring ? 'border-l-secondary' : 'border-l-primary'
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
          <p className="text-sm text-text-muted mt-0.5">
            {formatTime(occurrenceStart)} – {formatTime(occurrenceEnd)}
          </p>
          {isRecurring && (
            <span className="inline-block mt-1.5 px-2 py-0.5 rounded-full bg-secondary/10 text-secondary text-xs font-medium">
              {intervalLabel}
            </span>
          )}
        </div>
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
