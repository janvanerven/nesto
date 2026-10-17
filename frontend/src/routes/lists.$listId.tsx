import { createFileRoute, Navigate, useNavigate } from '@tanstack/react-router'
import { useAuth } from 'react-oidc-context'
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useHouseholds, useHouseholdMembers } from '@/api/households'
import {
  useShoppingLists,
  useShoppingItems,
  useCreateShoppingItem,
  useUpdateShoppingItem,
  useDeleteShoppingItem,
  useUpdateShoppingList,
  useDeleteShoppingList,
  useCompleteShoppingList,
  useRecipes,
  useDeleteRecipe,
} from '@/api/lists'
import type { ShoppingItem } from '@/api/lists'
import { useAiSettings } from '@/api/assistant'
import { EditListSheet } from '@/components/lists/edit-list-sheet'
import { SuggestionsSheet } from '@/components/lists/suggestions-sheet'
import { AddRecipeSheet } from '@/components/lists/add-recipe-sheet'
import { RecipeGroup } from '@/components/lists/recipe-group'
import { Avatar, Button, Card } from '@/components/ui'

export const Route = createFileRoute('/lists/$listId')({
  component: ListDetailPage,
  validateSearch: (search: Record<string, unknown>): { suggest?: 1 } =>
    search.suggest === 1 || search.suggest === '1' ? { suggest: 1 } : {},
})

function ListDetailPage() {
  const auth = useAuth()
  const { data: households } = useHouseholds()
  const { listId } = Route.useParams()
  const { suggest } = Route.useSearch()

  if (!auth.isAuthenticated) return <Navigate to="/login" />
  if (!households?.length) return <Navigate to="/onboarding" />

  const householdId = households[0].id

  return <ListDetailContent householdId={householdId} listId={listId} openSuggest={suggest === 1} />
}

function ListDetailContent({
  householdId,
  listId,
  openSuggest,
}: {
  householdId: string
  listId: string
  openSuggest: boolean
}) {
  const navigate = useNavigate()
  const { data: lists, isLoading: isLoadingLists } = useShoppingLists(householdId)
  const list = lists?.find((l) => l.id === listId) ?? null
  const { data: items, isLoading } = useShoppingItems(householdId, listId)
  const { data: members = [] } = useHouseholdMembers(householdId)

  const createItemMutation = useCreateShoppingItem(householdId, listId)
  const updateItemMutation = useUpdateShoppingItem(householdId, listId)
  const deleteItemMutation = useDeleteShoppingItem(householdId, listId)
  const updateListMutation = useUpdateShoppingList(householdId)
  const deleteListMutation = useDeleteShoppingList(householdId)
  const completeListMutation = useCompleteShoppingList(householdId)
  const { data: recipes = [] } = useRecipes(householdId, listId)
  const deleteRecipeMutation = useDeleteRecipe(householdId, listId)
  const aiEnabled = useAiSettings(householdId).data?.has_key ?? false

  const [newItemName, setNewItemName] = useState('')
  const [showEdit, setShowEdit] = useState(false)
  const [confirmComplete, setConfirmComplete] = useState(false)
  const [confirmDeleteItem, setConfirmDeleteItem] = useState<string | null>(null)
  const [showSuggest, setShowSuggest] = useState(openSuggest)
  const [showRecipe, setShowRecipe] = useState(false)

  // Open suggestions once for ?suggest=1, then clear the param so back/refresh don't reopen it.
  useEffect(() => {
    if (!openSuggest) return
    setShowSuggest(true)
    navigate({ to: '/lists/$listId', params: { listId }, search: {}, replace: true })
  }, [openSuggest, listId, navigate])

  // Handle loading and not-found states for the list itself
  if (isLoadingLists) {
    return (
      <div className="pb-4">
        <div className="h-10 bg-surface rounded-xl animate-pulse mt-2 mb-4" />
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-14 bg-surface rounded-[var(--radius-card)] animate-pulse" />
          ))}
        </div>
      </div>
    )
  }

  if (lists && !list) {
    return (
      <div className="pb-4">
        <div className="flex items-center gap-3 mt-2 mb-4">
          <button
            onClick={() => navigate({ to: '/lists' })}
            className="p-1.5 -ml-1.5 rounded-full text-text-muted hover:bg-text/5 transition-colors"
            aria-label="Back to lists"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
          <h1 className="text-2xl font-extrabold text-text">List not found</h1>
        </div>
        <Card className="text-center py-8">
          <p className="font-semibold text-text">This list no longer exists</p>
          <p className="text-sm text-text-muted mt-1">It may have been deleted.</p>
        </Card>
      </div>
    )
  }

  function handleAddItem(e: React.FormEvent) {
    e.preventDefault()
    if (!newItemName.trim()) return
    createItemMutation.mutate({ name: newItemName.trim() })
    setNewItemName('')
  }

  async function handleComplete() {
    if (!confirmComplete) {
      setConfirmComplete(true)
      return
    }
    try {
      await completeListMutation.mutateAsync(listId)
      navigate({ to: '/lists' })
    } catch {
      setConfirmComplete(false)
    }
  }

  async function handleReopen() {
    try {
      await updateListMutation.mutateAsync({ listId, status: 'active' })
    } catch {
      // mutation error state handles UI
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteListMutation.mutateAsync(id)
      navigate({ to: '/lists' })
    } catch {
      // mutation error state handles UI
    }
  }

  function renderItem(item: ShoppingItem): ReactNode {
    return (
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
              aria-label={item.checked ? 'Uncheck item' : 'Check item'}
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

            {/* Added by */}
            {(() => {
              const adder = item.added_by ? members.find((m) => m.id === item.added_by) : null
              return adder ? (
                <Avatar name={adder.display_name} src={adder.avatar_url} size="xs" />
              ) : null
            })()}

            {/* Delete */}
            <button
              onClick={() => {
                if (confirmDeleteItem === item.id) {
                  deleteItemMutation.mutate(item.id)
                  setConfirmDeleteItem(null)
                } else {
                  setConfirmDeleteItem(item.id)
                }
              }}
              aria-label="Delete item"
              className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 transition-all ${
                confirmDeleteItem === item.id ? 'text-accent bg-accent/10' : 'text-text-muted hover:text-accent hover:bg-accent/10'
              }`}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 6h18" /><path d="M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2" /><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
              </svg>
            </button>
          </div>
        </Card>
      </motion.div>
    )
  }

  const recipeIds = new Set(recipes.map((r) => r.id))
  const ungrouped = (items ?? []).filter((i) => !i.recipe_id || !recipeIds.has(i.recipe_id))
  const isGroceries = list?.kind === 'groceries'
  const isActive = list?.status === 'active'

  return (
    <div className="pb-4">
      {/* Header */}
      <div className="flex items-center gap-3 mt-2 mb-4">
        <button
          onClick={() => navigate({ to: '/lists' })}
          className="p-1.5 -ml-1.5 rounded-full text-text-muted hover:bg-text/5 transition-colors"
          aria-label="Back to lists"
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
          aria-label="Edit list"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
            <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
          </svg>
        </button>
      </div>

      {/* Progress bar */}
      {items && items.length > 0 && (
        <div className="mb-4">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs text-text-muted font-medium">
              {items.filter((i) => i.checked).length} of {items.length} items
            </span>
            <span className="text-xs text-text-muted">
              {Math.round((items.filter((i) => i.checked).length / items.length) * 100)}%
            </span>
          </div>
          <div className="w-full h-2 bg-text/10 rounded-full overflow-hidden">
            <div
              className="h-full bg-success rounded-full transition-all duration-300"
              style={{ width: `${(items.filter((i) => i.checked).length / items.length) * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* Grocery helpers */}
      {isGroceries && isActive && (
        <div className="flex gap-2 mb-4">
          {items && items.length === 0 && (
            <Button variant="ghost" onClick={() => setShowSuggest(true)} className="flex-1">
              Suggest items
            </Button>
          )}
          <Button variant="ghost" onClick={() => setShowRecipe(true)} className="flex-1">
            Add recipe
          </Button>
        </div>
      )}

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
          <p className="text-sm text-text-muted mt-1">Add items using the form below.</p>
        </Card>
      ) : (
        <>
          {ungrouped.length > 0 && (
            <motion.div className="space-y-2">
              <AnimatePresence>{ungrouped.map((item) => renderItem(item))}</AnimatePresence>
            </motion.div>
          )}
          {recipes.map((recipe) => {
            const groupItems = items.filter((i) => i.recipe_id === recipe.id)
            if (!groupItems.length) return null
            return (
              <RecipeGroup
                key={recipe.id}
                recipe={recipe}
                onDelete={(recipeId, removeItems) =>
                  deleteRecipeMutation.mutate({ recipeId, removeItems })
                }
                isPending={deleteRecipeMutation.isPending}
              >
                <AnimatePresence>{groupItems.map((item) => renderItem(item))}</AnimatePresence>
              </RecipeGroup>
            )
          })}
        </>
      )}

      {/* Add item form */}
      {list?.status === 'active' && (
        <form onSubmit={handleAddItem} className="flex gap-2 mt-4">
          <input
            type="text"
            value={newItemName}
            onChange={(e) => setNewItemName(e.target.value)}
            placeholder="Add item..."
            className="flex-1 px-4 py-2.5 rounded-xl border-2 border-text/10 bg-surface text-text placeholder:text-text-muted/50 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all duration-200 text-base"
          />
          <button
            type="submit"
            disabled={!newItemName.trim() || createItemMutation.isPending}
            className="px-4 py-2.5 rounded-xl bg-primary text-white font-medium text-sm disabled:opacity-50 transition-all"
          >
            Add
          </button>
        </form>
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

      {isGroceries && (
        <>
          <SuggestionsSheet
            open={showSuggest}
            onClose={() => setShowSuggest(false)}
            householdId={householdId}
            listId={listId}
          />
          <AddRecipeSheet
            open={showRecipe}
            onClose={() => setShowRecipe(false)}
            householdId={householdId}
            listId={listId}
            aiEnabled={aiEnabled}
          />
        </>
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
