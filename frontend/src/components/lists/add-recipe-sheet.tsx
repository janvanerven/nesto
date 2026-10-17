import { useRef, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { BottomSheet, Button, Input } from '@/components/ui'
import { useAddItemsBulk, useExtractRecipe } from '@/api/lists'
import type { RecipeExtract } from '@/api/lists'
import { useScrollLock } from '@/utils/use-scroll-lock'

interface AddRecipeSheetProps {
  open: boolean
  onClose: () => void
  householdId: string
  listId: string
  aiEnabled: boolean
}

export function AddRecipeSheet({ open, onClose, householdId, listId, aiEnabled }: AddRecipeSheetProps) {
  const extract = useExtractRecipe(householdId, listId)
  const addBulk = useAddItemsBulk(householdId, listId)
  const [url, setUrl] = useState('')
  const [result, setResult] = useState<RecipeExtract | null>(null)
  const [selected, setSelected] = useState<Set<number>>(new Set())

  const requestId = useRef(0)

  useScrollLock(open)

  function reset(): void {
    requestId.current += 1 // invalidate any in-flight extraction
    setUrl('')
    setResult(null)
    setSelected(new Set())
    extract.reset()
    addBulk.reset()
  }

  function handleClose(): void {
    onClose()
    reset()
  }

  async function handleFind(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    const trimmed = url.trim()
    if (!trimmed) return
    const myId = ++requestId.current
    try {
      const data = await extract.mutateAsync(trimmed)
      if (myId !== requestId.current) return
      setResult(data)
      // Staples start unticked
      setSelected(new Set(data.ingredients.flatMap((ing, i) => (ing.staple ? [] : [i]))))
    } catch {
      // error rendered from extract.error
    }
  }

  function toggle(index: number): void {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }

  async function handleAdd(): Promise<void> {
    if (!result) return
    const items = result.ingredients
      .filter((_, i) => selected.has(i))
      .map((ing) => ({ name: ing.name, quantity: ing.quantity }))
    if (!items.length) return
    try {
      await addBulk.mutateAsync({ items, recipe: { url: result.url, title: result.title } })
      handleClose()
    } catch {
      // error rendered from addBulk.error
    }
  }

  return (
    <BottomSheet open={open} onClose={handleClose}>
      <h2 className="text-xl font-bold text-text mb-4">Add recipe</h2>

      {!aiEnabled ? (
        <div className="flex flex-col gap-4 pb-4">
          <p className="text-sm text-text-muted">Set up the assistant in Settings to read recipes</p>
          <Link
            to="/settings"
            onClick={handleClose}
            className="text-sm font-semibold text-primary underline"
          >
            Open Settings
          </Link>
        </div>
      ) : !result ? (
        <form onSubmit={handleFind} className="flex flex-col gap-4 pb-4">
          <Input
            label="Recipe link"
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://..."
            disabled={extract.isPending}
          />
          {extract.isError && (
            <p className="text-sm text-accent">{extract.error.message}</p>
          )}
          <Button type="submit" disabled={!url.trim() || extract.isPending}>
            {extract.isPending ? 'Reading recipe…' : 'Find ingredients'}
          </Button>
        </form>
      ) : (
        <div className="flex flex-col gap-3 pb-4">
          <p className="text-sm font-semibold text-text">{result.title}</p>
          {result.ingredients.length === 0 ? (
            <p className="text-sm text-text-muted">No ingredients found.</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {result.ingredients.map((ing, i) => (
                <li key={`${ing.name}-${i}`}>
                  <label className="flex items-center gap-3 py-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selected.has(i)}
                      onChange={() => toggle(i)}
                      className="w-5 h-5 accent-primary"
                    />
                    <span className="flex-1 min-w-0 text-sm font-medium text-text">
                      {ing.name}
                      {ing.staple && (
                        <span className="ml-2 text-xs font-normal text-text-muted">pantry staple</span>
                      )}
                    </span>
                    {ing.quantity && <span className="text-xs text-text-muted">{ing.quantity}</span>}
                  </label>
                </li>
              ))}
            </ul>
          )}
          {addBulk.isError && (
            <p className="text-sm text-accent">Could not add items. Try again.</p>
          )}
          <div className="flex gap-3">
            <Button
              onClick={handleAdd}
              disabled={selected.size === 0 || addBulk.isPending}
              className="flex-1"
            >
              {addBulk.isPending ? 'Adding...' : 'Add'}
            </Button>
            <Button variant="ghost" onClick={reset} disabled={addBulk.isPending}>
              Back
            </Button>
          </div>
        </div>
      )}
    </BottomSheet>
  )
}
