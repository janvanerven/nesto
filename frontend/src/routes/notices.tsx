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

function NoticeBoardPage() {
  const auth = useAuth()
  const { data: households } = useHouseholds()
  const { data: user } = useCurrentUser()
  const [offset, setOffset] = useState(0)
  const [sheetOpen, setSheetOpen] = useState(false)
  const limit = 20

  if (!auth.isAuthenticated) return <Navigate to="/login" />

  const household = households?.[0]
  if (!household) return null

  return (
    <NoticeBoard
      householdId={household.id}
      currentUserId={user?.id ?? ''}
      offset={offset}
      limit={limit}
      onLoadMore={() => setOffset((o) => o + limit)}
      sheetOpen={sheetOpen}
      onSheetOpen={() => setSheetOpen(true)}
      onSheetClose={() => setSheetOpen(false)}
    />
  )
}

function NoticeBoard({
  householdId,
  currentUserId,
  offset,
  limit,
  onLoadMore,
  sheetOpen,
  onSheetOpen,
  onSheetClose,
}: {
  householdId: string
  currentUserId: string
  offset: number
  limit: number
  onLoadMore: () => void
  sheetOpen: boolean
  onSheetOpen: () => void
  onSheetClose: () => void
}) {
  const { data: notices = [], isLoading } = useNotices(householdId, { limit, offset })
  const patchNotice = usePatchNotice(householdId)
  const deleteNotice = useDeleteNotice(householdId)

  return (
    <div className="min-h-screen bg-background pb-32">
      <div className="max-w-lg mx-auto px-4 pt-6">
        <h1 className="text-2xl font-bold text-text mb-6">Notice Board</h1>

        {isLoading && (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-20 bg-surface rounded-2xl animate-pulse" />
            ))}
          </div>
        )}

        {!isLoading && notices.length === 0 && (
          <div className="text-center py-16">
            <p className="text-text-muted text-base">No notes yet.</p>
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
            className="w-full py-3 text-sm text-primary font-medium"
            onClick={onLoadMore}
          >
            Load more
          </button>
        )}
      </div>

      <Fab onClick={onSheetOpen} />
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
      className={`bg-surface rounded-2xl p-4 mb-3 ${notice.pinned ? 'ring-2 ring-primary/30' : ''}`}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <p className="text-text text-sm leading-relaxed flex-1">{notice.content}</p>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => onPin(!notice.pinned)}
            className={`p-1.5 rounded-full transition-colors ${notice.pinned ? 'text-primary' : 'text-text-muted hover:text-text'}`}
            title={notice.pinned ? 'Unpin' : 'Pin'}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill={notice.pinned ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
            </svg>
          </button>
          {isAuthor && (
            <button
              onClick={onDelete}
              className="p-1.5 rounded-full text-text-muted hover:text-red-500 transition-colors"
              title="Delete"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
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
