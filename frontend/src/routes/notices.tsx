import { useState } from 'react'
import { createFileRoute, Navigate } from '@tanstack/react-router'
import { useAuth } from 'react-oidc-context'
import { motion, AnimatePresence } from 'framer-motion'
import { useHouseholds } from '@/api/households'
import { useCurrentUser } from '@/api/user'
import { useNotices, usePatchNotice, useDeleteNotice } from '@/api/notices'
import type { Notice } from '@/api/notices'
import { Fab } from '@/components/ui'
import { CreateNoticeSheet } from '@/components/notices/create-notice-sheet'

export const Route = createFileRoute('/notices')({
  component: NoticeBoardPage,
})

const PAGE_SIZE = 20

function NoticeBoardPage() {
  const auth = useAuth()
  const { data: households } = useHouseholds()
  const { data: user } = useCurrentUser()
  const [visible, setVisible] = useState(PAGE_SIZE)
  const [sheetOpen, setSheetOpen] = useState(false)

  if (!auth.isAuthenticated) return <Navigate to="/login" />

  const household = households?.[0]
  if (!household) return null

  return (
    <NoticeBoard
      householdId={household.id}
      currentUserId={user?.id ?? ''}
      limit={visible}
      onLoadMore={() => setVisible((v) => v + PAGE_SIZE)}
      sheetOpen={sheetOpen}
      onSheetOpen={() => setSheetOpen(true)}
      onSheetClose={() => setSheetOpen(false)}
    />
  )
}

function NoticeBoard({
  householdId,
  currentUserId,
  limit,
  onLoadMore,
  sheetOpen,
  onSheetOpen,
  onSheetClose,
}: {
  householdId: string
  currentUserId: string
  limit: number
  onLoadMore: () => void
  sheetOpen: boolean
  onSheetOpen: () => void
  onSheetClose: () => void
}) {
  const { data: notices = [], isLoading } = useNotices(householdId, { limit, offset: 0 })
  const patchNotice = usePatchNotice(householdId)
  const deleteNotice = useDeleteNotice(householdId)

  return (
    <div className="pb-4">
      <h1 className="text-2xl font-extrabold text-text mt-2 mb-4">Board</h1>

      {isLoading && (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-20 bg-surface rounded-[var(--radius-card)] animate-pulse" />
          ))}
        </div>
      )}

      {!isLoading && notices.length === 0 && (
        <div className="text-center py-16">
          <p className="text-text-muted text-base">No notices yet.</p>
          <p className="text-text-muted text-sm mt-1">Post the first one for your household.</p>
        </div>
      )}

      <AnimatePresence initial={false}>
        {notices.map((notice) => (
          <NoticeCard
            key={notice.id}
            notice={notice}
            currentUserId={currentUserId}
            onPin={(pinned) => patchNotice.mutate({ noticeId: notice.id, pinned })}
            onDelete={() => deleteNotice.mutate(notice.id)}
          />
        ))}
      </AnimatePresence>

      {notices.length === limit && (
        <button
          type="button"
          className="w-full py-3 text-sm text-primary font-medium rounded-xl hover:bg-primary/5 active:bg-primary/10 transition-colors"
          onClick={onLoadMore}
        >
          Load more
        </button>
      )}

      <Fab pulse={!isLoading && notices.length === 0} onClick={onSheetOpen} aria-label="Add notice">
        +
      </Fab>
      <CreateNoticeSheet
        open={sheetOpen}
        onClose={onSheetClose}
        householdId={householdId}
      />
    </div>
  )
}

function NoticeCard({
  notice,
  currentUserId,
  onPin,
  onDelete,
}: {
  notice: Notice
  currentUserId: string
  onPin: (pinned: boolean) => void
  onDelete: () => void
}) {
  const isAuthor = notice.author_id === currentUserId
  const dateStr = new Date(notice.created_at).toLocaleDateString('en', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      className={`bg-surface rounded-[var(--radius-card)] shadow-[var(--shadow-card)] p-4 mb-3 ${notice.pinned ? 'ring-2 ring-primary/30' : ''}`}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <p className="text-text text-sm leading-relaxed flex-1">{notice.content}</p>
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => onPin(!notice.pinned)}
            className={`p-1.5 rounded-full transition-colors ${notice.pinned ? 'text-primary' : 'text-text-muted hover:text-text'}`}
            aria-label={notice.pinned ? 'Unpin' : 'Pin'}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill={notice.pinned ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 17v5" />
              <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1z" />
            </svg>
          </button>
          {isAuthor && (
            <button
              type="button"
              onClick={onDelete}
              className="p-1.5 rounded-full text-text-muted hover:text-accent transition-colors"
              aria-label="Delete"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M3 6h18M19 6l-1 14H6L5 6M8 6V4h8v2" />
              </svg>
            </button>
          )}
        </div>
      </div>
      <p className="text-xs text-text-muted">{dateStr}{notice.pinned ? ' · Pinned' : ''}</p>
    </motion.div>
  )
}
