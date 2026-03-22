import { motion, AnimatePresence } from 'framer-motion'
import { useState, useEffect } from 'react'
import { Button } from '@/components/ui'
import type { Birthday, BirthdayUpdate } from '@/api/birthdays'
import { BirthdayFormFields } from './birthday-form'
import { useScrollLock } from '@/utils/use-scroll-lock'

interface EditBirthdaySheetProps {
  birthday: Birthday | null
  open: boolean
  onClose: () => void
  onSubmit: (update: BirthdayUpdate & { birthdayId: string }) => void
  onDelete: (birthdayId: string) => void
  isPending: boolean
}

export function EditBirthdaySheet({ birthday, open, onClose, onSubmit, onDelete, isPending }: EditBirthdaySheetProps) {
  const [personName, setPersonName] = useState('')
  const [birthMonth, setBirthMonth] = useState(1)
  const [birthDay, setBirthDay] = useState(1)
  const [birthYearStr, setBirthYearStr] = useState('')
  const [yearError, setYearError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useScrollLock(open)

  // Reset form when a different birthday is opened, or when sheet closes
  useEffect(() => {
    if (!open) {
      setConfirmDelete(false)
      return
    }
    if (!birthday) return
    setPersonName(birthday.person_name)
    setBirthMonth(birthday.birth_month)
    setBirthDay(birthday.birth_day)
    setBirthYearStr(birthday.birth_year?.toString() ?? '')
    setYearError(null)
    setConfirmDelete(false)
  }, [open, birthday?.id])

  if (!birthday) return null

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault()
    if (!birthday) return
    const birthYear = birthYearStr.trim() ? parseInt(birthYearStr.trim(), 10) : null
    if (birthYear !== null && (isNaN(birthYear) || birthYear < 1900 || birthYear > new Date().getFullYear())) {
      setYearError(`Enter a year between 1900 and ${new Date().getFullYear()}`)
      return
    }
    setYearError(null)
    onSubmit({
      birthdayId: birthday.id,
      person_name: personName.trim(),
      birth_month: birthMonth,
      birth_day: birthDay,
      birth_year: birthYear,
    })
  }

  function handleDeleteClick(): void {
    if (!birthday) return
    if (confirmDelete) {
      onDelete(birthday.id)
    } else {
      setConfirmDelete(true)
    }
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
            className="fixed bottom-0 left-0 right-0 bg-surface rounded-t-3xl p-6 pb-[env(safe-area-inset-bottom)] z-50 max-w-lg mx-auto max-h-[85vh] overflow-y-auto"
          >
            <div className="w-12 h-1.5 bg-text/10 rounded-full mx-auto mb-6" />
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-text">Edit birthday</h2>
              <button
                type="button"
                onClick={onClose}
                className="p-1.5 -mr-1.5 rounded-full text-text-muted hover:bg-text/5 transition-colors"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

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
              />

              <div className="flex gap-3">
                <Button type="submit" disabled={isPending || !personName.trim()} className="flex-1">
                  {isPending ? 'Saving...' : 'Save changes'}
                </Button>
                <Button
                  type="button"
                  variant={confirmDelete ? 'danger' : 'ghost'}
                  onClick={handleDeleteClick}
                  disabled={isPending}
                >
                  {confirmDelete ? 'Confirm' : 'Delete'}
                </Button>
              </div>
            </form>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
