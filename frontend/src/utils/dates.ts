/**
 * Shared date utilities — centralises logic that was previously duplicated
 * across route and component files.
 */

/** Format a Date to a YYYY-MM-DD string using local time. */
export function formatDateISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Add days to a YYYY-MM-DD string, returning YYYY-MM-DD. */
export function addDaysISO(dateISO: string, days: number): string {
  const d = new Date(`${dateISO}T00:00:00`)
  d.setDate(d.getDate() + days)
  return formatDateISO(d)
}

/** Return true when two dates fall on the same calendar day. */
export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

