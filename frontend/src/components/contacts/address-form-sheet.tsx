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
import { draftFrom, draftToPayload, isBlankDraft, PersonDraftFields, type PersonDraft } from './person-draft'
import { errorText, FormError, NotesField, SheetHeader } from './sheet-parts'

interface AddressFormSheetProps {
  open: boolean
  onClose: () => void
  householdId: string
  /** Edit mode when set: only the address fields are saved here. */
  address?: ContactAddress
  /** Prefill read when the sheet opens; in edit mode it overlays the address fields. */
  initialValues?: Partial<AddressCreate>
  /** Called with the saved address after a create or edit. */
  onSaved?: (address: ContactAddress) => void
  /** Edit mode: open the person sheet for a new / existing person. */
  onAddPerson?: () => void
  onEditPerson?: (person: Person) => void
  /** Opened from another sheet (layers above it). */
  stacked?: boolean
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

/** Payloads for every filled-in draft, or all drafts with their errors set. Blank rows are skipped. */
function validateDrafts(drafts: KeyedDraft[]): { payloads: PersonCreate[] } | { invalid: KeyedDraft[] } {
  const results = drafts.filter((d) => !isBlankDraft(d)).map((d) => ({ d, r: draftToPayload(d) }))
  if (results.some(({ r }) => 'invalid' in r)) {
    const fixed = new Map(results.map(({ d, r }) => [d.key, 'invalid' in r ? { ...r.invalid, key: d.key } : d]))
    return { invalid: drafts.map((d) => fixed.get(d.key) ?? d) }
  }
  return { payloads: results.flatMap(({ r }) => ('data' in r ? [r.data] : [])) }
}

export function AddressFormSheet({
  open, onClose, householdId, address, initialValues, onSaved, onAddPerson, onEditPerson, stacked,
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
    setFields(fieldsFrom(address ? { ...address, ...initialValues } : initialValues))
    // A given label (existing or proposed) wins over the one suggested from the people's names.
    setLabelTouched(!!address || !!initialValues?.label)
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
        onSaved?.(await updateAddress.mutateAsync({ id: address.id, data: body }))
      } else {
        const checked = validateDrafts(people)
        if ('invalid' in checked) {
          setPeople(checked.invalid)
          return
        }
        const created = await createAddress.mutateAsync({
          ...body,
          people: checked.payloads,
          move_people: initialValues?.move_people,
        })
        onSaved?.(created)
      }
      onClose()
    } catch (err) {
      setError(errorText(err))
    }
  }

  return (
    <BottomSheet open={open} onClose={onClose} stacked={stacked}>
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
