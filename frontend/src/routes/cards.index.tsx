import { createFileRoute, Navigate, useNavigate } from '@tanstack/react-router'
import { useAuth } from 'react-oidc-context'
import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useHouseholds } from '@/api/households'
import { useLoyaltyCards, useCreateLoyaltyCard } from '@/api/cards'
import { LoyaltyCardCard } from '@/components/cards/loyalty-card-card'
import { CreateCardSheet } from '@/components/cards/create-card-sheet'
import { Fab, Card } from '@/components/ui'

export const Route = createFileRoute('/cards/')({
  component: CardsPage,
})

function CardsPage() {
  const auth = useAuth()
  const { data: households } = useHouseholds()
  const [showCreate, setShowCreate] = useState(false)

  if (!auth.isAuthenticated) return <Navigate to="/login" />
  if (!households?.length) return <Navigate to="/onboarding" />

  const householdId = households[0].id

  return (
    <CardsContent
      householdId={householdId}
      showCreate={showCreate}
      setShowCreate={setShowCreate}
    />
  )
}

function CardsContent({
  householdId,
  showCreate,
  setShowCreate,
}: {
  householdId: string
  showCreate: boolean
  setShowCreate: (v: boolean) => void
}) {
  const navigate = useNavigate()
  const { data: cards, isLoading } = useLoyaltyCards(householdId)
  const createMutation = useCreateLoyaltyCard(householdId)

  return (
    <div className="pb-4">
      <h1 className="text-2xl font-extrabold text-text mt-2 mb-4">Cards</h1>

      {isLoading ? (
        <div className="grid grid-cols-2 gap-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-36 bg-surface rounded-2xl animate-pulse" />
          ))}
        </div>
      ) : !cards?.length ? (
        <Card className="text-center py-8">
          <p className="text-4xl mb-3">&#128179;</p>
          <p className="font-semibold text-text">No loyalty cards yet</p>
          <p className="text-sm text-text-muted mt-1">Tap + to add your first card.</p>
        </Card>
      ) : (
        <motion.div className="grid grid-cols-2 gap-3">
          <AnimatePresence>
            {cards.map((card, i) => (
              <motion.div
                key={card.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={{ delay: i * 0.05 }}
              >
                <LoyaltyCardCard
                  card={card}
                  onClick={() => navigate({ to: '/cards/$cardId', params: { cardId: card.id } })}
                />
              </motion.div>
            ))}
          </AnimatePresence>
        </motion.div>
      )}

      <Fab pulse={!cards?.length} onClick={() => setShowCreate(true)}>
        +
      </Fab>

      <CreateCardSheet
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onSubmit={async (card) => {
          await createMutation.mutateAsync(card)
          setShowCreate(false)
        }}
        isPending={createMutation.isPending}
      />
    </div>
  )
}
