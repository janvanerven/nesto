import { createFileRoute, Navigate } from '@tanstack/react-router'
import { useAuth } from 'react-oidc-context'
import { useMemo, useState } from 'react'
import { useHouseholds } from '@/api/households'
import { useContacts, type Person } from '@/api/contacts'
import { AddressCard, PersonChip } from '@/components/contacts/address-card'
import { AddressFormSheet } from '@/components/contacts/address-form-sheet'
import { PersonSheet } from '@/components/contacts/person-sheet'
import { Fab, Card, Input } from '@/components/ui'
import { matchesContactSearch } from '@/utils/contacts'

export const Route = createFileRoute('/contacts/')({
  component: ContactsPage,
})

function ContactsPage() {
  const auth = useAuth()
  const { data: households } = useHouseholds()

  if (!auth.isAuthenticated) return <Navigate to="/login" />
  if (!households?.length) return <Navigate to="/onboarding" />

  return <ContactsContent householdId={households[0].id} />
}

function ContactsContent({ householdId }: { householdId: string }) {
  const { data, isLoading } = useContacts(householdId)
  const [query, setQuery] = useState('')
  const [adding, setAdding] = useState(false)
  const [personSheet, setPersonSheet] = useState<{ open: boolean; person?: Person }>({ open: false })

  const addresses = useMemo(
    () => (data?.addresses ?? []).filter((a) => matchesContactSearch(query, a, a.people)),
    [data, query],
  )
  const loose = useMemo(
    () => (data?.people_without_address ?? []).filter((p) => matchesContactSearch(query, null, [p])),
    [data, query],
  )
  const isEmpty = !data?.addresses.length && !data?.people_without_address.length

  return (
    <div className="pb-4">
      <h1 className="text-2xl font-extrabold text-text mt-2 mb-4">Contacts</h1>

      <Input
        type="search"
        aria-label="Search contacts"
        placeholder={'Search names, streets, cities…'}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="w-full mb-4"
      />

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-20 bg-surface rounded-[var(--radius-card)] animate-pulse" />
          ))}
        </div>
      ) : isEmpty ? (
        <Card className="text-center py-8">
          <p className="text-4xl mb-3">{'\u{1F4D2}'}</p>
          <p className="font-semibold text-text">No contacts yet</p>
          <p className="text-sm text-text-muted mt-1">Tap + to add your first address.</p>
        </Card>
      ) : !addresses.length && !loose.length ? (
        <p className="text-center text-sm text-text-muted py-8">No contacts match your search.</p>
      ) : (
        <div className="space-y-3">
          {addresses.map((a) => (
            <AddressCard key={a.id} address={a} />
          ))}
          {loose.length > 0 && (
            <>
              <h2 className="text-xs font-extrabold uppercase tracking-wide text-text-muted pt-2 px-1">
                No address yet
              </h2>
              {loose.map((p) => (
                <Card key={p.id} interactive onClick={() => setPersonSheet({ open: true, person: p })}>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <PersonChip person={p} />
                  </div>
                </Card>
              ))}
            </>
          )}
        </div>
      )}

      <Fab pulse={isEmpty && !isLoading} onClick={() => setAdding(true)}>
        +
      </Fab>

      <AddressFormSheet open={adding} onClose={() => setAdding(false)} householdId={householdId} />
      <PersonSheet
        open={personSheet.open}
        onClose={() => setPersonSheet((s) => ({ ...s, open: false }))}
        householdId={householdId}
        person={personSheet.person}
      />
    </div>
  )
}
