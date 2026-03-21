import { useEffect } from 'react'

/**
 * Locks body scroll when `open` is true, restores it on cleanup.
 * Tracks a counter so nested/concurrent sheets don't fight each other.
 */
let lockCount = 0

export function useScrollLock(open: boolean): void {
  useEffect(() => {
    if (!open) return
    lockCount++
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      lockCount--
      if (lockCount === 0) {
        document.body.style.overflow = prev
      }
    }
  }, [open])
}
