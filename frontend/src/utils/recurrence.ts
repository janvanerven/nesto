import type { CalendarEvent } from '@/api/events'

export interface EventOccurrence {
  event: CalendarEvent
  occurrenceStart: Date
  occurrenceEnd: Date
}

export function expandRecurrences(
  events: CalendarEvent[],
  rangeStart: Date,
  rangeEnd: Date,
): EventOccurrence[] {
  const occurrences: EventOccurrence[] = []

  for (const event of events) {
    const start = new Date(event.start_time)
    const end = new Date(event.end_time)
    const durationMs = end.getTime() - start.getTime()

    if (!event.recurrence_rule) {
      if (end >= rangeStart && start <= rangeEnd) {
        occurrences.push({ event, occurrenceStart: start, occurrenceEnd: end })
      }
      continue
    }

    const recEnd = event.recurrence_end ? new Date(event.recurrence_end + 'T23:59:59') : rangeEnd
    const effectiveEnd = recEnd < rangeEnd ? recEnd : rangeEnd
    const interval = event.recurrence_interval || 1

    let cursor = new Date(start)
    let iterations = 0
    const MAX_ITERATIONS = 1000

    while (cursor <= effectiveEnd && iterations < MAX_ITERATIONS) {
      iterations++
      const occEnd = new Date(cursor.getTime() + durationMs)

      if (occEnd >= rangeStart && cursor <= rangeEnd) {
        occurrences.push({
          event,
          occurrenceStart: new Date(cursor),
          occurrenceEnd: occEnd,
        })
      }

      cursor = advanceDate(cursor, event.recurrence_rule, interval, start)
    }
  }

  occurrences.sort((a, b) => a.occurrenceStart.getTime() - b.occurrenceStart.getTime())
  return occurrences
}

function advanceDate(
  current: Date,
  rule: string,
  interval: number,
  anchor: Date,
): Date {
  const next = new Date(current)

  switch (rule) {
    case 'daily':
      next.setDate(next.getDate() + interval)
      break

    case 'weekly':
      next.setDate(next.getDate() + 7 * interval)
      break

    case 'monthly': {
      const anchorWeekOfMonth = Math.ceil(anchor.getDate() / 7)
      const anchorDayOfWeek = anchor.getDay()
      next.setMonth(next.getMonth() + interval)
      next.setDate(1)
      while (next.getDay() !== anchorDayOfWeek) {
        next.setDate(next.getDate() + 1)
      }
      next.setDate(next.getDate() + (anchorWeekOfMonth - 1) * 7)
      if (next.getMonth() !== (current.getMonth() + interval) % 12) {
        return advanceDate(next, rule, interval, anchor)
      }
      next.setHours(anchor.getHours(), anchor.getMinutes(), anchor.getSeconds())
      break
    }

    case 'yearly':
      next.setFullYear(next.getFullYear() + interval)
      break
  }

  return next
}
