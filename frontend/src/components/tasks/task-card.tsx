import { motion, useMotionValue, useTransform, type PanInfo } from 'framer-motion'
import { Card, PriorityDot } from '@/components/ui'
import type { Task } from '@/api/tasks'

interface TaskCardProps {
  task: Task
  onComplete: (id: string) => void
  onDelete: (id: string) => void
}

export function TaskCard({ task, onComplete, onDelete }: TaskCardProps) {
  const x = useMotionValue(0)
  const bgLeft = useTransform(x, [-100, 0], ['#00B894', '#00B89400'])
  const bgRight = useTransform(x, [0, 100], ['#FF6B6B00', '#FF6B6B'])

  const handleDragEnd = (_: any, info: PanInfo) => {
    if (info.offset.x < -80) {
      onComplete(task.id)
    } else if (info.offset.x > 80) {
      onDelete(task.id)
    }
  }

  const isDone = task.status === 'done'

  return (
    <div className="relative overflow-hidden rounded-[var(--radius-card)]">
      {/* Swipe backgrounds */}
      <motion.div className="absolute inset-0 flex items-center justify-start px-4" style={{ backgroundColor: bgRight }}>
        <span className="text-white font-bold text-sm">Delete</span>
      </motion.div>
      <motion.div className="absolute inset-0 flex items-center justify-end px-4" style={{ backgroundColor: bgLeft }}>
        <span className="text-white font-bold text-sm">Done</span>
      </motion.div>

      {/* Card */}
      <motion.div
        drag="x"
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={0.3}
        style={{ x }}
        onDragEnd={handleDragEnd}
      >
        <Card className={isDone ? 'opacity-60' : ''}>
          <div className="flex items-start gap-3">
            <div className="mt-1.5">
              <PriorityDot priority={task.priority} />
            </div>
            <div className="flex-1 min-w-0">
              <p className={`font-semibold text-text truncate ${isDone ? 'line-through' : ''}`}>
                {task.title}
              </p>
              <div className="flex items-center gap-2 mt-1">
                {task.due_date && (
                  <span className="text-xs text-text-muted">{task.due_date}</span>
                )}
                {task.category && (
                  <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                    {task.category}
                  </span>
                )}
              </div>
            </div>
          </div>
        </Card>
      </motion.div>
    </div>
  )
}
