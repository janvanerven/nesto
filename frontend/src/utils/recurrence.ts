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
      // Try advancing by interval months, retry if the target week overflows
      let attempt = interval
      for (let tries = 0; tries < 12; tries++) {
        const candidate = new Date(current)
        candidate.setMonth(candidate.getMonth() + attempt)
        candidate.setDate(1)
        while (candidate.getDay() !== anchorDayOfWeek) {
          candidate.setDate(candidate.getDate() + 1)
        }
        candidate.setDate(candidate.getDate() + (anchorWeekOfMonth - 1) * 7)
        // Check if we overflowed into the next month
        const expectedMonth = (current.getMonth() + attempt) % 12
        if (candidate.getMonth() === expectedMonth) {
          candidate.setHours(anchor.getHours(), anchor.getMinutes(), anchor.getSeconds())
          return candidate
        }
        // Overflowed — skip to next interval
        attempt += interval
      }
      // Fallback: just advance by interval months on same day-of-month
      next.setMonth(next.getMonth() + interval)
      break
    }

    case 'yearly':
      next.setFullYear(next.getFullYear() + interval)
      break
  }

  return next
}
