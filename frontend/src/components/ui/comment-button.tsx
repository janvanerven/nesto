interface CommentButtonProps {
  count: number
  onClick?: () => void
}

/** Speech-bubble button with count badge, used on task and event cards. */
export function CommentButton({ count, onClick }: CommentButtonProps) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick?.() }}
      className="flex items-center gap-1 text-text-muted hover:text-primary transition-colors shrink-0"
      aria-label={count > 0 ? `View comments (${count})` : 'Add a comment'}
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
      </svg>
      {count > 0 && (
        <span className="text-xs font-medium text-primary">{count}</span>
      )}
    </button>
  )
}
