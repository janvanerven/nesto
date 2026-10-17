import type { ReactNode } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

interface BottomSheetProps {
  readonly open: boolean
  readonly onClose: () => void
  readonly children: ReactNode
  /** Opened on top of another sheet: layers above it so the lower one is covered. */
  readonly stacked?: boolean
}

export function BottomSheet({ open, onClose, children, stacked = false }: BottomSheetProps) {
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className={`fixed inset-0 bg-black/30 ${stacked ? 'z-[60]' : 'z-40'}`}
            onClick={onClose}
          />
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className={`fixed bottom-0 left-0 right-0 bg-surface rounded-t-3xl p-6 pb-[env(safe-area-inset-bottom)] ${stacked ? 'z-[70]' : 'z-50'} max-w-lg mx-auto max-h-[85vh] overflow-y-auto`}
          >
            <div className="w-12 h-1.5 bg-text/10 rounded-full mx-auto mb-6" />
            {children}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
