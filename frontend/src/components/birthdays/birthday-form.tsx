import { Input } from '@/components/ui'
import { useId } from 'react'

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

const MAX_DAYS: Record<number, number> = {
  1: 31, 2: 29, 3: 31, 4: 30, 5: 31, 6: 30,
  7: 31, 8: 31, 9: 30, 10: 31, 11: 30, 12: 31,
}

interface BirthdayFormFieldsProps {
  personName: string
  setPersonName: (v: string) => void
  birthMonth: number
  setBirthMonth: (v: number) => void
  birthDay: number
  setBirthDay: (v: number) => void
  birthYearStr: string
  setBirthYearStr: (v: string) => void
  yearError: string | null
  nameRef?: React.Ref<HTMLInputElement>
}

export function BirthdayFormFields({
  personName, setPersonName,
  birthMonth, setBirthMonth,
  birthDay, setBirthDay,
  birthYearStr, setBirthYearStr,
  yearError,
  nameRef,
}: BirthdayFormFieldsProps) {
  const monthId = useId()
  const dayId = useId()

  const handleMonthChange = (m: number) => {
    setBirthMonth(m)
    if (birthDay > MAX_DAYS[m]) setBirthDay(MAX_DAYS[m])
  }

  return (
    <>
      <Input
        ref={nameRef}
        label="Name"
        value={personName}
        onChange={(e) => setPersonName(e.target.value)}
        placeholder="e.g. Grandma, Uncle Bob"
      />

      <div className="flex gap-3">
        <div className="flex-1">
          <label htmlFor={monthId} className="text-sm font-medium text-text-muted mb-1.5 block">Month</label>
          <select
            id={monthId}
            value={birthMonth}
            onChange={(e) => handleMonthChange(Number(e.target.value))}
            className="w-full h-12 px-3 rounded-[var(--radius-input)] border-2 border-text/10 bg-surface text-text text-base focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/30 transition-all"
          >
            {MONTHS.map((m, i) => (
              <option key={i + 1} value={i + 1}>{m}</option>
            ))}
          </select>
        </div>
        <div className="w-[112px]">
          <label htmlFor={dayId} className="text-sm font-medium text-text-muted mb-1.5 block">Day</label>
          <select
            id={dayId}
            value={birthDay}
            onChange={(e) => setBirthDay(Number(e.target.value))}
            className="w-full h-12 px-3 rounded-[var(--radius-input)] border-2 border-text/10 bg-surface text-text text-base focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/30 transition-all"
          >
            {Array.from({ length: MAX_DAYS[birthMonth] }, (_, i) => i + 1).map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </div>
      </div>

      <Input
        label="Year of birth (optional)"
        type="number"
        value={birthYearStr}
        onChange={(e) => setBirthYearStr(e.target.value)}
        placeholder="e.g. 1985"
        error={yearError ?? undefined}
      />
    </>
  )
}
