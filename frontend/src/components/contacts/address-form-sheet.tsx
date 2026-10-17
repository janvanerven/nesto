import { useEffect, useRef, useState } from 'react'
import { BottomSheet, Button, Input } from '@/components/ui'
import {
  useCreateAddress,
  useUpdateAddress,
  type AddressCreate,
  type ContactAddress,
  type Person,
  type PersonCreate,
} from '@/api/contacts'
import { formatBirthday, suggestLabel } from '@/utils/contacts'
import { useScrollLock } from '@/utils/use-scroll-lock'
import { draftFrom, draftToPayload, PersonDraftFields, type PersonDraft } from './person-draft'
import { errorText, FormError, NotesField, SheetHeader } from './sheet-parts'

interface AddressFormSheetProps {
  open: boolean
  onClose: () => void
  householdId: string
  /** Edit mode when set: only the address fields are saved here. */
  address?: ContactAddress
  /** Create-mode prefill, read when the sheet opens. */
  initialValues?: Partial<AddressCreate>
  onCreated?: (address: ContactAddress) => void
  /** Edit mode: open the person sheet for a new / existing person. */
  onAddPerson?: () => void
  onEditPerson?: (person: Person) => void
}

type AddressFields = Pick<ContactAddress, 'label' | 'street' | 'postcode' | 'city' | 'country' | 'notes'>
type KeyedDraft = PersonDraft & { key: number }

const FIELD_INPUTS: { key: Exclude<keyof AddressFields, 'label' | 'notes'>; label: string; max: number }[] = [
  { key: 'street', label: 'Street & number', max: 200 },
  { key: 'postcode', label: 'Postcode', max: 20 },
  { key: 'city', label: 'City', max: 100 },
  { key: 'country', label: 'Country', max: 100 },
]

function fieldsFrom(v?: Partial<AddressFields>): AddressFields {
  return {
    label: v?.label ?? '',
    street: v?.street ?? '',
    postcode: v?.postcode ?? '',
    city: v?.city ?? '',
    country: v?.country ?? '',
    notes: v?.notes ?? '',
  }
}

/** Payloads for every draft, or the drafts with their year errors set. */
function validateDrafts(drafts: KeyedDraft[]): { payloads: PersonCreate[] } | { invalid: KeyedDraft[] } {
  const results = drafts.map((d) => ({ d, r: draftToPayload(d) }))
  if (results.some(({ r }) => 'invalid' in r)) {
    return { invalid: results.map(({ d, r }) => ('invalid' in r ? { ...r.invalid, key: d.key } : d)) }
  }
  return { payloads: results.flatMap(({ r }) => ('data' in r ? [r.data] : [])) }
}

export function AddressFormSheet({
  open, onClose, householdId, address, initialValues, onCreated, onAddPerson, onEditPerson,
}: AddressFormSheetProps) {
  const createAddress = useCreateAddress(householdId)
  const updateAddress = useUpdateAddress(householdId)
  const [fields, setFields] = useState<AddressFields>(fieldsFrom())
  const [labelTouched, setLabelTouched] = useState(false)
  const [people, setPeople] = useState<KeyedDraft[]>([])
  const [error, setError] = useState<string | null>(null)
  const nextKey = useRef(0)

  useScrollLock(open)

  const keyed = (d: PersonDraft): KeyedDraft => ({ ...d, key: nextKey.current++ })

  useEffect(() => {
    if (!open) return
    setFields(fieldsFrom(address ?? initialValues))
    setLabelTouched(!!address)
    setPeople((initialValues?.people ?? []).map((p) => keyed(draftFrom(p))))
    setError(null)
  }, [open])

  const isEdit = !!address
  const isPending = createAddress.isPending || updateAddress.isPending
  const named = people.filter((p) => p.name.trim())
  const label = labelTouched ? fields.label : suggestLabel(named.map((p) => ({ name: p.name.trim() }))) || fields.label
  const setField = (key: keyof AddressFields) => (e: { target: { value: string } }) =>
    setFields((f) => ({ ...f, [key]: e.target.value }))

  const updatePerson = (key: number) => (fn: (d: PersonDraft) => PersonDraft) =>
    setPeople((ps) => ps.map((p) => (p.key === key ? { ...p, ...fn(p) } : p)))

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    if (!label.trim()) return
    setError(null)
    const body = { ...fields, label: label.trim() }
    try {
      if (address) {
        await updateAddress.mutateAsync({ id: address.id, data: body })
      } else {
        const checked = validateDrafts(named)
        if ('invalid' in checked) {
          setPeople(checked.invalid)
          return
        }
        const created = await createAddress.mutateAsync({
          ...body,
          people: checked.payloads,
          move_people: initialValues?.move_people,
        })
        onCreated?.(created)
      }
      onClose()
    } catch (err) {
      setError(errorText(err))
    }
  }

  return (
    <BottomSheet open={open} onClose={onClose}>
      <SheetHeader title={isEdit ? 'Edit address' : 'New address'} onClose={onClose} />
      <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-4 pb-4">
        <Input
          label="Name on the card"
          value={label}
          maxLength={200}
          onChange={(e) => {
            setLabelTouched(true)
            setFields((f) => ({ ...f, label: e.target.value }))
          }}
          placeholder="e.g. Mark & Lisa Jansen"
        />
        {FIELD_INPUTS.map((f) => (
          <Input key={f.key} label={f.label} value={fields[f.key]} maxLength={f.max} onChange={setField(f.key)} />
        ))}
        <NotesField value={fields.notes} onChange={(v) => setFields((f) => ({ ...f, notes: v }))} />

        <p className="text-xs font-extrabold uppercase tracking-wide text-text-muted pt-2">People</p>
        {address
          ? address.people.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => onEditPerson?.(p)}
                className="text-left rounded-xl bg-text/5 px-4 py-3 font-semibold text-text"
              >
                {p.name}
                {p.birth_month !== null && (
                  <span className="text-sm font-normal text-text-muted"> {'\u{1F382}'} {formatBirthday(p, true)}</span>
                )}
              </button>
            ))
          : people.map((p) => (
              <div key={p.key} className="flex flex-col gap-3 rounded-2xl border-2 border-text/10 p-4">
                <PersonDraftFields draft={p} update={updatePerson(p.key)} />
                <button
                  type="button"
                  onClick={() => setPeople((ps) => ps.filter((x) => x.key !== p.key))}
                  className="self-start text-sm font-semibold text-accent"
                >
                  Remove
                </button>
              </div>
            ))}

        <FormError error={error} />
        <div className="flex gap-3">
          <Button
            type="button"
            variant="ghost"
            disabled={isPending}
            onClick={isEdit ? onAddPerson : () => setPeople((ps) => [...ps, keyed(draftFrom())])}
          >
            + Person
          </Button>
          <Button type="submit" className="flex-1" disabled={isPending || !label.trim()}>
            {isPending ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </form>
    </BottomSheet>
  )
}
