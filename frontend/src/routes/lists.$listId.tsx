import { createFileRoute, Navigate, useNavigate } from '@tanstack/react-router'
import { useAuth } from 'react-oidc-context'
import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useHouseholds } from '@/api/households'
import {
  useShoppingLists,
  useShoppingItems,
  useCreateShoppingItem,
  useUpdateShoppingItem,
  useDeleteShoppingItem,
  useUpdateShoppingList,
  useDeleteShoppingList,
  useCompleteShoppingList,
} from '@/api/lists'
import { EditListSheet } from '@/components/lists/edit-list-sheet'
import { Button, Card } from '@/components/ui'

export const Route = createFileRoute('/lists/$listId')({
  component: ListDetailPage,
})

function ListDetailPage() {
  const auth = useAuth()
  const { data: households } = useHouseholds()
  const { listId } = Route.useParams()

  if (!auth.isAuthenticated) return <Navigate to="/login" />
  if (!households?.length) return <Navigate to="/onboarding" />

  const householdId = households[0].id

  return <ListDetailContent householdId={householdId} listId={listId} />
}

function ListDetailContent({ householdId, listId }: { householdId: string; listId: string }) {
  const navigate = useNavigate()
  const { data: lists } = useShoppingLists(householdId)
  const list = lists?.find((l) => l.id === listId) ?? null
  const { data: items, isLoading } = useShoppingItems(householdId, listId)

  const createItemMutation = useCreateShoppingItem(householdId, listId)
  const updateItemMutation = useUpdateShoppingItem(householdId, listId)
  const deleteItemMutation = useDeleteShoppingItem(householdId, listId)
  const updateListMutation = useUpdateShoppingList(householdId)
  const deleteListMutation = useDeleteShoppingList(householdId)
  const completeListMutation = useCompleteShoppingList(householdId)

  const [newItemName, setNewItemName] = useState('')
  const [newItemQty, setNewItemQty] = useState('')
  const [showEdit, setShowEdit] = useState(false)
  const [confirmComplete, setConfirmComplete] = useState(false)

  function handleAddItem(e: React.FormEvent) {
    e.preventDefault()
    if (!newItemName.trim()) return
    createItemMutation.mutate({ name: newItemName.trim(), quantity: newItemQty.trim() || undefined })
    setNewItemName('')
    setNewItemQty('')
  }

  async function handleComplete() {
    if (!confirmComplete) {
      setConfirmComplete(true)
      return
    }
    await completeListMutation.mutateAsync(listId)
    navigate({ to: '/lists' })
  }

  async function handleReopen() {
    await updateListMutation.mutateAsync({ listId, status: 'active' })
  }

  async function handleDelete(id: string) {
    await deleteListMutation.mutateAsync(id)
    navigate({ to: '/lists' })
  }

  return (
    <div className="pb-4">
      {/* Header */}
      <div className="flex items-center gap-3 mt-2 mb-4">
        <button
          onClick={() => navigate({ to: '/lists' })}
          className="p-1.5 -ml-1.5 rounded-full text-text-muted hover:bg-text/5 transition-colors"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <h1 className="text-2xl font-extrabold text-text flex-1 truncate">
          {list?.name || 'Untitled list'}
        </h1>
        <button
          onClick={() => setShowEdit(true)}
          className="p-1.5 -mr-1.5 rounded-full text-text-muted hover:bg-text/5 transition-colors"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
            <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
          </svg>
        </button>
      </div>

      {/* Add item form */}
      <form onSubmit={handleAddItem} className="flex gap-2 mb-4">
        <input
          type="text"
          value={newItemName}
          onChange={(e) => setNewItemName(e.target.value)}
          placeholder="Add item..."
          className="flex-1 px-4 py-2.5 rounded-xl border-2 border-text/10 bg-surface text-text placeholder:text-text-muted/50 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all duration-200 text-sm"
        />
        <input
          type="text"
          value={newItemQty}
          onChange={(e) => setNewItemQty(e.target.value)}
          placeholder="Qty"
          className="w-20 px-3 py-2.5 rounded-xl border-2 border-text/10 bg-surface text-text placeholder:text-text-muted/50 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all duration-200 text-sm text-center"
        />
        <button
          type="submit"
          disabled={!newItemName.trim() || createItemMutation.isPending}
          className="px-4 py-2.5 rounded-xl bg-primary text-white font-medium text-sm disabled:opacity-50 transition-all"
        >
          Add
        </button>
      </form>

      {/* Items */}
      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-14 bg-surface rounded-[var(--radius-card)] animate-pulse" />
          ))}
        </div>
      ) : !items?.length ? (
        <Card className="text-center py-8">
          <p className="text-4xl mb-3">&#128722;</p>
          <p className="font-semibold text-text">No items yet</p>
          <p className="text-sm text-text-muted mt-1">Add items using the form above.</p>
        </Card>
      ) : (
        <motion.div className="space-y-2">
          <AnimatePresence>
            {items.map((item) => (
              <motion.div
                key={item.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, x: -200 }}
                layout
              >
                <Card className={item.checked ? 'opacity-60' : ''}>
                  <div className="flex items-center gap-3">
                    {/* Checkbox */}
                    <button
                      onClick={() =>
                        updateItemMutation.mutate({ itemId: item.id, checked: !item.checked })
                      }
                      className={`
                        w-7 h-7 rounded-full border-2 flex items-center justify-center shrink-0 transition-all
                        ${item.checked
                          ? 'bg-success border-success text-white'
                          : 'border-text/20 hover:border-success hover:bg-success/10'
                        }
                      `}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M20 6L9 17l-5-5" />
                      </svg>
                    </button>

                    {/* Item content */}
                    <div className="flex-1 min-w-0">
                      <p className={`font-medium text-text text-sm ${item.checked ? 'line-through text-text-muted' : ''}`}>
                        {item.name}
                      </p>
                      {item.quantity && (
                        <p className="text-xs text-text-muted">{item.quantity}</p>
                      )}
                    </div>

                    {/* Delete */}
                    <button
                      onClick={() => deleteItemMutation.mutate(item.id)}
                      className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-text-muted hover:text-accent hover:bg-accent/10 transition-all"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M3 6h18" /><path d="M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2" /><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
                      </svg>
                    </button>
                  </div>
                </Card>
              </motion.div>
            ))}
          </AnimatePresence>
        </motion.div>
      )}

      {/* Complete / Reopen list button */}
      {items && items.length > 0 && list?.status === 'active' && (
        <div className="mt-6">
          <Button
            onClick={handleComplete}
            variant={confirmComplete ? 'danger' : 'primary'}
            disabled={completeListMutation.isPending}
            className="w-full"
          >
            {completeListMutation.isPending
              ? 'Completing...'
              : confirmComplete
                ? 'Tap again to confirm'
                : 'Complete list'}
          </Button>
        </div>
      )}
      {list?.status === 'archived' && (
        <div className="mt-6">
          <Button
            onClick={handleReopen}
            variant="ghost"
            disabled={updateListMutation.isPending}
            className="w-full"
          >
            {updateListMutation.isPending ? 'Reopening...' : 'Reopen list'}
          </Button>
        </div>
      )}

      {/* Edit sheet */}
      <EditListSheet
        list={list}
        open={showEdit}
        onClose={() => setShowEdit(false)}
        onSubmit={async (update) => {
          await updateListMutation.mutateAsync(update)
          setShowEdit(false)
        }}
        onDelete={handleDelete}
        isPending={updateListMutation.isPending || deleteListMutation.isPending}
      />
    </div>
  )
}
