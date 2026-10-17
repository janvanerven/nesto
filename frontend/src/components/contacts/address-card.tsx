import { Link } from '@tanstack/react-router'
import { Card } from '@/components/ui'
import type { ContactAddress, Person } from '@/api/contacts'
import { formatBirthday } from '@/utils/contacts'

export function singleLineAddress(a: Pick<ContactAddress, 'street' | 'postcode' | 'city'>): string {
  return [a.street, `${a.postcode} ${a.city}`.trim()].filter((s) => s.trim() !== '').join(', ')
}

export function PersonChip({ person }: { person: Person }) {
  const birthday = formatBirthday(person)
  return (
    <span
      className="px-2.5 py-0.5 rounded-full text-xs font-semibold"
      style={
        birthday
          ? { backgroundColor: 'color-mix(in srgb, var(--color-birthday) 15%, transparent)', color: 'var(--color-birthday)' }
          : { backgroundColor: 'color-mix(in srgb, var(--color-primary) 12%, transparent)', color: 'var(--color-primary)' }
      }
    >
      {person.name}
      {birthday && ` \u{1F382} ${birthday}`}
    </span>
  )
}

export function AddressCard({ address }: { address: ContactAddress }) {
  const line = singleLineAddress(address)
  return (
    <Link to="/contacts/$addressId" params={{ addressId: address.id }} className="block">
      <Card interactive>
        <h3 className="font-bold text-text truncate">{address.label}</h3>
        {line && <p className="text-sm text-text-muted mt-0.5">{line}</p>}
        {address.people.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {address.people.map((p) => (
              <PersonChip key={p.id} person={p} />
            ))}
          </div>
        )}
      </Card>
    </Link>
  )
}
