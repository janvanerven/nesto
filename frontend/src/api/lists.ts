import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch, hasToken } from './client'

export type ListKind = 'groceries' | 'wishlist' | 'packing' | 'other'

export interface ShoppingList {
  id: string
  household_id: string
  name: string
  priority: number
  status: string
  kind: ListKind
  created_by: string
  created_at: string
  updated_at: string
  item_count: number
  checked_count: number
}

export interface ShoppingListCreate {
  name?: string
  priority?: number
  kind?: ListKind
}

export interface ShoppingListUpdate {
  name?: string
  priority?: number
  status?: 'active' | 'archived'
  kind?: ListKind
}

export interface ShoppingItem {
  id: string
  list_id: string
  name: string
  quantity: string
  checked: boolean
  added_by: string | null
  position: number
  recipe_id: string | null
  created_at: string
}

export interface ShoppingItemCreate {
  name: string
  quantity?: string
}

export interface ShoppingItemUpdate {
  name?: string
  quantity?: string
  checked?: boolean
}

// --- List hooks ---

export function useShoppingLists(householdId: string, status?: string) {
  const params = status ? `?status=${status}` : ''
  return useQuery({
    queryKey: ['lists', householdId, status],
    queryFn: () => apiFetch<ShoppingList[]>(`/households/${householdId}/lists${params}`),
    enabled: !!householdId && hasToken(),
  })
}

export function useCreateShoppingList(householdId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (list: ShoppingListCreate) =>
      apiFetch<ShoppingList>(`/households/${householdId}/lists`, {
        method: 'POST',
        body: JSON.stringify(list),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['lists', householdId] }),
  })
}

export function useUpdateShoppingList(householdId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ listId, ...update }: ShoppingListUpdate & { listId: string }) =>
      apiFetch<ShoppingList>(`/households/${householdId}/lists/${listId}`, {
        method: 'PATCH',
        body: JSON.stringify(update),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['lists', householdId] }),
  })
}

export function useDeleteShoppingList(householdId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (listId: string) =>
      apiFetch<void>(`/households/${householdId}/lists/${listId}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['lists', householdId] }),
  })
}

export function useCompleteShoppingList(householdId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (listId: string) =>
      apiFetch<ShoppingList>(`/households/${householdId}/lists/${listId}/complete`, {
        method: 'POST',
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['lists', householdId] }),
  })
}

// --- Item hooks ---

export function useShoppingItems(householdId: string, listId: string) {
  return useQuery({
    queryKey: ['list-items', householdId, listId],
    queryFn: () => apiFetch<ShoppingItem[]>(`/households/${householdId}/lists/${listId}/items`),
    enabled: !!householdId && !!listId && hasToken(),
  })
}

export function useCreateShoppingItem(householdId: string, listId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (item: ShoppingItemCreate) =>
      apiFetch<ShoppingItem>(`/households/${householdId}/lists/${listId}/items`, {
        method: 'POST',
        body: JSON.stringify(item),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['list-items', householdId, listId] })
      qc.invalidateQueries({ queryKey: ['lists', householdId] })
    },
  })
}

export function useUpdateShoppingItem(householdId: string, listId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ itemId, ...update }: ShoppingItemUpdate & { itemId: string }) =>
      apiFetch<ShoppingItem>(`/households/${householdId}/lists/${listId}/items/${itemId}`, {
        method: 'PATCH',
        body: JSON.stringify(update),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['list-items', householdId, listId] })
      qc.invalidateQueries({ queryKey: ['lists', householdId] })
    },
  })
}

export function useDeleteShoppingItem(householdId: string, listId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (itemId: string) =>
      apiFetch<void>(`/households/${householdId}/lists/${listId}/items/${itemId}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['list-items', householdId, listId] })
      qc.invalidateQueries({ queryKey: ['lists', householdId] })
    },
  })
}

// --- Bulk items, recipes, suggestions ---

export interface RecipeRef {
  url: string
  title: string
}

export interface BulkItemsCreate {
  items: ShoppingItemCreate[]
  recipe?: RecipeRef
}

export interface Recipe {
  id: string
  list_id: string
  url: string
  title: string
  created_by: string
  created_at: string
}

export interface SuggestedItem {
  name: string
  quantity: string
  count: number
}

export interface SuggestionResult {
  enough_history: boolean
  items: SuggestedItem[]
}

export interface ExtractedIngredient {
  name: string
  quantity: string
  staple: boolean
}

export interface RecipeExtract {
  url: string
  title: string
  ingredients: ExtractedIngredient[]
}

export function useAddItemsBulk(householdId: string, listId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: BulkItemsCreate) =>
      apiFetch<ShoppingItem[]>(`/households/${householdId}/lists/${listId}/items/bulk`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['list-items', householdId, listId] })
      qc.invalidateQueries({ queryKey: ['lists', householdId] })
      qc.invalidateQueries({ queryKey: ['recipes', householdId, listId] })
    },
  })
}

export function useRecipes(householdId: string, listId: string) {
  return useQuery({
    queryKey: ['recipes', householdId, listId],
    queryFn: () => apiFetch<Recipe[]>(`/households/${householdId}/lists/${listId}/recipes`),
    enabled: !!householdId && !!listId && hasToken(),
  })
}

export function useDeleteRecipe(householdId: string, listId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ recipeId, removeItems }: { recipeId: string; removeItems: boolean }) =>
      apiFetch<void>(
        `/households/${householdId}/lists/${listId}/recipes/${recipeId}?remove_items=${removeItems}`,
        { method: 'DELETE' },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['list-items', householdId, listId] })
      qc.invalidateQueries({ queryKey: ['lists', householdId] })
      qc.invalidateQueries({ queryKey: ['recipes', householdId, listId] })
    },
  })
}

export function useSuggestions(householdId: string, listId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['suggestions', householdId, listId],
    queryFn: () =>
      apiFetch<SuggestionResult>(`/households/${householdId}/lists/${listId}/suggestions`),
    enabled: enabled && !!householdId && !!listId && hasToken(),
    staleTime: 0,
  })
}

export function useExtractRecipe(householdId: string, listId: string) {
  return useMutation({
    mutationFn: (url: string) =>
      apiFetch<RecipeExtract>(`/households/${householdId}/lists/${listId}/recipes/extract`, {
        method: 'POST',
        body: JSON.stringify({ url }),
      }),
  })
}
