import { useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, useNavigate } from '@tanstack/react-router'
import { Button, Card } from '@/components/ui'
import type { Proposal, ProposalType } from '@/api/assistant'
import { useCreateBirthday, type BirthdayCreate } from '@/api/birthdays'
import { useCreateTask, type TaskCreate } from '@/api/tasks'
import { useCreateEvent, type EventCreate } from '@/api/events'
import {
  useAddItemsBulk,
  useCreateShoppingList,
  type ShoppingItemCreate,
  type ShoppingListCreate,
} from '@/api/lists'
import { useHouseholdMembers, type HouseholdMember } from '@/api/households'
import { CreateBirthdaySheet } from '@/components/birthdays/create-birthday-sheet'
import { CreateReminderSheet } from '@/components/tasks/create-task-sheet'
import { CreateEventSheet } from '@/components/calendar/create-event-sheet'

type Status = 'idle' | 'saving' | 'saved' | 'error'
type Payload = Record<string, unknown>

const TYPE_META: Record<ProposalType, { label: string; accent: string; chip: string }> = {
  birthday: { label: 'New birthday', accent: 'bg-birthday', chip: 'bg-birthday/15 text-birthday' },
  task: { label: 'New reminder', accent: 'bg-primary', chip: 'bg-primary/15 text-primary' },
  event: { label: 'New event', accent: 'bg-secondary', chip: 'bg-secondary/15 text-secondary' },
  list_items: { label: 'Add to list', accent: 'bg-success', chip: 'bg-success/15 text-success' },
  grocery_list: { label: 'New grocery list', accent: 'bg-success', chip: 'bg-success/15 text-success' },
}

interface ProposalCardProps {
  proposal: Proposal
  householdId: string
  onSaved: (id: string) => void
  onDismiss: (id: string) => void
  /** True when other cards in the conversation are still unsaved (read at save time). */
  hasOtherUnsaved: (id: string) => boolean
}

export function ProposalCard({ proposal, householdId, onSaved, onDismiss, hasOtherUnsaved }: ProposalCardProps) {
  const navigate = useNavigate()
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState<string | null>(null)
  // Edited values from a sheet replace the proposed payload, so a retry after a failed sheet save keeps them.
  const [payload, setPayload] = useState<Payload>(proposal.payload)
  const [editing, setEditing] = useState(false)
  const [createdListId, setCreatedListId] = useState<string | null>(null)

  // One card targets at most one list, so the bulk mutation can be keyed here unconditionally.
  const listId = proposal.list_id ?? ''
  const createBirthday = useCreateBirthday(householdId)
  const createTask = useCreateTask(householdId)
  const createEvent = useCreateEvent(householdId)
  const createList = useCreateShoppingList(householdId)
  const addItems = useAddItemsBulk(householdId, listId)
  const { data: members = [] } = useHouseholdMembers(householdId)

  const meta = TYPE_META[proposal.type]
  const canEdit = proposal.type === 'birthday' || proposal.type === 'task' || proposal.type === 'event'

  async function save(data: Payload) {
    setPayload(data)
    setStatus('saving')
    setError(null)
    try {
      switch (proposal.type) {
        case 'birthday':
          await createBirthday.mutateAsync(data as unknown as BirthdayCreate)
          break
        case 'task':
          await createTask.mutateAsync(data as unknown as TaskCreate)
          break
        case 'event':
          await createEvent.mutateAsync(data as unknown as EventCreate)
          break
        case 'list_items':
          if (!listId) throw new Error('This proposal has no list')
          await addItems.mutateAsync({ items: (data.items ?? []) as ShoppingItemCreate[] })
          break
        case 'grocery_list': {
          const list = await createList.mutateAsync(data as unknown as ShoppingListCreate)
          setStatus('saved')
          onSaved(proposal.id)
          // Navigating away would silently drop the other unsaved cards, so only do it when none remain.
          if (hasOtherUnsaved(proposal.id)) setCreatedListId(list.id)
          else navigate({ to: '/lists/$listId', params: { listId: list.id }, search: { suggest: 1 } })
          return
        }
      }
      setStatus('saved')
      onSaved(proposal.id)
    } catch (err) {
      setStatus('error')
      setError(err instanceof Error && err.message ? err.message : 'Could not save')
    }
  }

  const listItems = proposal.type === 'list_items' && Array.isArray(payload.items)
    ? (payload.items as ShoppingItemCreate[])
    : []

  return (
    <>
      <Card className="relative overflow-hidden">
        <span className={`absolute left-0 top-0 bottom-0 w-1.5 ${meta.accent}`} aria-hidden />
        <div className="pl-1.5">
          <span className={`inline-block text-[11px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${meta.chip}`}>
            {meta.label}
          </span>
          <p className="mt-2 text-base font-semibold text-text leading-snug">{proposal.summary}</p>

          {listItems.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {listItems.map((item, i) => (
                <span key={i} className="text-xs font-medium text-text bg-text/5 rounded-full px-2.5 py-1">
                  {item.name}
                  {item.quantity ? <span className="text-text-muted"> · {item.quantity}</span> : null}
                </span>
              ))}
            </div>
          )}

          {status === 'saved' ? (
            <div className="mt-3 flex items-center justify-between gap-3">
              <span className="text-sm font-bold text-success">✓ Saved</span>
              <SavedLink type={proposal.type} listId={listId} createdListId={createdListId} />
            </div>
          ) : (
            <>
              {error && <p className="mt-2 text-sm font-medium text-accent" role="alert">{error}</p>}
              <div className="mt-3 flex items-center gap-2">
                <Button size="sm" onClick={() => save(payload)} disabled={status === 'saving'}>
                  {status === 'saving' ? 'Saving...' : status === 'error' ? 'Retry' : 'Save'}
                </Button>
                {canEdit && (
                  <Button size="sm" variant="ghost" onClick={() => setEditing(true)} disabled={status === 'saving'}>
                    Edit
                  </Button>
                )}
                <button
                  type="button"
                  onClick={() => onDismiss(proposal.id)}
                  disabled={status === 'saving'}
                  className="ml-auto text-sm font-medium text-text-muted px-2 py-2 disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            </>
          )}
        </div>
      </Card>

      {/* Portalled so the fixed-position sheets aren't trapped by the animated card's transform */}
      {canEdit && createPortal(
        <EditSheet
          type={proposal.type}
          open={editing}
          payload={payload}
          members={members}
          isPending={status === 'saving'}
          onClose={() => setEditing(false)}
          onSubmit={(data) => {
            setEditing(false)
            save(data)
          }}
        />,
        document.body,
      )}
    </>
  )
}

function SavedLink({ type, listId, createdListId }: { type: ProposalType; listId: string; createdListId: string | null }) {
  const cls = 'text-sm font-semibold text-primary'
  switch (type) {
    case 'birthday':
      return <Link to="/birthdays" className={cls}>View birthdays →</Link>
    case 'task':
      return <Link to="/tasks" className={cls}>View reminders →</Link>
    case 'event':
      return <Link to="/calendar" className={cls}>View calendar →</Link>
    case 'grocery_list':
      return createdListId
        ? <Link to="/lists/$listId" params={{ listId: createdListId }} search={{ suggest: 1 }} className={cls}>Open list →</Link>
        : null
    default:
      return listId
        ? <Link to="/lists/$listId" params={{ listId }} className={cls}>View list →</Link>
        : <Link to="/lists" className={cls}>View lists →</Link>
  }
}

interface EditSheetProps {
  type: ProposalType
  open: boolean
  payload: Payload
  members: HouseholdMember[]
  isPending: boolean
  onClose: () => void
  onSubmit: (data: Payload) => void
}

function EditSheet({ type, open, payload, members, isPending, onClose, onSubmit }: EditSheetProps) {
  const submit = (data: object) => onSubmit({ ...data })
  switch (type) {
    case 'birthday':
      return (
        <CreateBirthdaySheet
          open={open}
          onClose={onClose}
          onSubmit={submit}
          isPending={isPending}
          initialValues={payload as Partial<BirthdayCreate>}
        />
      )
    case 'task':
      return (
        <CreateReminderSheet
          open={open}
          onClose={onClose}
          onSubmit={submit}
          isPending={isPending}
          members={members}
          initialValues={payload as Partial<TaskCreate>}
        />
      )
    case 'event':
      return (
        <CreateEventSheet
          open={open}
          onClose={onClose}
          onSubmit={submit}
          isPending={isPending}
          members={members}
          defaultDate={new Date()}
          initialValues={payload as Partial<EventCreate>}
        />
      )
    default:
      return null
  }
}
