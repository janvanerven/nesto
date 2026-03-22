import { Card } from '@/components/ui'
import type { Birthday } from '@/api/birthdays'

interface CalendarBirthdayCardProps {
  birthday: Birthday
  onClick: () => void
}

export function CalendarBirthdayCard({ birthday, onClick }: CalendarBirthdayCardProps) {
  const today = new Date()
  const isToday = today.getMonth() + 1 === birthday.birth_month && today.getDate() === birthday.birth_day

  // On the birthday day, age is the age they just turned.
  // On other days (viewing calendar in future/past), show age + 1 for "next birthday."
  let ageLabel = ''
  if (birthday.age !== null) {
    ageLabel = isToday ? ` (turns ${birthday.age})` : ` (turns ${birthday.age + 1})`
  }

  return (
    <Card
      interactive
      onClick={onClick}
      className="relative overflow-hidden border-l-4"
      style={{ borderLeftColor: 'var(--color-birthday)' }}
    >
      <div className="flex items-center gap-3">
        <span className="text-xl shrink-0">{'\u{1F382}'}</span>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-text">{birthday.person_name}'s Birthday{ageLabel}</p>
          <p className="text-sm text-text-muted mt-0.5">All day</p>
        </div>
      </div>
    </Card>
  )
}
