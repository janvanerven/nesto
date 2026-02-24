import { motion, AnimatePresence } from 'framer-motion'
import { useState } from 'react'
import { Button, Input } from '@/components/ui'
import type { TaskCreate } from '@/api/tasks'

interface CreateTaskSheetProps {
  open: boolean
  onClose: () => void
  onSubmit: (task: TaskCreate) => void
  isPending: boolean
}

export function CreateTaskSheet({ open, onClose, onSubmit, isPending }: CreateTaskSheetProps) {
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState('')
  const [priority, setPriority] = useState(3)
  const [dueDate, setDueDate] = useState('')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return
    onSubmit({
      title: title.trim(),
      category: category.trim() || undefined,
      priority,
      due_date: dueDate || undefined,
    })
    setTitle('')
    setCategory('')
    setPriority(3)
    setDueDate('')
  }

  const priorities = [
    { value: 1, label: 'Urgent', color: 'bg-priority-urgent' },
    { value: 2, label: 'High', color: 'bg-priority-high' },
    { value: 3, label: 'Normal', color: 'bg-priority-normal' },
    { value: 4, label: 'Low', color: 'bg-priority-low' },
  ]

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/30 z-40"
            onClick={onClose}
          />

          {/* Sheet */}
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="fixed bottom-0 left-0 right-0 bg-surface rounded-t-3xl p-6 pb-[env(safe-area-inset-bottom)] z-50 max-w-lg mx-auto"
          >
            <div className="w-12 h-1.5 bg-text/10 rounded-full mx-auto mb-6" />
            <h2 className="text-xl font-bold text-text mb-4">New task</h2>

            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <Input
                label="What needs to be done?"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                autoFocus
              />
              <Input
                label="Category"
                placeholder="e.g. kitchen, shopping"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              />
              <Input
                label="Due date"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />

              {/* Priority selector */}
              <div>
                <label className="text-sm font-medium text-text-muted mb-2 block">Priority</label>
                <div className="flex gap-2">
                  {priorities.map((p) => (
                    <button
                      key={p.value}
                      type="button"
                      onClick={() => setPriority(p.value)}
                      className={`
                        flex-1 py-2 rounded-xl text-sm font-medium transition-all
                        ${priority === p.value
                          ? `${p.color} text-white shadow-md`
                          : 'bg-text/5 text-text-muted'
                        }
                      `}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              <Button type="submit" disabled={!title.trim() || isPending}>
                {isPending ? 'Adding...' : 'Add task'}
              </Button>
            </form>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
