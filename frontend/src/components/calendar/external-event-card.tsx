import { Card } from '@/components/ui'
import type { ExternalEventOccurrence } from '@/api/calendar-sync'

interface ExternalEventCardProps {
  occurrence: ExternalEventOccurrence
  occurrenceStart: Date
  occurrenceEnd: Date
}

export function ExternalEventCard({ occurrence, occurrenceStart, occurrenceEnd }: ExternalEventCardProps) {
  return (
    <Card
      className="relative overflow-hidden border-l-4 opacity-90"
      style={{ borderLeftColor: occurrence.source_calendar_color }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-text">{occurrence.title}</p>
          {occurrence.all_day ? (
            <p className="text-sm text-text-muted mt-0.5">All day</p>
          ) : (
            <p className="text-sm text-text-muted mt-0.5">
              {formatTime(occurrenceStart)} – {formatTime(occurrenceEnd)}
            </p>
          )}
          {occurrence.location && (
            <p className="text-xs text-text-muted mt-0.5 truncate">{occurrence.location}</p>
          )}
        </div>
        <span
          className="shrink-0 mt-0.5 px-2 py-0.5 rounded-full text-xs font-medium bg-text/5 text-text-muted"
        >
          {occurrence.source_calendar_name}
        </span>
      </div>
    </Card>
  )
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit', hour12: false })
}
