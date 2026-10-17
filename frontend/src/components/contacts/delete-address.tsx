import { useState } from 'react'
import { Button } from '@/components/ui'
import { useDeleteAddress, type ContactAddress } from '@/api/contacts'
import { errorText, FormError } from './sheet-parts'

interface DeleteAddressProps {
  householdId: string
  address: ContactAddress
  onDeleted: () => void
}

/** "Delete address" with a confirm step: keep the people as contacts, or delete them too. */
export function DeleteAddress({ householdId, address, onDeleted }: DeleteAddressProps) {
  const deleteAddress = useDeleteAddress(householdId)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const count = address.people.length
  const pending = deleteAddress.isPending

  async function remove(deletePeople: boolean): Promise<void> {
    setError(null)
    try {
      await deleteAddress.mutateAsync({ id: address.id, deletePeople })
      onDeleted()
    } catch (err) {
      setError(errorText(err))
    }
  }

  if (!confirming) {
    return (
      <Button variant="ghost" size="sm" onClick={() => setConfirming(true)}>
        Delete address
      </Button>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-text">
        Delete {address.label}?
        {count > 0 && ` ${count === 1 ? '1 person lives' : `${count} people live`} here.`}
      </p>
      <div className="flex flex-wrap gap-2">
        {count > 0 ? (
          <>
            <Button variant="ghost" size="sm" disabled={pending} onClick={() => void remove(false)}>
              Keep the {count} {count === 1 ? 'person' : 'people'} as contacts
            </Button>
            <Button variant="danger" size="sm" disabled={pending} onClick={() => void remove(true)}>
              Delete them too
            </Button>
          </>
        ) : (
          <Button variant="danger" size="sm" disabled={pending} onClick={() => void remove(false)}>
            Delete
          </Button>
        )}
        <Button variant="ghost" size="sm" disabled={pending} onClick={() => setConfirming(false)}>
          Cancel
        </Button>
      </div>
      <FormError error={error} />
    </div>
  )
}
