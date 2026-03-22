import { createFileRoute, Navigate } from '@tanstack/react-router'
import { useAuth } from 'react-oidc-context'
import { useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useHouseholds } from '@/api/households'
import { useBirthdays, useCreateBirthday, useUpdateBirthday, useDeleteBirthday } from '@/api/birthdays'
import type { Birthday } from '@/api/birthdays'
import { BirthdayCard } from '@/components/birthdays/birthday-card'
import { CreateBirthdaySheet } from '@/components/birthdays/create-birthday-sheet'
import { EditBirthdaySheet } from '@/components/birthdays/edit-birthday-sheet'
import { Fab, Card } from '@/components/ui'

export const Route = createFileRoute('/birthdays/')({
  component: BirthdaysPage,
})

function BirthdaysPage() {
  const auth = useAuth()
  const { data: households } = useHouseholds()
  const [showCreate, setShowCreate] = useState(false)
  const [editBirthday, setEditBirthday] = useState<Birthday | null>(null)

  if (!auth.isAuthenticated) return <Navigate to="/login" />
  if (!households?.length) return <Navigate to="/onboarding" />

  const householdId = households[0].id

  return (
    <BirthdaysContent
      householdId={householdId}
      showCreate={showCreate}
      setShowCreate={setShowCreate}
      editBirthday={editBirthday}
      setEditBirthday={setEditBirthday}
    />
  )
}

/** Exact days until next occurrence of this birthday. */
function daysUntilBirthday(bMonth: number, bDay: number): number {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const year = today.getFullYear()
  let next = new Date(year, bMonth - 1, bDay)
  next.setHours(0, 0, 0, 0)
  if (next < today) next = new Date(year + 1, bMonth - 1, bDay)
  return Math.round((next.getTime() - today.getTime()) / 86_400_000)
}

function sortByUpcoming(birthdays: Birthday[]): Birthday[] {
  return [...birthdays].sort(
    (a, b) =>
      daysUntilBirthday(a.birth_month, a.birth_day) -
      daysUntilBirthday(b.birth_month, b.birth_day),
  )
}

function BirthdaysContent({
  householdId,
  showCreate,
  setShowCreate,
  editBirthday,
  setEditBirthday,
}: {
  householdId: string
  showCreate: boolean
  setShowCreate: (v: boolean) => void
  editBirthday: Birthday | null
  setEditBirthday: (b: Birthday | null) => void
}) {
  const { data: birthdays, isLoading } = useBirthdays(householdId)
  const createMutation = useCreateBirthday(householdId)
  const updateMutation = useUpdateBirthday(householdId)
  const deleteMutation = useDeleteBirthday(householdId)

  const sorted = useMemo(
    () => (birthdays ? sortByUpcoming(birthdays) : []),
    [birthdays],
  )

  return (
    <div className="pb-4">
      <h1 className="text-2xl font-extrabold text-text mt-2 mb-4">Birthdays</h1>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-20 bg-surface rounded-[var(--radius-card)] animate-pulse" />
          ))}
        </div>
      ) : !sorted.length ? (
        <Card className="text-center py-8">
          <p className="text-4xl mb-3">{'\u{1F382}'}</p>
          <p className="font-semibold text-text">No birthdays yet</p>
          <p className="text-sm text-text-muted mt-1">Tap + to add your first birthday.</p>
        </Card>
      ) : (
        <motion.div className="space-y-3">
          <AnimatePresence>
            {sorted.map((birthday, i) => (
              <motion.div
                key={birthday.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ delay: i * 0.05 }}
              >
                <BirthdayCard
                  birthday={birthday}
                  onClick={() => setEditBirthday(birthday)}
                />
              </motion.div>
            ))}
          </AnimatePresence>
        </motion.div>
      )}

      <Fab pulse={!sorted.length} onClick={() => setShowCreate(true)}>
        +
      </Fab>

      <CreateBirthdaySheet
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onSubmit={async (birthday) => {
          await createMutation.mutateAsync(birthday)
          setShowCreate(false)
        }}
        isPending={createMutation.isPending}
      />

      <EditBirthdaySheet
        birthday={editBirthday}
        open={editBirthday !== null}
        onClose={() => setEditBirthday(null)}
        onSubmit={async (update) => {
          await updateMutation.mutateAsync(update)
          setEditBirthday(null)
        }}
        onDelete={async (birthdayId) => {
          await deleteMutation.mutateAsync(birthdayId)
          setEditBirthday(null)
        }}
        isPending={updateMutation.isPending || deleteMutation.isPending}
      />
    </div>
  )
}
