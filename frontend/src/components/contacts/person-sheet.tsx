import { useEffect, useId, useState } from 'react'
import { BottomSheet, Button, Input } from '@/components/ui'
import {
  useCreatePerson,
  useDeletePerson,
  useUpdatePerson,
  type Person,
  type PersonCreate,
} from '@/api/contacts'
import { useScrollLock } from '@/utils/use-scroll-lock'
import { AddressPicker } from './address-picker'
import { draftFrom, draftToPayload, PersonDraftFields, type PersonDraft } from './person-draft'
import { errorText, FormError, NotesField, SheetHeader } from './sheet-parts'

interface PersonSheetProps {
  open: boolean
  onClose: () => void
  householdId: string
  /** Edit mode when set. */
  person?: Person
  /** Prefill read when the sheet opens; in edit mode it overlays the person's values. */
  initialValues?: Partial<PersonCreate>
  defaultAddressId?: string
  /** Called with the saved person after a create or edit (not after delete / remove). */
  onSaved?: (person: Person) => void
  /** Opened from another sheet (layers above it). */
  stacked?: boolean
}

interface ContactFields {
  phone: string
  email: string
  notes: string
  addressId: string | null
}

export function PersonSheet({
  open, onClose, householdId, person, initialValues, defaultAddressId, onSaved, stacked,
}: PersonSheetProps) {
  const createPerson = useCreatePerson(householdId)
  const updatePerson = useUpdatePerson(householdId)
  const deletePerson = useDeletePerson(householdId)
  const [draft, setDraft] = useState<PersonDraft>(draftFrom())
  const [fields, setFields] = useState<ContactFields>({ phone: '', email: '', notes: '', addressId: null })
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const formId = useId()

  useScrollLock(open)

  useEffect(() => {
    if (!open) return
    const src = person ? { ...person, ...initialValues } : initialValues
    setDraft(draftFrom(src))
    setFields({
      phone: src?.phone ?? '',
      email: src?.email ?? '',
      notes: src?.notes ?? '',
      addressId: src?.address_id ?? defaultAddressId ?? null,
    })
    setConfirmDelete(false)
    setError(null)
  }, [open, person?.id])

  const isPending = createPerson.isPending || updatePerson.isPending || deletePerson.isPending
  // Only people who aren't living somewhere get the picker; others use "Remove from address".
  const showPicker = person ? !person.address_id : !defaultAddressId
  const set = (key: keyof ContactFields) => (v: string | null) => setFields((f) => ({ ...f, [key]: v }))

  async function run(action: () => Promise<unknown>): Promise<void> {
    setError(null)
    try {
      await action()
      onClose()
    } catch (err) {
      setError(errorText(err))
    }
  }

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault()
    const checked = draftToPayload(draft)
    if ('invalid' in checked) {
      setDraft(checked.invalid)
      return
    }
    const data = {
      ...checked.data,
      phone: fields.phone.trim(),
      email: fields.email.trim(),
      notes: fields.notes,
      address_id: fields.addressId,
    }
    void run(async () => {
      const saved = await (person ? updatePerson.mutateAsync({ id: person.id, data }) : createPerson.mutateAsync(data))
      onSaved?.(saved)
    })
  }

  function handleDelete(): void {
    if (!person) return
    if (!confirmDelete) {
      setConfirmDelete(true)
      return
    }
    void run(() => deletePerson.mutateAsync(person.id))
  }

  return (
    <BottomSheet open={open} onClose={onClose} stacked={stacked}>
      <SheetHeader title={person ? 'Edit person' : 'Add person'} onClose={onClose} />
      {/* The picker can open another sheet with its own form, so it stays outside this one. */}
      <div className="flex flex-col gap-4 pb-4">
        <form id={formId} onSubmit={handleSubmit} className="flex flex-col gap-4">
          <PersonDraftFields draft={draft} update={setDraft} />
          <Input label="Phone" type="tel" value={fields.phone} maxLength={50} onChange={(e) => set('phone')(e.target.value)} />
          <Input label="Email" type="email" value={fields.email} maxLength={254} onChange={(e) => set('email')(e.target.value)} />
          <NotesField value={fields.notes} onChange={set('notes')} />
        </form>
        {showPicker && (
          <AddressPicker
            value={fields.addressId}
            onChange={set('addressId')}
            householdId={householdId}
            personId={person?.id}
            personName={person?.name}
          />
        )}

        <FormError error={error} />
        <Button type="submit" form={formId} disabled={isPending || !draft.name.trim()}>
          {isPending ? 'Saving…' : 'Save'}
        </Button>

        {person && (
          <div className="flex flex-wrap gap-3">
            {person.address_id && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={isPending}
                onClick={() => void run(() => updatePerson.mutateAsync({ id: person.id, data: { address_id: null } }))}
              >
                Remove from address
              </Button>
            )}
            <Button
              type="button"
              variant={confirmDelete ? 'danger' : 'ghost'}
              size="sm"
              disabled={isPending}
              onClick={handleDelete}
            >
              {confirmDelete ? `Delete ${person.name}?` : 'Delete contact'}
            </Button>
          </div>
        )}
      </div>
    </BottomSheet>
  )
}
