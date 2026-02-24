import { Card, PriorityDot } from '@/components/ui'
import type { ShoppingList } from '@/api/lists'

interface ListCardProps {
  list: ShoppingList
  onClick: () => void
}

export function ListCard({ list, onClick }: ListCardProps) {
  const isArchived = list.status === 'archived'
  const progress = list.item_count > 0 ? `${list.checked_count}/${list.item_count}` : 'Empty'

  return (
    <Card className={`cursor-pointer ${isArchived ? 'opacity-60' : ''}`} onClick={onClick}>
      <div className="flex items-center gap-3">
        <PriorityDot priority={list.priority} />
        <div className="flex-1 min-w-0">
          <p className={`font-semibold text-text ${isArchived ? 'text-text-muted' : ''}`}>
            {list.name || 'Untitled list'}
          </p>
          <p className="text-xs text-text-muted mt-0.5">{progress} items</p>
        </div>
        {/* Progress indicator */}
        {list.item_count > 0 && (
          <div className="flex items-center gap-2">
            <div className="w-16 h-1.5 bg-text/10 rounded-full overflow-hidden">
              <div
                className="h-full bg-success rounded-full transition-all"
                style={{ width: `${(list.checked_count / list.item_count) * 100}%` }}
              />
            </div>
          </div>
        )}
        {/* Chevron */}
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-text-muted shrink-0">
          <path d="M9 18l6-6-6-6" />
        </svg>
      </div>
    </Card>
  )
}
