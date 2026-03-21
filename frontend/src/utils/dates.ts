/**
 * Shared date utilities — centralises logic that was previously duplicated
 * across route and component files.
 */

/** Format a Date to a YYYY-MM-DD string using local time. */
export function formatDateISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Return true when two dates fall on the same calendar day. */
export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

/** Quick-pick date options used by task sheets. */
export function getDateOptions(): { label: string; value: string }[] {
  const today = new Date()
  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)
  const nextWeek = new Date(today)
  nextWeek.setDate(nextWeek.getDate() + 7)

  return [
    { label: 'Today', value: formatDateISO(today) },
    { label: 'Tomorrow', value: formatDateISO(tomorrow) },
    { label: 'Next week', value: formatDateISO(nextWeek) },
  ]
}
