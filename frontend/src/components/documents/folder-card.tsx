import { useNavigate } from '@tanstack/react-router'
import { Card } from '@/components/ui'
import type { FolderItem } from '@/api/sekura'

interface FolderCardProps {
  folder: FolderItem
}

export function FolderCard({ folder }: FolderCardProps) {
  const navigate = useNavigate()

  return (
    <Card
      interactive
      onClick={() => navigate({ to: '/documents/folder/$folderId', params: { folderId: folder.id } })}
      className="flex flex-col items-start gap-2 p-3 overflow-hidden"
    >
      <FolderIcon />
      <p className="text-sm font-semibold text-text leading-tight line-clamp-2 w-full">
        {folder.name}
      </p>
      {folder.item_count != null && (
        <p className="text-xs text-text-muted">
          {folder.item_count === 1 ? '1 item' : `${folder.item_count} items`}
        </p>
      )}
    </Card>
  )
}

function FolderIcon() {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-primary shrink-0"
      aria-hidden="true"
    >
      <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
    </svg>
  )
}
