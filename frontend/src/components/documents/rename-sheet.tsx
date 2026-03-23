import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Button, Input } from '@/components/ui'
import { useScrollLock } from '@/utils/use-scroll-lock'

interface RenameSheetProps {
  isOpen: boolean
  onClose: () => void
  currentName: string
  onRename: (newName: string) => void
  isPending: boolean
}

export function RenameSheet({
  isOpen,
  onClose,
  currentName,
  onRename,
  isPending,
}: RenameSheetProps) {
  useScrollLock(isOpen)
  const inputRef = useRef<HTMLInputElement>(null)
  const [name, setName] = useState(currentName)

  // Sync name when sheet opens with a new item
  useEffect(() => {
    if (isOpen) setName(currentName)
  }, [isOpen, currentName])

  const handleClose = () => {
    if (isPending) return
    onClose()
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed || trimmed === currentName) return
    onRename(trimmed)
  }

  return (
    <AnimatePresence>
      {isOpen && (
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
              if (def.y === 0) {
                // Select all text so the user can immediately type a new name
                inputRef.current?.focus()
                inputRef.current?.select()
              }
            }}
            className="fixed bottom-0 left-0 right-0 bg-surface rounded-t-3xl p-6 pb-[env(safe-area-inset-bottom)] z-50 max-w-lg mx-auto"
          >
            <div className="w-12 h-1.5 bg-text/10 rounded-full mx-auto mb-6" />
            <h2 className="text-lg font-bold text-text mb-5">Rename</h2>

            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <Input
                ref={inputRef}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Name"
                autoComplete="off"
              />

              <div className="flex gap-3">
                <Button
                  type="button"
                  variant="ghost"
                  className="flex-1"
                  onClick={handleClose}
                  disabled={isPending}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  className="flex-1"
                  disabled={!name.trim() || name.trim() === currentName || isPending}
                >
                  {isPending ? 'Saving...' : 'Save'}
                </Button>
              </div>
            </form>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
