import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Button } from '@/components/ui'
import { useCreateNotice } from '@/api/notices'
import { useScrollLock } from '@/utils/use-scroll-lock'

const MAX_CHARS = 500
const COUNTER_THRESHOLD = 400

interface CreateNoticeSheetProps {
  open: boolean
  onClose: () => void
  householdId: string
}

export function CreateNoticeSheet({ open, onClose, householdId }: CreateNoticeSheetProps) {
  const [content, setContent] = useState('')
  const createNotice = useCreateNotice(householdId)

  useScrollLock(open)

  const charsLeft = MAX_CHARS - content.length
  const showCounter = content.length > COUNTER_THRESHOLD

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!content.trim()) return
    createNotice.mutate(
      { content: content.trim() },
      {
        onSuccess: () => {
          setContent('')
          onClose()
        },
      }
    )
  }

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
            <h2 className="text-xl font-bold text-text mb-4">Post a note</h2>

            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <div className="relative">
                <textarea
                  autoFocus
                  value={content}
                  onChange={(e) => setContent(e.target.value.slice(0, MAX_CHARS))}
                  rows={4}
                  placeholder="Something for the household..."
                  className="w-full px-4 py-3 rounded-[var(--radius-input)] border-2 border-text/10 bg-surface text-text text-base placeholder:text-text-muted/50 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all duration-200 resize-none"
                />
                {showCounter && (
                  <span
                    className={`absolute bottom-2 right-3 text-xs font-medium ${
                      charsLeft <= 50 ? 'text-red-500' : 'text-orange-500'
                    }`}
                  >
                    {charsLeft}
                  </span>
                )}
              </div>

              <Button
                type="submit"
                disabled={!content.trim() || createNotice.isPending}
              >
                {createNotice.isPending ? 'Posting...' : 'Post note'}
              </Button>
            </form>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
