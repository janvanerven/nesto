import { motion, AnimatePresence } from 'framer-motion'
import { useRef, useState } from 'react'
import { Button, Input } from '@/components/ui'
import type { LoyaltyCardCreate } from '@/api/cards'
import { FORMATS, COLORS } from './constants'
import { useScrollLock } from '@/utils/use-scroll-lock'

interface CreateCardSheetProps {
  open: boolean
  onClose: () => void
  onSubmit: (card: LoyaltyCardCreate) => void
  isPending: boolean
}

export function CreateCardSheet({ open, onClose, onSubmit, isPending }: CreateCardSheetProps) {
  const nameRef = useRef<HTMLInputElement>(null)
  const [storeName, setStoreName] = useState('')
  const [barcodeNumber, setBarcodeNumber] = useState('')
  const [barcodeFormat, setBarcodeFormat] = useState<LoyaltyCardCreate['barcode_format']>('code128')
  const [color, setColor] = useState(COLORS[0])

  useScrollLock(open)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!storeName.trim() || !barcodeNumber.trim()) return
    onSubmit({
      store_name: storeName.trim(),
      barcode_number: barcodeNumber.trim(),
      barcode_format: barcodeFormat,
      color,
    })
    setStoreName('')
    setBarcodeNumber('')
    setBarcodeFormat('code128')
    setColor(COLORS[0])
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
            onAnimationComplete={(def: { y?: string | number }) => {
              if (def.y === 0) nameRef.current?.focus()
            }}
            className="fixed bottom-0 left-0 right-0 bg-surface rounded-t-3xl p-6 pb-[env(safe-area-inset-bottom)] z-50 max-w-lg mx-auto max-h-[85vh] overflow-y-auto"
          >
            <div className="w-12 h-1.5 bg-text/10 rounded-full mx-auto mb-6" />
            <h2 className="text-xl font-bold text-text mb-4">New loyalty card</h2>

            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <Input
                ref={nameRef}
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

              {/* Barcode format */}
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

              {/* Color picker */}
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

              <Button type="submit" disabled={isPending || !storeName.trim() || !barcodeNumber.trim()}>
                {isPending ? 'Creating...' : 'Create card'}
              </Button>
            </form>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
