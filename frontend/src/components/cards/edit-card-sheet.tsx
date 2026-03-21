import { motion, AnimatePresence } from 'framer-motion'
import { useState, useEffect } from 'react'
import { Button, Input } from '@/components/ui'
import type { LoyaltyCard, LoyaltyCardUpdate } from '@/api/cards'
import { FORMATS, COLORS } from './constants'
import { useScrollLock } from '@/utils/use-scroll-lock'

interface EditCardSheetProps {
  card: LoyaltyCard | null
  open: boolean
  onClose: () => void
  onSubmit: (update: LoyaltyCardUpdate & { cardId: string }) => void
  onDelete: (cardId: string) => void
  isPending: boolean
}

export function EditCardSheet({ card, open, onClose, onSubmit, onDelete, isPending }: EditCardSheetProps) {
  const [storeName, setStoreName] = useState('')
  const [barcodeNumber, setBarcodeNumber] = useState('')
  const [barcodeFormat, setBarcodeFormat] = useState<string>('code128')
  const [color, setColor] = useState(COLORS[0])
  const [confirmDelete, setConfirmDelete] = useState(false)

  useScrollLock(open)

  useEffect(() => {
    if (!card) return
    setStoreName(card.store_name)
    setBarcodeNumber(card.barcode_number)
    setBarcodeFormat(card.barcode_format)
    setColor(card.color)
    setConfirmDelete(false)
  }, [card])

  if (!card) return null

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault()
    if (!card) return
    onSubmit({
      cardId: card.id,
      store_name: storeName.trim(),
      barcode_number: barcodeNumber.trim(),
      barcode_format: barcodeFormat as LoyaltyCardUpdate['barcode_format'],
      color,
    })
  }

  function handleDeleteClick(): void {
    if (!card) return
    if (confirmDelete) {
      onDelete(card.id)
    } else {
      setConfirmDelete(true)
    }
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
            className="fixed bottom-0 left-0 right-0 bg-surface rounded-t-3xl p-6 pb-[env(safe-area-inset-bottom)] z-50 max-w-lg mx-auto max-h-[85vh] overflow-y-auto"
          >
            <div className="w-12 h-1.5 bg-text/10 rounded-full mx-auto mb-6" />
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-text">Edit card</h2>
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
                label="Store name"
                value={storeName}
                onChange={(e) => setStoreName(e.target.value)}
                placeholder="e.g. Albert Heijn, Kruidvat"
              />

              <Input
                label="Barcode number"
                value={barcodeNumber}
                onChange={(e) => setBarcodeNumber(e.target.value)}
                placeholder="e.g. 2620012345678"
              />

              <div>
                <label className="text-sm font-medium text-text-muted mb-2 block">Barcode format</label>
                <div className="flex gap-2 flex-wrap">
                  {FORMATS.map((f) => (
                    <button
                      key={f.value}
                      type="button"
                      onClick={() => setBarcodeFormat(f.value)}
                      className={`
                        px-3 py-2 rounded-xl text-sm font-medium transition-all
                        ${barcodeFormat === f.value
                          ? 'bg-primary text-white shadow-md'
                          : 'bg-text/5 text-text-muted'
                        }
                      `}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-sm font-medium text-text-muted mb-2 block">Card color</label>
                <div className="flex gap-2 flex-wrap">
                  {COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setColor(c)}
                      className={`
                        w-9 h-9 rounded-full transition-all
                        ${color === c ? 'ring-2 ring-offset-2 ring-primary ring-offset-surface scale-110' : 'hover:scale-105'}
                      `}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>

              <div className="flex gap-3">
                <Button type="submit" disabled={isPending || !storeName.trim() || !barcodeNumber.trim()} className="flex-1">
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
