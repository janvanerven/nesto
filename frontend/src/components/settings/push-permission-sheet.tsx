import { AnimatePresence, motion } from 'framer-motion'
import { Button } from '@/components/ui'
import { useScrollLock } from '@/utils/use-scroll-lock'

interface PushPermissionSheetProps {
  open: boolean
  onConfirm: () => void
  /** Called on both backdrop tap and "Not now" — caller must handle recordPushDismissal on both paths */
  onDismiss: () => void
}

export function PushPermissionSheet({ open, onConfirm, onDismiss }: PushPermissionSheetProps) {
  useScrollLock(open)

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/30 z-40"
            onClick={onDismiss}
          />
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="fixed bottom-0 left-0 right-0 bg-surface rounded-t-3xl p-6 pb-[env(safe-area-inset-bottom)] z-50 max-w-lg mx-auto max-h-[85vh] overflow-y-auto"
          >
            <div className="w-12 h-1.5 bg-text/10 rounded-full mx-auto mb-6" />

            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center shrink-0">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-primary">
                  <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 01-3.46 0" />
                </svg>
              </div>
              <div>
                <h2 className="text-lg font-bold text-text">Enable notifications</h2>
                <p className="text-sm text-text-muted">Stay on top of your household</p>
              </div>
            </div>

            <ul className="space-y-2 mb-6">
              {[
                'Reminders when tasks are due',
                'Alerts 1 hour before events start',
                'When a household member posts a notice',
              ].map((item) => (
                <li key={item} className="flex items-center gap-2 text-sm text-text">
                  <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
                  {item}
                </li>
              ))}
            </ul>

            <p className="text-xs text-text-muted mb-4">
              Your browser will ask for permission. You can turn this off anytime in Settings.
            </p>

            <div className="flex flex-col gap-2">
              <Button onClick={onConfirm}>Allow notifications</Button>
              <Button variant="ghost" onClick={onDismiss}>Not now</Button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
