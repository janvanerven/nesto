import type { ListKind } from '@/api/lists'

export const KIND_LABELS: Record<ListKind, string> = {
  groceries: 'Groceries',
  wishlist: 'Wish list',
  packing: 'Packing',
  other: 'Other',
}

const KINDS: ListKind[] = ['groceries', 'wishlist', 'packing', 'other']

interface KindPickerProps {
  value: ListKind
  onChange: (kind: ListKind) => void
}

export function KindPicker({ value, onChange }: KindPickerProps) {
  return (
    <div>
      <label className="text-sm font-medium text-text-muted mb-2 block">Type</label>
      <div className="flex flex-wrap gap-2">
        {KINDS.map((kind) => (
          <button
            key={kind}
            type="button"
            onClick={() => onChange(kind)}
            aria-pressed={value === kind}
            className={`
              px-3.5 py-2 rounded-xl text-sm font-medium transition-all
              ${value === kind ? 'bg-primary text-white shadow-md' : 'bg-text/5 text-text-muted'}
            `}
          >
            {KIND_LABELS[kind]}
          </button>
        ))}
      </div>
    </div>
  )
}
