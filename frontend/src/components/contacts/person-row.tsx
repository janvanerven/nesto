import type { Person } from '@/api/contacts'
import { formatBirthday } from '@/utils/contacts'

/** onEdit makes the name line a button that opens the person for editing. */
export function PersonRow({ person, onEdit }: { person: Person; onEdit?: () => void }) {
  const birthday = formatBirthday(person, true)
  return (
    <div className="py-3 border-t border-text/10 first:border-t-0 first:pt-0 last:pb-0">
      <button
        type="button"
        onClick={onEdit}
        disabled={!onEdit}
        className="w-full flex items-center justify-between gap-3 text-left disabled:cursor-default"
      >
        <span className="font-semibold text-text truncate">{person.name}</span>
        {birthday && (
          <span className="shrink-0 text-sm text-text-muted">
            {'\u{1F382}'} {birthday}
            {person.age !== null && ` (${person.age})`}
          </span>
        )}
      </button>
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
