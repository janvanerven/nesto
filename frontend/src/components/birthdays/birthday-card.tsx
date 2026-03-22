import { Card } from '@/components/ui'
import type { Birthday } from '@/api/birthdays'

interface BirthdayCardProps {
  birthday: Birthday
  onClick: () => void
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

export function BirthdayCard({ birthday, onClick }: BirthdayCardProps) {
  const dateLabel = `${MONTH_NAMES[birthday.birth_month - 1]} ${birthday.birth_day}`

  // age from API is current age. On the birthday itself, it's the age they just turned.
  // "Turns N" = the age they'll turn on their next birthday = age + 1.
  // On the birthday day itself, show "Turns {age} today!" (the age they just turned).
  const today = new Date()
  const isBirthdayToday = today.getMonth() + 1 === birthday.birth_month && today.getDate() === birthday.birth_day
  const turnsLabel = birthday.age !== null
    ? (isBirthdayToday ? `Turns ${birthday.age} today!` : `Turns ${birthday.age + 1}`)
    : null

  return (
    <Card
      interactive
      onClick={onClick}
      className="relative overflow-hidden border-l-4"
      style={{ borderLeftColor: 'var(--color-birthday)' }}
    >
      <div className="flex items-center gap-3">
        <span className="text-2xl shrink-0">{'\u{1F382}'}</span>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-text truncate">{birthday.person_name}</p>
          <p className="text-sm text-text-muted mt-0.5">{dateLabel}</p>
          {turnsLabel && (
            <span
              className="inline-block mt-1.5 px-2 py-0.5 rounded-full text-xs font-medium"
              style={{ backgroundColor: 'color-mix(in srgb, var(--color-birthday) 15%, transparent)', color: 'var(--color-birthday)' }}
            >
              {turnsLabel}
            </span>
          )}
        </div>
        {birthday.age !== null && (
          <span
            className="shrink-0 px-2.5 py-1 rounded-full text-xs font-bold"
            style={{ backgroundColor: 'color-mix(in srgb, var(--color-birthday) 15%, transparent)', color: 'var(--color-birthday)' }}
          >
            {birthday.age}
          </span>
        )}
      </div>
    </Card>
  )
}
