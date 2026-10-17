import type { Proposal, ProposalType } from '@/api/assistant'
import {
  useContacts,
  useCreateAddress,
  useCreatePerson,
  useUpdateAddress,
  useUpdatePerson,
  type AddressCreate,
  type ContactAddress,
  type Person,
  type PersonCreate,
  type PersonUpdate,
  type AddressUpdate,
} from '@/api/contacts'
import { AddressFormSheet } from '@/components/contacts/address-form-sheet'
import { PersonSheet } from '@/components/contacts/person-sheet'
import { findPerson } from '@/utils/contacts'

type Payload = Record<string, unknown>
type ContactProposalType = Extract<ProposalType, 'address' | 'person' | 'person_update' | 'address_update'>

const CONTACT_TYPES: readonly ProposalType[] = ['address', 'person', 'person_update', 'address_update']

export function isContactProposal(type: ProposalType): type is ContactProposalType {
  return CONTACT_TYPES.includes(type)
}

/** The address a saved contact belongs to (null: no address), for the card's "View" link. */
function addressIdOf(saved: ContactAddress | Person): string | null {
  return 'address_id' in saved ? saved.address_id : saved.id
}

/**
 * Save and edit support for contact proposals. Updates target an existing record; when it is
 * no longer in the contacts (or they are still loading) Edit is unavailable and Save surfaces the API error.
 */
export function useContactProposal(householdId: string, proposal: Proposal) {
  const createAddress = useCreateAddress(householdId)
  const updateAddress = useUpdateAddress(householdId)
  const createPerson = useCreatePerson(householdId)
  const updatePerson = useUpdatePerson(householdId)
  const { data: contacts } = useContacts(householdId)

  const targetId = proposal.target_id ?? ''
  let target: Person | ContactAddress | undefined
  if (contacts && proposal.type === 'person_update') target = findPerson(contacts, targetId)
  if (contacts && proposal.type === 'address_update') target = contacts.addresses.find((a) => a.id === targetId)
  const isUpdate = proposal.type === 'person_update' || proposal.type === 'address_update'

  /** Resolves to the address id to link to once saved. */
  async function save(data: Payload): Promise<string | null> {
    if (isUpdate && !targetId) throw new Error('This proposal has no contact')
    switch (proposal.type) {
      case 'address':
        return addressIdOf(await createAddress.mutateAsync(data as unknown as AddressCreate))
      case 'person':
        return addressIdOf(await createPerson.mutateAsync(data as unknown as PersonCreate))
      case 'person_update':
        return addressIdOf(await updatePerson.mutateAsync({ id: targetId, data: data as PersonUpdate }))
      case 'address_update':
        return addressIdOf(await updateAddress.mutateAsync({ id: targetId, data: data as AddressUpdate }))
      default:
        throw new Error(`Not a contact proposal: ${proposal.type}`)
    }
  }

  return { save, target, canEdit: !isUpdate || target !== undefined }
}

interface ContactEditSheetProps {
  type: ContactProposalType
  householdId: string
  /** The existing record for update proposals. */
  target: Person | ContactAddress | undefined
  open: boolean
  payload: Payload
  onClose: () => void
  onSaved: (addressId: string | null) => void
}

/** The contact sheet for a proposal, pre-filled with its payload (overlaid on the existing record for updates). */
export function ContactEditSheet({ type, householdId, target, open, payload, onClose, onSaved }: ContactEditSheetProps) {
  const common = { open, onClose, householdId }
  if (type === 'address' || type === 'address_update') {
    return (
      <AddressFormSheet
        {...common}
        initialValues={payload as Partial<AddressCreate>}
        address={target as ContactAddress | undefined}
        onSaved={(a) => onSaved(addressIdOf(a))}
      />
    )
  }
  return (
    <PersonSheet
      {...common}
      initialValues={payload as Partial<PersonCreate>}
      person={target as Person | undefined}
      hideRecordActions
      onSaved={(p) => onSaved(addressIdOf(p))}
    />
  )
}
