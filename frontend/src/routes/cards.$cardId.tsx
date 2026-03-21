import { createFileRoute, Navigate, useNavigate } from '@tanstack/react-router'
import { useAuth } from 'react-oidc-context'
import { useState } from 'react'
import { useHouseholds } from '@/api/households'
import { useLoyaltyCards, useUpdateLoyaltyCard, useDeleteLoyaltyCard } from '@/api/cards'
import { BarcodeDisplay } from '@/components/cards/barcode-display'
import { EditCardSheet } from '@/components/cards/edit-card-sheet'
import { Card } from '@/components/ui'
import { textColor } from '@/utils/color'

export const Route = createFileRoute('/cards/$cardId')({
  component: CardDetailPage,
})

function CardDetailPage() {
  const auth = useAuth()
  const { data: households } = useHouseholds()
  const { cardId } = Route.useParams()

  if (!auth.isAuthenticated) return <Navigate to="/login" />
  if (!households?.length) return <Navigate to="/onboarding" />

  const householdId = households[0].id

  return <CardDetailContent householdId={householdId} cardId={cardId} />
}

function CardDetailContent({ householdId, cardId }: { householdId: string; cardId: string }) {
  const navigate = useNavigate()
  const { data: cards, isLoading } = useLoyaltyCards(householdId)
  const card = cards?.find((c) => c.id === cardId) ?? null
  const updateMutation = useUpdateLoyaltyCard(householdId)
  const deleteMutation = useDeleteLoyaltyCard(householdId)
  const [showEdit, setShowEdit] = useState(false)

  if (isLoading) {
    return (
      <div className="pb-4">
        <div className="h-10 bg-surface rounded-xl animate-pulse mt-2 mb-4" />
        <div className="h-64 bg-surface rounded-2xl animate-pulse" />
      </div>
    )
  }

  if (cards && !card) {
    return (
      <div className="pb-4">
        <div className="flex items-center gap-3 mt-2 mb-4">
          <button
            onClick={() => navigate({ to: '/cards' })}
            className="p-1.5 -ml-1.5 rounded-full text-text-muted hover:bg-text/5 transition-colors"
            aria-label="Back to cards"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
          <h1 className="text-2xl font-extrabold text-text">Card not found</h1>
        </div>
        <Card className="text-center py-8">
          <p className="font-semibold text-text">This card no longer exists</p>
          <p className="text-sm text-text-muted mt-1">It may have been deleted.</p>
        </Card>
      </div>
    )
  }

  if (!card) return null

  const fg = textColor(card.color)

  return (
    <div className="pb-4">
      {/* Header */}
      <div className="flex items-center gap-3 mt-2 mb-4">
        <button
          onClick={() => navigate({ to: '/cards' })}
          className="p-1.5 -ml-1.5 rounded-full text-text-muted hover:bg-text/5 transition-colors"
          aria-label="Back to cards"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <h1 className="text-2xl font-extrabold text-text flex-1 truncate">
          {card.store_name}
        </h1>
        <button
          onClick={() => setShowEdit(true)}
          className="p-1.5 -mr-1.5 rounded-full text-text-muted hover:bg-text/5 transition-colors"
          aria-label="Edit card"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
            <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
          </svg>
        </button>
      </div>

      {/* Card with barcode */}
      <div
        className="rounded-2xl p-6 flex flex-col items-center gap-4"
        style={{ backgroundColor: card.color, color: fg }}
      >
        <p className="font-bold text-2xl">{card.store_name}</p>

        <div className="w-full bg-white rounded-xl p-4 text-black">
          <BarcodeDisplay value={card.barcode_number} format={card.barcode_format} height={120} />
        </div>

        <p className="text-sm font-mono opacity-80">{card.barcode_number}</p>
      </div>

      {/* Edit sheet */}
      <EditCardSheet
        card={card}
        open={showEdit}
        onClose={() => setShowEdit(false)}
        onSubmit={async (update) => {
          await updateMutation.mutateAsync(update)
          setShowEdit(false)
        }}
        onDelete={async (id) => {
          await deleteMutation.mutateAsync(id)
          navigate({ to: '/cards' })
        }}
        isPending={updateMutation.isPending || deleteMutation.isPending}
      />
    </div>
  )
}
