import { createFileRoute, Link, Navigate, useNavigate } from '@tanstack/react-router'
import { useAuth } from 'react-oidc-context'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useHouseholds } from '@/api/households'
import { useContacts, type Person } from '@/api/contacts'
import { PersonRow } from '@/components/contacts/person-row'
import { AddressFormSheet } from '@/components/contacts/address-form-sheet'
import { PersonSheet } from '@/components/contacts/person-sheet'
import { DeleteAddress } from '@/components/contacts/delete-address'
import { Button, Card } from '@/components/ui'
import { envelopeText, mapUrl } from '@/utils/contacts'

export const Route = createFileRoute('/contacts/$addressId')({
  component: AddressDetailPage,
})

function AddressDetailPage() {
  const auth = useAuth()
  const { data: households } = useHouseholds()
  const { addressId } = Route.useParams()

  if (!auth.isAuthenticated) return <Navigate to="/login" />
  if (!households?.length) return <Navigate to="/onboarding" />

  return <AddressDetailContent householdId={households[0].id} addressId={addressId} />
}

function BackHeader({ title, onBack, action }: { title: string; onBack: () => void; action?: ReactNode }) {
  return (
    <div className="flex items-center gap-3 mt-2 mb-4">
      <button
        onClick={onBack}
        className="p-1.5 -ml-1.5 rounded-full text-text-muted hover:bg-text/5 transition-colors"
        aria-label="Back to contacts"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M15 18l-6-6 6-6" />
        </svg>
      </button>
      <h1 className="text-2xl font-extrabold text-text flex-1 truncate">{title}</h1>
      {action}
    </div>
  )
}

function AddressDetailContent({ householdId, addressId }: { householdId: string; addressId: string }) {
  const navigate = useNavigate()
  const { data, isLoading, isError, refetch } = useContacts(householdId)
  const [editing, setEditing] = useState(false)
  // person undefined = adding a new person to this address
  const [personSheet, setPersonSheet] = useState<{ open: boolean; person?: Person }>({ open: false })
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const resetTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => () => clearTimeout(resetTimer.current), [])

  const address = data?.addresses.find((a) => a.id === addressId) ?? null
  const back = () => void navigate({ to: '/contacts' })

  if (isLoading) {
    return (
      <div className="pb-4">
        <div className="h-10 bg-surface rounded-xl animate-pulse mt-2 mb-4" />
        <div className="h-40 bg-surface rounded-2xl animate-pulse" />
      </div>
    )
  }

  if (isError && !data) {
    return (
      <div className="pb-4">
        <BackHeader title="Contacts" onBack={back} />
        <Card className="text-center py-8">
          <p className="font-semibold text-text">Couldn't load this address</p>
          <Button variant="ghost" size="sm" className="mt-3" onClick={() => void refetch()}>
            Try again
          </Button>
        </Card>
      </div>
    )
  }

  if (!address) {
    if (!data) return null
    return (
      <div className="pb-4">
        <BackHeader title="Address not found" onBack={back} />
        <Card className="text-center py-8">
          <p className="font-semibold text-text">This address no longer exists</p>
          <Link to="/contacts" className="text-sm text-primary mt-1 inline-block">
            Back to contacts
          </Link>
        </Card>
      </div>
    )
  }

  const flash = (state: 'copied' | 'failed') => {
    setCopyState(state)
    clearTimeout(resetTimer.current)
    resetTimer.current = setTimeout(() => setCopyState('idle'), 2000)
  }

  const copyEnvelope = () => {
    // Undefined outside secure contexts (plain HTTP on the LAN)
    const clipboard = navigator.clipboard as Clipboard | undefined
    if (!clipboard) {
      flash('failed')
      return
    }
    void clipboard
      .writeText(envelopeText(address))
      .then(() => flash('copied'))
      .catch(() => flash('failed'))
  }

  const postcodeCity = `${address.postcode} ${address.city}`.trim()

  return (
    <div className="pb-4">
      <BackHeader
        title={address.label}
        onBack={back}
        action={
          <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
            Edit
          </Button>
        }
      />

      <Card className="mb-3">
        <p className="text-xs font-extrabold uppercase tracking-wide text-text-muted">Address</p>
        <div className="mt-1 text-text">
          {address.street && <p>{address.street}</p>}
          {postcodeCity && <p>{postcodeCity}</p>}
          {address.country && <p className="text-text-muted">{address.country}</p>}
        </div>
        <div className="flex gap-2 mt-3">
          <Button variant="ghost" size="sm" onClick={copyEnvelope}>
            {copyState === 'copied' ? 'Copied' : copyState === 'failed' ? "Couldn't copy" : 'Copy for envelope'}
          </Button>
          <a
            href={mapUrl(address)}
            target="_blank"
            rel="noopener noreferrer"
            className="px-4 py-2 text-sm font-semibold rounded-[var(--radius-button)] bg-text/10 text-text hover:bg-text/15 transition-colors"
          >
            Map
          </a>
        </div>
        {address.notes && (
          <p className="mt-3 rounded-xl bg-accent/10 px-3 py-2 text-sm text-text whitespace-pre-wrap">
            {'\u{1F4DD}'} {address.notes}
          </p>
        )}
      </Card>

      <Card>
        <p className="text-xs font-extrabold uppercase tracking-wide text-text-muted mb-3">Living here</p>
        {address.people.length ? (
          address.people.map((p) => (
            <PersonRow key={p.id} person={p} onEdit={() => setPersonSheet({ open: true, person: p })} />
          ))
        ) : (
          <p className="text-sm text-text-muted">Nobody lives here yet.</p>
        )}
        <button
          type="button"
          onClick={() => setPersonSheet({ open: true })}
          className="mt-3 text-sm font-semibold text-primary"
        >
          + Add person
        </button>
      </Card>

      <div className="mt-6">
        <DeleteAddress householdId={householdId} address={address} onDeleted={back} />
      </div>

      <AddressFormSheet
        open={editing}
        onClose={() => setEditing(false)}
        householdId={householdId}
        address={address}
        onAddPerson={() => setPersonSheet({ open: true })}
        onEditPerson={(p) => setPersonSheet({ open: true, person: p })}
      />
      {/* After the address sheet so it stacks on top when opened from it */}
      <PersonSheet
        open={personSheet.open}
        onClose={() => setPersonSheet((s) => ({ ...s, open: false }))}
        householdId={householdId}
        person={personSheet.person}
        defaultAddressId={address.id}
        stacked={editing}
      />
    </div>
  )
}
