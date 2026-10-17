import { useLayoutEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useAssistant, type ChatMessage, type Proposal } from '@/api/assistant'
import { ProposalCard } from './proposal-card'

const MAX_MESSAGE_CHARS = 4000
// ~4 lines of text-base (24px line height) plus vertical padding
const MAX_TEXTAREA_PX = 4 * 24 + 24

/** New proposals replace the unsaved card they correct, in place; everything else is appended. */
function mergeProposals(cards: Proposal[], incoming: Proposal[], savedIds: Set<string>): Proposal[] {
  const next = [...cards]
  for (const p of incoming) {
    const idx = p.replaces && !savedIds.has(p.replaces) ? next.findIndex((c) => c.id === p.replaces) : -1
    if (idx >= 0) next[idx] = p
    else next.push(p)
  }
  return next
}

export function AssistantBox({ householdId }: { householdId: string }) {
  const assistant = useAssistant(householdId)
  const [text, setText] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [cards, setCards] = useState<Proposal[]>([])
  // A ref, not state: a card can be saved while a turn is in flight, and the merge must see it.
  const savedIds = useRef<Set<string>>(new Set())
  const [reply, setReply] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const pending = assistant.isPending
  const canSend = !pending && text.trim().length > 0
  const hasConversation = messages.length > 0 || cards.length > 0 || !!reply || !!error

  // Grow with content up to ~4 lines, then scroll
  useLayoutEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, MAX_TEXTAREA_PX)}px`
  }, [text])

  function send() {
    const content = text.trim()
    if (!content || pending) return
    // A failed turn leaves its user message in the transcript; retrying the same text reuses it.
    const last = messages[messages.length - 1]
    const transcript: ChatMessage[] = last?.role === 'user' && last.content === content
      ? messages
      : [...messages, { role: 'user', content }]
    setMessages(transcript)
    setError(null)
    assistant.mutate(
      { messages: transcript },
      {
        onSuccess: (res) => {
          setMessages([...transcript, { role: 'assistant', content: res.assistant_content }])
          setReply(res.reply)
          setCards((prev) => mergeProposals(prev, res.proposals, savedIds.current))
          setText('')
        },
        onError: (err) => {
          setError(err instanceof Error && err.message ? err.message : 'Something went wrong')
        },
      },
    )
  }

  function clear() {
    setMessages([])
    setCards([])
    savedIds.current = new Set()
    setReply(null)
    setError(null)
    setText('')
    assistant.reset()
  }

  function markSaved(id: string) {
    savedIds.current.add(id)
  }

  function dismiss(id: string) {
    setCards((prev) => prev.filter((c) => c.id !== id))
  }

  return (
    <section className="mb-6">
      <div className="relative rounded-[var(--radius-card)] p-[2px] bg-gradient-to-br from-primary via-primary-light to-secondary shadow-[var(--shadow-card)]">
        <form
          className="flex items-end gap-2 bg-surface rounded-[calc(var(--radius-card)-2px)] p-2 pl-4"
          onSubmit={(e) => {
            e.preventDefault()
            send()
          }}
        >
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                send()
              }
            }}
            rows={1}
            maxLength={MAX_MESSAGE_CHARS}
            enterKeyHint="send"
            placeholder="Add a birthday, reminder, event…"
            aria-label="Ask the assistant"
            className="flex-1 resize-none bg-transparent py-2 text-base leading-6 text-text placeholder:text-text-muted/60 focus:outline-none overflow-y-auto"
          />
          <motion.button
            type="submit"
            whileTap={{ scale: 0.9 }}
            disabled={!canSend}
            aria-label="Send"
            className="shrink-0 w-10 h-10 rounded-full flex items-center justify-center bg-gradient-to-r from-primary to-primary-light text-white shadow-md disabled:opacity-40 disabled:pointer-events-none"
          >
            {pending ? (
              <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M12 19V5M5 12l7-7 7 7" />
              </svg>
            )}
          </motion.button>
        </form>
      </div>

      <AnimatePresence initial={false}>
        {hasConversation && (
          <motion.div
            key="conversation"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="pt-3 space-y-3">
              {pending && (
                <p className="text-sm font-medium text-text-muted animate-pulse">Thinking…</p>
              )}
              {!pending && reply && (
                <p className="text-sm font-medium text-text bg-primary/10 rounded-2xl rounded-tl-sm px-4 py-2.5 whitespace-pre-wrap">
                  {reply}
                </p>
              )}
              {error && (
                <p className="text-sm font-medium text-accent bg-accent/10 rounded-2xl px-4 py-2.5" role="alert">
                  {error}
                </p>
              )}

              <AnimatePresence initial={false}>
                {cards.map((p) => (
                  <motion.div
                    key={p.id}
                    layout
                    initial={{ opacity: 0, y: 12, scale: 0.97 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, x: -40, transition: { duration: 0.18 } }}
                    transition={{ type: 'spring', damping: 24, stiffness: 300 }}
                  >
                    <ProposalCard
                      proposal={p}
                      householdId={householdId}
                      onSaved={markSaved}
                      onDismiss={dismiss}
                    />
                  </motion.div>
                ))}
              </AnimatePresence>

              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={clear}
                  disabled={pending}
                  className="text-sm font-medium text-text-muted px-2 py-1 disabled:opacity-50"
                >
                  Clear
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  )
}
