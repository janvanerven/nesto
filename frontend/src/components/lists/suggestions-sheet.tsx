import { useEffect, useState } from 'react'
import { BottomSheet, Button } from '@/components/ui'
import { useAddItemsBulk, useSuggestions } from '@/api/lists'
import { useScrollLock } from '@/utils/use-scroll-lock'

interface SuggestionsSheetProps {
  open: boolean
  onClose: () => void
  householdId: string
  listId: string
}

export function SuggestionsSheet({ open, onClose, householdId, listId }: SuggestionsSheetProps) {
  const { data, isLoading, isError } = useSuggestions(householdId, listId, open)
  const addBulk = useAddItemsBulk(householdId, listId)
  const [selected, setSelected] = useState<Set<number>>(new Set())

  useScrollLock(open)

  // Tick everything whenever a result arrives or the sheet is (re)opened; clear stale errors on close.
  const resetAdd = addBulk.reset
  useEffect(() => {
    if (!open) {
      resetAdd()
      return
    }
    if (data) setSelected(new Set(data.items.map((_, i) => i)))
  }, [data, open, resetAdd])

  function toggle(index: number): void {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }

  async function handleAdd(): Promise<void> {
    if (!data) return
    const items = data.items
      .filter((_, i) => selected.has(i))
      .map((s) => ({ name: s.name, quantity: s.quantity }))
    if (!items.length) return
    try {
      await addBulk.mutateAsync({ items })
      onClose()
    } catch {
      // error shown below via mutation state
    }
  }

  const hasItems = !!data && data.enough_history && data.items.length > 0

  return (
    <BottomSheet open={open} onClose={onClose}>
      <h2 className="text-xl font-bold text-text mb-1">Suggested items</h2>
      <p className="text-sm text-text-muted mb-4">Based on what you usually buy.</p>

      {isLoading ? (
        <div className="space-y-2 mb-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-10 bg-text/5 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : isError ? (
        <p className="text-sm text-accent mb-4">Could not load suggestions.</p>
      ) : !data?.enough_history ? (
        <p className="text-sm text-text-muted mb-4">Not enough history yet</p>
      ) : !hasItems ? (
        <p className="text-sm text-text-muted mb-4">No suggestions right now.</p>
      ) : (
        <ul className="flex flex-col gap-1 mb-4">
          {data.items.map((s, i) => (
            <li key={`${s.name}-${i}`}>
              <label className="flex items-center gap-3 py-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={selected.has(i)}
                  onChange={() => toggle(i)}
                  className="w-5 h-5 accent-primary"
                />
                <span className="flex-1 min-w-0 text-sm font-medium text-text">{s.name}</span>
                {s.quantity && <span className="text-xs text-text-muted">{s.quantity}</span>}
              </label>
            </li>
          ))}
        </ul>
      )}

      {addBulk.isError && (
        <p className="text-sm text-accent mb-3">Could not add items. Try again.</p>
      )}

      <div className="flex gap-3 pb-4">
        {hasItems && (
          <Button
            onClick={handleAdd}
            disabled={selected.size === 0 || addBulk.isPending}
            className="flex-1"
          >
            {addBulk.isPending ? 'Adding...' : 'Add selected'}
          </Button>
        )}
        <Button variant="ghost" onClick={onClose} className={hasItems ? '' : 'flex-1'}>
          {hasItems ? 'Cancel' : 'Close'}
        </Button>
      </div>
    </BottomSheet>
  )
}
