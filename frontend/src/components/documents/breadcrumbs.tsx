import { Link } from '@tanstack/react-router'
import type { FolderItem } from '@/api/sekura'

interface BreadcrumbsProps {
  ancestors: FolderItem[]
  current: FolderItem | null
}

export function Breadcrumbs({ ancestors, current }: BreadcrumbsProps) {
  return (
    <div className="overflow-x-auto mb-3 -mx-1 px-1">
      <div className="flex items-center gap-1 whitespace-nowrap min-w-max">
        {/* Root link */}
        <Link
          to="/documents"
          className="text-sm text-primary font-medium shrink-0 hover:underline"
        >
          Documents
        </Link>

        {/* Ancestor folders */}
        {ancestors?.map((ancestor) => (
          <span key={ancestor.id} className="flex items-center gap-1 shrink-0">
            <ChevronIcon />
            <Link
              to="/documents/folder/$folderId"
              params={{ folderId: ancestor.id }}
              className="text-sm text-primary font-medium hover:underline"
            >
              {ancestor.name}
            </Link>
          </span>
        ))}

        {/* Current folder — non-clickable, bold */}
        {current && (
          <span className="flex items-center gap-1 shrink-0">
            <ChevronIcon />
            <span className="text-sm font-bold text-text">{current.name}</span>
          </span>
        )}
      </div>
    </div>
  )
}

function ChevronIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-text-muted shrink-0"
      aria-hidden="true"
    >
      <path d="M9 18l6-6-6-6" />
    </svg>
  )
}
