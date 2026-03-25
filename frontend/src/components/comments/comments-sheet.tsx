import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useComments, useCreateComment, useDeleteComment } from '@/api/comments'
import { useCurrentUser } from '@/api/user'
import { useHouseholdMembers } from '@/api/households'
import { Avatar } from '@/components/ui'
import { useScrollLock } from '@/utils/use-scroll-lock'

interface CommentsSheetProps {
  householdId: string
  entityType: 'task' | 'event'
  entityId: string
  entityTitle: string
  isOpen: boolean
  onClose: () => void
}

function formatTime(iso: string): string {
  const date = new Date(iso)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60_000)
  const diffHours = Math.floor(diffMins / 60)
  const diffDays = Math.floor(diffHours / 24)

  if (diffMins < 1) return 'just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function CommentsSheet({
  householdId,
  entityType,
  entityId,
  entityTitle,
  isOpen,
  onClose,
}: CommentsSheetProps) {
  const { data: currentUser } = useCurrentUser()
  const { data: members = [] } = useHouseholdMembers(householdId)
  const { data: comments = [], isLoading } = useComments(householdId, entityType, entityId)
  const createComment = useCreateComment(householdId, entityType, entityId)
  const deleteComment = useDeleteComment(householdId, entityType, entityId)

  const [text, setText] = useState('')
  const [mentions, setMentions] = useState<string[]>([])
  const [mentionQuery, setMentionQuery] = useState<string | null>(null)
  // Tracks the start index of the active @mention token in the textarea
  const [mentionStart, setMentionStart] = useState<number>(0)

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const listEndRef = useRef<HTMLDivElement>(null)

  useScrollLock(isOpen)

  // Scroll to bottom when comments load or a new comment arrives
  useEffect(() => {
    if (isOpen) {
      listEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [comments, isOpen])

  // Focus textarea when sheet opens
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => textareaRef.current?.focus(), 300)
    }
  }, [isOpen])

  // Reset state on close
  useEffect(() => {
    if (!isOpen) {
      setText('')
      setMentions([])
      setMentionQuery(null)
    }
  }, [isOpen])

  // Close mention dropdown on Escape
  useEffect(() => {
    if (!isOpen) return
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (mentionQuery !== null) {
          setMentionQuery(null)
          e.stopPropagation()
        } else {
          onClose()
        }
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [isOpen, mentionQuery, onClose])

  function handleTextChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const val = e.target.value
    const cursor = e.target.selectionStart ?? val.length
    setText(val)

    // Detect @mention: find the last @ before the cursor that isn't preceded by a word char
    const textBeforeCursor = val.slice(0, cursor)
    const match = textBeforeCursor.match(/(?:^|[\s\n])@(\w*)$/)
    if (match) {
      setMentionQuery(match[1])
      // The @ is at cursor minus length of "@query"
      setMentionStart(cursor - match[1].length - 1)
    } else {
      setMentionQuery(null)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Enter submits; Shift+Enter inserts newline
    if (e.key === 'Enter' && !e.shiftKey && mentionQuery === null) {
      e.preventDefault()
      submitComment()
    }
  }

  function selectMention(member: { id: string; display_name: string; first_name: string | null }) {
    const name = member.first_name || member.display_name
    // Replace the @query in the textarea with @name + space
    const before = text.slice(0, mentionStart)
    const after = text.slice(mentionStart + 1 + (mentionQuery?.length ?? 0))
    const newText = `${before}@${name} ${after}`
    setText(newText)

    if (!mentions.includes(member.id)) {
      setMentions((prev) => [...prev, member.id])
    }
    setMentionQuery(null)

    // Restore focus and put cursor after the inserted mention
    requestAnimationFrame(() => {
      const ta = textareaRef.current
      if (ta) {
        const pos = before.length + name.length + 2 // "@name "
        ta.focus()
        ta.setSelectionRange(pos, pos)
      }
    })
  }

  function submitComment() {
    const trimmed = text.trim()
    if (!trimmed || createComment.isPending) return
    createComment.mutate(
      { content: trimmed, mentions: mentions.length > 0 ? mentions : undefined },
      {
        onSuccess: () => {
          setText('')
          setMentions([])
          setMentionQuery(null)
        },
      },
    )
  }

  const filteredMembers = members.filter((m) => {
    if (mentionQuery === null) return false
    const q = mentionQuery.toLowerCase()
    const name = (m.first_name || m.display_name).toLowerCase()
    return name.includes(q)
  })

  const currentUserId = currentUser?.id ?? ''

  // Truncate long titles for the header
  const truncatedTitle =
    entityTitle.length > 32 ? entityTitle.slice(0, 32) + '…' : entityTitle

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 bg-black/40 z-50"
            onClick={onClose}
          />

          {/* Full-screen panel — slides up from bottom */}
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 320 }}
            className="fixed inset-0 z-50 flex flex-col bg-background"
            // Prevent clicks inside from closing via backdrop
            onClick={(e) => e.stopPropagation()}
          >
            {/* ── Header ─────────────────────────────────────────────── */}
            <div className="flex items-center gap-3 px-4 pt-[env(safe-area-inset-top)] border-b border-text/8">
              <button
                type="button"
                onClick={onClose}
                aria-label="Go back"
                className="flex items-center justify-center w-10 h-10 -ml-2 rounded-full text-text-muted hover:bg-text/8 active:bg-text/12 transition-colors duration-150"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="w-5 h-5"
                  aria-hidden="true"
                >
                  <path d="M19 12H5M12 5l-7 7 7 7" />
                </svg>
              </button>

              <div className="flex-1 min-w-0 py-4">
                <p className="text-xs font-medium text-text-muted uppercase tracking-wide leading-none mb-0.5">
                  Comments
                </p>
                <h2 className="text-base font-bold text-text truncate leading-tight">
                  {truncatedTitle}
                </h2>
              </div>

              {/* Comment count badge */}
              {comments.length > 0 && (
                <span className="flex-shrink-0 px-2 py-0.5 rounded-full bg-primary/12 text-primary text-xs font-semibold">
                  {comments.length}
                </span>
              )}
            </div>

            {/* ── Comment list ───────────────────────────────────────── */}
            <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-4 space-y-3">
              {isLoading ? (
                <div className="flex items-center justify-center h-32">
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                    className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full"
                    role="status"
                    aria-label="Loading comments"
                  />
                </div>
              ) : comments.length === 0 ? (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.1 }}
                  className="flex flex-col items-center justify-center h-32 gap-2"
                >
                  <div className="w-10 h-10 rounded-full bg-text/6 flex items-center justify-center">
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="w-5 h-5 text-text-muted"
                      aria-hidden="true"
                    >
                      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                    </svg>
                  </div>
                  <p className="text-sm text-text-muted font-medium">No comments yet</p>
                  <p className="text-xs text-text-muted/60">Be the first to comment</p>
                </motion.div>
              ) : (
                <AnimatePresence initial={false}>
                  {comments.map((comment) => {
                    const isOwn = comment.author_id === currentUserId
                    return (
                      <motion.div
                        key={comment.id}
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        transition={{ duration: 0.15 }}
                        className={`flex gap-3 group ${isOwn ? 'flex-row-reverse' : ''}`}
                      >
                        {/* Avatar */}
                        <div className="flex-shrink-0 pt-0.5">
                          <Avatar
                            name={comment.author_name}
                            size="sm"
                            ring={false}
                          />
                        </div>

                        {/* Bubble */}
                        <div
                          className={`flex flex-col gap-1 max-w-[75%] ${isOwn ? 'items-end' : 'items-start'}`}
                        >
                          {/* Author + timestamp */}
                          <div className={`flex items-baseline gap-2 ${isOwn ? 'flex-row-reverse' : ''}`}>
                            <span
                              className="text-xs font-semibold text-primary leading-none"
                              style={{ color: 'var(--color-primary)' }}
                            >
                              {isOwn ? 'You' : comment.author_name}
                            </span>
                            <span className="text-[11px] text-text-muted/70 leading-none">
                              {formatTime(comment.created_at)}
                            </span>
                          </div>

                          {/* Message bubble */}
                          <div
                            className={`
                              relative px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed break-words
                              ${isOwn
                                ? 'bg-primary text-white rounded-tr-sm'
                                : 'bg-surface text-text rounded-tl-sm shadow-[var(--shadow-card)]'
                              }
                            `}
                          >
                            {comment.content}

                            {/* Delete button — own messages only, appears on hover/focus */}
                            {isOwn && (
                              <button
                                type="button"
                                onClick={() => deleteComment.mutate(comment.id)}
                                aria-label="Delete comment"
                                className="
                                  absolute -top-2 -right-2
                                  w-6 h-6 rounded-full
                                  bg-surface shadow-md border border-text/8
                                  flex items-center justify-center
                                  text-text-muted hover:text-accent
                                  transition-all duration-150
                                  opacity-0 group-hover:opacity-100 focus:opacity-100
                                  scale-90 group-hover:scale-100 focus:scale-100
                                "
                              >
                                <svg
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  className="w-3 h-3"
                                  aria-hidden="true"
                                >
                                  <polyline points="3 6 5 6 21 6" />
                                  <path d="M19 6l-1 14H6L5 6" />
                                  <path d="M10 11v6M14 11v6" />
                                  <path d="M9 6V4h6v2" />
                                </svg>
                              </button>
                            )}
                          </div>
                        </div>
                      </motion.div>
                    )
                  })}
                </AnimatePresence>
              )}
              {/* Scroll anchor */}
              <div ref={listEndRef} />
            </div>

            {/* ── @mention dropdown ─────────────────────────────────── */}
            <AnimatePresence>
              {mentionQuery !== null && filteredMembers.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 4 }}
                  transition={{ duration: 0.12 }}
                  className="
                    absolute left-4 right-4 bottom-[calc(env(safe-area-inset-bottom)+5rem)]
                    bg-surface rounded-2xl shadow-[0_8px_32px_rgba(0,0,0,0.16)]
                    border border-text/8 overflow-hidden z-10
                  "
                  role="listbox"
                  aria-label="Mention suggestions"
                >
                  <div className="px-3 py-2 border-b border-text/6">
                    <p className="text-[11px] font-semibold text-text-muted uppercase tracking-wide">
                      Mention
                    </p>
                  </div>
                  {filteredMembers.map((member) => {
                    const name = member.first_name || member.display_name
                    return (
                      <button
                        key={member.id}
                        type="button"
                        role="option"
                        aria-selected="false"
                        onMouseDown={(e) => {
                          // mousedown fires before textarea blur — prevent blur first
                          e.preventDefault()
                          selectMention(member)
                        }}
                        className="
                          w-full flex items-center gap-3 px-3 py-2.5
                          hover:bg-primary/8 active:bg-primary/12
                          transition-colors duration-100 text-left
                        "
                      >
                        <Avatar name={member.display_name} src={member.avatar_url} size="sm" ring={false} />
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-text truncate">{name}</p>
                          {member.first_name && (
                            <p className="text-xs text-text-muted truncate">{member.display_name}</p>
                          )}
                        </div>
                      </button>
                    )
                  })}
                </motion.div>
              )}
            </AnimatePresence>

            {/* ── Compose area ──────────────────────────────────────── */}
            <div className="border-t border-text/8 px-4 pt-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] bg-background">
              <div className="flex items-end gap-2">
                {/* Current user avatar */}
                {currentUser && (
                  <div className="flex-shrink-0 pb-0.5">
                    <Avatar
                      name={currentUser.display_name}
                      src={currentUser.avatar_url}
                      size="sm"
                      ring={false}
                    />
                  </div>
                )}

                {/* Textarea */}
                <div className="flex-1 relative">
                  <textarea
                    ref={textareaRef}
                    value={text}
                    onChange={handleTextChange}
                    onKeyDown={handleKeyDown}
                    rows={1}
                    placeholder="Add a comment… (type @ to mention)"
                    aria-label="Comment text"
                    className="
                      w-full px-4 py-2.5 rounded-[var(--radius-input)]
                      border-2 border-text/10 bg-surface text-text text-sm
                      placeholder:text-text-muted/50
                      focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20
                      transition-all duration-200
                      resize-none overflow-hidden min-h-[2.75rem] max-h-36
                      leading-relaxed
                    "
                    style={{
                      // Auto-grow: render in a hidden element isn't needed —
                      // fieldSizing is not broadly supported; use onInput instead.
                      height: 'auto',
                    }}
                    onInput={(e) => {
                      const ta = e.currentTarget
                      ta.style.height = 'auto'
                      ta.style.height = `${Math.min(ta.scrollHeight, 144)}px`
                    }}
                  />
                </div>

                {/* Send button */}
                <button
                  type="button"
                  onClick={submitComment}
                  disabled={!text.trim() || createComment.isPending}
                  aria-label="Send comment"
                  className="
                    flex-shrink-0 w-10 h-10 rounded-full
                    bg-gradient-to-br from-primary to-primary-light
                    text-white
                    flex items-center justify-center
                    shadow-md hover:shadow-lg
                    disabled:opacity-40 disabled:pointer-events-none
                    transition-all duration-200
                    active:scale-95
                  "
                >
                  {createComment.isPending ? (
                    <motion.div
                      animate={{ rotate: 360 }}
                      transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }}
                      className="w-4 h-4 border-2 border-white border-t-transparent rounded-full"
                    />
                  ) : (
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="w-4 h-4 translate-x-[1px]"
                      aria-hidden="true"
                    >
                      <line x1="22" y1="2" x2="11" y2="13" />
                      <polygon points="22 2 15 22 11 13 2 9 22 2" />
                    </svg>
                  )}
                </button>
              </div>

              <p className="mt-1.5 ml-12 text-[11px] text-text-muted/50">
                Enter to send · Shift+Enter for new line
              </p>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
