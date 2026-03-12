import { BarcodeDisplay } from './barcode-display'
import type { LoyaltyCard } from '@/api/cards'

interface LoyaltyCardCardProps {
  card: LoyaltyCard
  onClick: () => void
}

function textColor(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return lum > 0.5 ? '#1a1a1a' : '#ffffff'
}

const FORMAT_LABELS: Record<string, string> = {
  code128: 'Code 128',
  ean13: 'EAN-13',
  qr: 'QR Code',
  code39: 'Code 39',
}

export function LoyaltyCardCard({ card, onClick }: LoyaltyCardCardProps) {
  const fg = textColor(card.color)

  return (
    <button
      onClick={onClick}
      className="w-full rounded-2xl p-4 text-left transition-all active:scale-[0.98]"
      style={{ backgroundColor: card.color, color: fg }}
    >
      <p className="font-bold text-lg truncate">{card.store_name}</p>
      <p className="text-xs opacity-70 mb-3">{FORMAT_LABELS[card.barcode_format] ?? card.barcode_format}</p>
      <div className="opacity-80 pointer-events-none" style={{ color: fg }}>
        <BarcodeDisplay value={card.barcode_number} format={card.barcode_format} height={40} />
      </div>
    </button>
  )
}
