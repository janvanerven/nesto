import { BarcodeDisplay } from './barcode-display'
import type { LoyaltyCard } from '@/api/cards'
import { textColor } from '@/utils/color'

interface LoyaltyCardCardProps {
  card: LoyaltyCard
  onClick: () => void
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
