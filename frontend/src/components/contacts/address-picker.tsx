import { useId, useState } from 'react'
import { createPortal } from 'react-dom'
import { useContacts } from '@/api/contacts'
import { AddressFormSheet } from './address-form-sheet'

const NEW_ADDRESS = '__new__'

interface AddressPickerProps {
  value: string | null
  onChange: (addressId: string | null) => void
  householdId: string
  /** Saved person to move into a new address; "New address…" is offered only when set. */
  personId?: string
  personName?: string
}

export function AddressPicker({ value, onChange, householdId, personId, personName }: AddressPickerProps) {
  const id = useId()
  const { data } = useContacts(householdId)
  const [creating, setCreating] = useState(false)

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-text-muted">
        Add to an address
      </label>
      <select
        id={id}
        value={value ?? ''}
        onChange={(e) => {
          if (e.target.value === NEW_ADDRESS) setCreating(true)
          else onChange(e.target.value || null)
        }}
        className="w-full h-12 px-3 rounded-[var(--radius-input)] border-2 border-text/10 bg-surface text-text text-base focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/30 transition-all"
      >
        <option value="">No address</option>
        {data?.addresses.map((a) => (
          <option key={a.id} value={a.id}>
            {a.label}
          </option>
        ))}
        {personId && <option value={NEW_ADDRESS}>New address…</option>}
      </select>

      {/* Portal: the picker sits inside a transformed sheet, which would trap a fixed-position sheet. */}
      {personId &&
        createPortal(
          <AddressFormSheet
            open={creating}
            onClose={() => setCreating(false)}
            householdId={householdId}
            initialValues={{ label: personName, move_people: [personId] }}
            onCreated={(a) => onChange(a.id)}
          />,
          document.body,
        )}
    </div>
  )
}
