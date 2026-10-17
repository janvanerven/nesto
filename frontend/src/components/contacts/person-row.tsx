import type { Person } from '@/api/contacts'
import { formatBirthday } from '@/utils/contacts'

export function PersonRow({ person }: { person: Person }) {
  const birthday = formatBirthday(person, true)
  return (
    <div className="py-3 border-t border-text/10 first:border-t-0 first:pt-0 last:pb-0">
      <div className="flex items-center justify-between gap-3">
        <p className="font-semibold text-text truncate">{person.name}</p>
        {birthday && (
          <span className="shrink-0 text-sm text-text-muted">
            {'\u{1F382}'} {birthday}
            {person.age !== null && ` (${person.age})`}
          </span>
        )}
      </div>
      {(person.phone || person.email) && (
        <p className="text-sm mt-0.5 break-words">
          {person.phone && (
            <a href={`tel:${person.phone}`} className="text-primary">
              {person.phone}
            </a>
          )}
          {person.phone && person.email && <span className="text-text-muted"> · </span>}
          {person.email && (
            <a href={`mailto:${person.email}`} className="text-primary">
              {person.email}
            </a>
          )}
        </p>
      )}
      {person.notes && (
        <p className="mt-2 rounded-xl bg-accent/10 px-3 py-2 text-sm text-text whitespace-pre-wrap">
          {'\u{1F4DD}'} {person.notes}
        </p>
      )}
    </div>
  )
}
