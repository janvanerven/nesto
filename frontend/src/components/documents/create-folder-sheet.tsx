import { useState, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Button, Input } from '@/components/ui'
import { useCreateFolder } from '@/api/sekura'
import { useScrollLock } from '@/utils/use-scroll-lock'

interface CreateFolderSheetProps {
  open: boolean
  onClose: () => void
  householdId: string
  parentId?: string
}

export function CreateFolderSheet({ open, onClose, householdId, parentId }: CreateFolderSheetProps) {
  useScrollLock(open)
  const nameRef = useRef<HTMLInputElement>(null)
  const [name, setName] = useState('')
  const [error, setError] = useState('')

  const createMutation = useCreateFolder(householdId)

  const reset = () => {
    setName('')
    setError('')
  }

  const handleClose = () => {
    if (createMutation.isPending) return
    reset()
    onClose()
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return
    setError('')
    try {
      await createMutation.mutateAsync({ name: trimmed, parentId })
      reset()
      onClose()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create folder')
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 bg-black/30 z-40"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={handleClose}
          />
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            onAnimationComplete={(def: { y?: string | number }) => {
              if (def.y === 0) nameRef.current?.focus()
            }}
            className="fixed bottom-0 left-0 right-0 bg-surface rounded-t-3xl p-6 pb-[env(safe-area-inset-bottom)] z-50 max-w-lg mx-auto max-h-[85vh] overflow-y-auto"
          >
            <div className="w-12 h-1.5 bg-text/10 rounded-full mx-auto mb-6" />
            <h2 className="text-lg font-bold text-text mb-5">New folder</h2>

            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <Input
                ref={nameRef}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Folder name"
                autoComplete="off"
              />

              {error && <p className="text-xs text-accent -mt-2">{error}</p>}

              <div className="flex gap-3">
                <Button
                  type="button"
                  variant="ghost"
                  className="flex-1"
                  onClick={handleClose}
                  disabled={createMutation.isPending}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  className="flex-1"
                  disabled={!name.trim() || createMutation.isPending}
                >
                  {createMutation.isPending ? 'Creating...' : 'Create'}
                </Button>
              </div>
            </form>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
