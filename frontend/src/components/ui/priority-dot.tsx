const priorityColors: Record<number, string> = {
  1: 'bg-priority-urgent',
  2: 'bg-priority-high',
  3: 'bg-priority-normal',
  4: 'bg-priority-low',
}

const priorityLabels: Record<number, string> = {
  1: 'Urgent',
  2: 'High',
  3: 'Normal',
  4: 'Low',
}

export function PriorityDot({ priority }: { priority: number }) {
  return (
    <span
      className={`inline-block w-2.5 h-2.5 rounded-full ${priorityColors[priority] || priorityColors[3]}`}
      title={priorityLabels[priority]}
    />
  )
}
