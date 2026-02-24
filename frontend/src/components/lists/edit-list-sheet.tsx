import { motion, AnimatePresence } from 'framer-motion'
import { useState, useEffect } from 'react'
import { Button, Input } from '@/components/ui'
import type { ShoppingList, ShoppingListUpdate } from '@/api/lists'

interface EditListSheetProps {
  list: ShoppingList | null
  open: boolean
  onClose: () => void
  onSubmit: (update: ShoppingListUpdate & { listId: string }) => void
  onDelete: (listId: string) => void
  isPending: boolean
}

export function EditListSheet({ list, open, onClose, onSubmit, onDelete, isPending }: EditListSheetProps) {
  const [name, setName] = useState('')
  const [priority, setPriority] = useState(3)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    if (!list) return
    setName(list.name)
    setPriority(list.priority)
    setConfirmDelete(false)
  }, [list])

  if (!list) return null

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault()
    if (!list) return
    onSubmit({ listId: list.id, name: name.trim(), priority })
  }

  function handleDeleteClick(): void {
    if (!list) return
    if (confirmDelete) {
      onDelete(list.id)
    } else {
      setConfirmDelete(true)
    }
  }

  const priorities = [
    { value: 1, label: 'Urgent', color: 'bg-priority-urgent' },
    { value: 2, label: 'High', color: 'bg-priority-high' },
    { value: 3, label: 'Normal', color: 'bg-priority-normal' },
    { value: 4, label: 'Low', color: 'bg-priority-low' },
  ]

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
            className="fixed bottom-0 left-0 right-0 bg-surface rounded-t-3xl p-6 pb-[env(safe-area-inset-bottom)] z-50 max-w-lg mx-auto"
          >
            <div className="w-12 h-1.5 bg-text/10 rounded-full mx-auto mb-6" />
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-text">Edit list</h2>
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
              <Input
                label="List name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Groceries, Birthday wishlist"
              />

              <div>
                <label className="text-sm font-medium text-text-muted mb-2 block">Priority</label>
                <div className="flex gap-2">
                  {priorities.map((p) => (
                    <button
                      key={p.value}
                      type="button"
                      onClick={() => setPriority(p.value)}
                      className={`
                        flex-1 py-2 rounded-xl text-sm font-medium transition-all
                        ${priority === p.value
                          ? `${p.color} text-white shadow-md`
                          : 'bg-text/5 text-text-muted'
                        }
                      `}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex gap-3">
                <Button type="submit" disabled={isPending} className="flex-1">
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
