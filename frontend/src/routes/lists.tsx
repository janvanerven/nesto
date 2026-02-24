import { createFileRoute, Navigate, useNavigate } from '@tanstack/react-router'
import { useAuth } from 'react-oidc-context'
import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useHouseholds } from '@/api/households'
import { useShoppingLists, useCreateShoppingList } from '@/api/lists'
import { ListCard } from '@/components/lists/list-card'
import { CreateListSheet } from '@/components/lists/create-list-sheet'
import { Fab, Card } from '@/components/ui'

export const Route = createFileRoute('/lists')({
  component: ListsPage,
})

function ListsPage() {
  const auth = useAuth()
  const { data: households } = useHouseholds()
  const [showCreate, setShowCreate] = useState(false)
  const [filter, setFilter] = useState<'active' | 'archived'>('active')

  if (!auth.isAuthenticated) return <Navigate to="/login" />
  if (!households?.length) return <Navigate to="/onboarding" />

  const householdId = households[0].id

  return (
    <ListsContent
      householdId={householdId}
      filter={filter}
      setFilter={setFilter}
      showCreate={showCreate}
      setShowCreate={setShowCreate}
    />
  )
}

function ListsContent({
  householdId,
  filter,
  setFilter,
  showCreate,
  setShowCreate,
}: {
  householdId: string
  filter: 'active' | 'archived'
  setFilter: (f: 'active' | 'archived') => void
  showCreate: boolean
  setShowCreate: (v: boolean) => void
}) {
  const navigate = useNavigate()
  const { data: lists, isLoading } = useShoppingLists(householdId, filter)
  const createMutation = useCreateShoppingList(householdId)

  const filters = [
    { key: 'active' as const, label: 'Active' },
    { key: 'archived' as const, label: 'Archived' },
  ]

  return (
    <div className="pb-4">
      <h1 className="text-2xl font-extrabold text-text mt-2 mb-4">Lists</h1>

      {/* Filter tabs */}
      <div className="flex gap-2 mb-4">
        {filters.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`
              px-4 py-2 rounded-full text-sm font-medium transition-all
              ${filter === f.key
                ? 'bg-primary text-white'
                : 'bg-text/5 text-text-muted hover:bg-text/10'
              }
            `}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* List of lists */}
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 bg-surface rounded-[var(--radius-card)] animate-pulse" />
          ))}
        </div>
      ) : !lists?.length ? (
        <Card className="text-center py-8">
          <p className="text-4xl mb-3">&#128203;</p>
          <p className="font-semibold text-text">
            {filter === 'archived' ? 'No archived lists' : 'No lists yet'}
          </p>
          <p className="text-sm text-text-muted mt-1">
            {filter === 'archived' ? 'Completed lists will appear here.' : 'Tap + to create your first list.'}
          </p>
        </Card>
      ) : (
        <motion.div className="space-y-3">
          <AnimatePresence>
            {lists.map((list, i) => (
              <motion.div
                key={list.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, x: -200 }}
                transition={{ delay: i * 0.05 }}
              >
                <ListCard
                  list={list}
                  onClick={() => navigate({ to: '/lists/$listId', params: { listId: list.id } })}
                />
              </motion.div>
            ))}
          </AnimatePresence>
        </motion.div>
      )}

      {/* FAB */}
      <Fab pulse={!lists?.length} onClick={() => setShowCreate(true)}>
        +
      </Fab>

      {/* Create sheet */}
      <CreateListSheet
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onSubmit={async (list) => {
          const newList = await createMutation.mutateAsync(list)
          setShowCreate(false)
          navigate({ to: '/lists/$listId', params: { listId: newList.id } })
        }}
        isPending={createMutation.isPending}
      />
    </div>
  )
}
