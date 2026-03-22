import { motion, AnimatePresence } from 'framer-motion'
import { useRef, useState } from 'react'
import { Button } from '@/components/ui'
import type { BirthdayCreate } from '@/api/birthdays'
import { BirthdayFormFields } from './birthday-form'
import { useScrollLock } from '@/utils/use-scroll-lock'

interface CreateBirthdaySheetProps {
  open: boolean
  onClose: () => void
  onSubmit: (birthday: BirthdayCreate) => void
  isPending: boolean
}

export function CreateBirthdaySheet({ open, onClose, onSubmit, isPending }: CreateBirthdaySheetProps) {
  const nameRef = useRef<HTMLInputElement>(null)
  const [personName, setPersonName] = useState('')
  const [birthMonth, setBirthMonth] = useState(1)
  const [birthDay, setBirthDay] = useState(1)
  const [birthYearStr, setBirthYearStr] = useState('')
  const [yearError, setYearError] = useState<string | null>(null)

  useScrollLock(open)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!personName.trim()) return
    const birthYear = birthYearStr.trim() ? parseInt(birthYearStr.trim(), 10) : null
    if (birthYear !== null && (isNaN(birthYear) || birthYear < 1900 || birthYear > new Date().getFullYear())) {
      setYearError(`Enter a year between 1900 and ${new Date().getFullYear()}`)
      return
    }
    setYearError(null)
    onSubmit({
      person_name: personName.trim(),
      birth_month: birthMonth,
      birth_day: birthDay,
      birth_year: birthYear,
    })
    setPersonName('')
    setBirthMonth(1)
    setBirthDay(1)
    setBirthYearStr('')
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/30 z-40"
            onClick={onClose}
          />
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            onAnimationComplete={(def: { y?: string | number }) => {
              if (def.y === 0) nameRef.current?.focus()
            }}
            className="fixed bottom-0 left-0 right-0 bg-surface rounded-t-3xl p-6 pb-[env(safe-area-inset-bottom)] z-50 max-w-lg mx-auto max-h-[85vh] overflow-y-auto"
          >
            <div className="w-12 h-1.5 bg-text/10 rounded-full mx-auto mb-6" />
            <h2 className="text-xl font-bold text-text mb-4">Add birthday</h2>

            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <BirthdayFormFields
                personName={personName}
                setPersonName={setPersonName}
                birthMonth={birthMonth}
                setBirthMonth={setBirthMonth}
                birthDay={birthDay}
                setBirthDay={setBirthDay}
                birthYearStr={birthYearStr}
                setBirthYearStr={setBirthYearStr}
                yearError={yearError}
                nameRef={nameRef}
              />

              <Button type="submit" disabled={isPending || !personName.trim()}>
                {isPending ? 'Adding...' : 'Add birthday'}
              </Button>
            </form>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
