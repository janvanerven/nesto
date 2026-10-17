import { BirthdayFormFields, MAX_DAYS } from '@/components/birthdays/birthday-form'
import type { PersonCreate } from '@/api/contacts'

/** Editable name + birthday of one person, shared by the person and address sheets. */
export interface PersonDraft {
  name: string
  hasBirthday: boolean
  month: number
  day: number
  yearStr: string
  yearError: string | null
}

type NameAndBirthday = Pick<PersonCreate, 'name' | 'birth_month' | 'birth_day' | 'birth_year'>

export function draftFrom(v?: Partial<PersonCreate>): PersonDraft {
  const month = v?.birth_month && v.birth_month >= 1 && v.birth_month <= 12 ? v.birth_month : null
  const day = month && v?.birth_day && v.birth_day >= 1 ? Math.min(v.birth_day, MAX_DAYS[month]) : null
  return {
    name: v?.name ?? '',
    hasBirthday: month !== null && day !== null,
    month: month ?? 1,
    day: day ?? 1,
    yearStr: month && day && v?.birth_year != null ? String(v.birth_year) : '',
    yearError: null,
  }
}

/** Validates the draft; returns the payload, or the draft with its year error set. */
export function draftToPayload(d: PersonDraft): { data: NameAndBirthday } | { invalid: PersonDraft } {
  const name = d.name.trim()
  if (!d.hasBirthday) {
    return { data: { name, birth_month: null, birth_day: null, birth_year: null } }
  }
  const yearText = d.yearStr.trim()
  const year = yearText ? Number.parseInt(yearText, 10) : null
  const thisYear = new Date().getFullYear()
  if (year !== null && (Number.isNaN(year) || year < 1900 || year > thisYear)) {
    return { invalid: { ...d, yearError: `Enter a year between 1900 and ${thisYear}` } }
  }
  return { data: { name, birth_month: d.month, birth_day: d.day, birth_year: year } }
}

interface PersonDraftFieldsProps {
  draft: PersonDraft
  /** Functional update, so the month/day pair can change in one tick. */
  update: (fn: (d: PersonDraft) => PersonDraft) => void
}

export function PersonDraftFields({ draft, update }: PersonDraftFieldsProps) {
  const set = <K extends keyof PersonDraft>(key: K) => (value: PersonDraft[K]) =>
    update((d) => ({ ...d, [key]: value }))

  return (
    <>
      <BirthdayFormFields
        personName={draft.name}
        setPersonName={set('name')}
        birthMonth={draft.month}
        setBirthMonth={set('month')}
        birthDay={draft.day}
        setBirthDay={set('day')}
        birthYearStr={draft.yearStr}
        setBirthYearStr={(v) => update((d) => ({ ...d, yearStr: v, yearError: null }))}
        yearError={draft.yearError}
        showDate={draft.hasBirthday}
      />
      <button
        type="button"
        onClick={() => update((d) => ({ ...d, hasBirthday: !d.hasBirthday, yearError: null }))}
        className="self-start text-sm font-semibold text-primary"
      >
        {draft.hasBirthday ? 'Remove birthday' : `+ Birthday \u{1F382}`}
      </button>
    </>
  )
}
