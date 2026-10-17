import type { ContactAddress, Person } from '@/api/contacts'

type AddressText = Pick<ContactAddress, 'label' | 'street' | 'postcode' | 'city' | 'country'>

export function normalizeForSearch(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

export function matchesContactSearch(
  query: string,
  address: AddressText | null,
  people: Pick<Person, 'name'>[],
): boolean {
  const q = normalizeForSearch(query.trim())
  if (!q) return true
  const haystack = [
    address?.label,
    address?.street,
    address?.city,
    address?.postcode,
    ...people.map((p) => p.name),
  ]
  return haystack.some((v) => !!v && normalizeForSearch(v).includes(q))
}

function postcodeCity(a: Pick<AddressText, 'postcode' | 'city'>): string {
  return `${a.postcode} ${a.city}`.trim()
}

export function envelopeText(a: AddressText): string {
  return [a.label, a.street, postcodeCity(a), a.country].filter((l) => l.trim() !== '').join('\n')
}

export function mapUrl(a: Omit<AddressText, 'label'>): string {
  const query = [a.street, postcodeCity(a), a.country].filter((l) => l.trim() !== '').join(', ')
  return `https://maps.apple.com/?q=${encodeURIComponent(query)}`
}

export function suggestLabel(people: { name: string }[]): string {
  const names = people.map((p) => p.name)
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} & ${names[names.length - 1]}`
}
