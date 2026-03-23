import { useNavigate } from '@tanstack/react-router'
import { Card } from '@/components/ui'
import { useAuthenticatedImage } from '@/utils/use-authenticated-image'
import { getFileThumbnailUrl } from '@/api/sekura'
import type { FileItem } from '@/api/sekura'

interface FileCardProps {
  file: FileItem
  householdId: string
}

export function FileCard({ file, householdId }: FileCardProps) {
  const navigate = useNavigate()
  const thumbnailUrl = file.has_thumbnail ? getFileThumbnailUrl(householdId, file.id) : null
  const thumbSrc = useAuthenticatedImage(thumbnailUrl)

  return (
    <Card
      interactive
      onClick={() => navigate({ to: '/documents/file/$fileId', params: { fileId: file.id } })}
      className="overflow-hidden p-0"
    >
      {/* Thumbnail or icon */}
      <div className="h-28 bg-background flex items-center justify-center overflow-hidden">
        {thumbSrc ? (
          <img
            src={thumbSrc}
            alt={file.name}
            className="w-full h-full object-cover"
          />
        ) : (
          <FileTypeIcon mimeType={file.mime_type} />
        )}
      </div>

      {/* Metadata */}
      <div className="p-3">
        <p className="text-sm font-medium text-text truncate" title={file.name}>
          {file.name}
        </p>
        <p className="text-xs text-text-muted mt-0.5">
          {formatBytes(file.size_bytes)}
        </p>
      </div>
    </Card>
  )
}

function FileTypeIcon({ mimeType }: { mimeType: string }) {
  const isImage = mimeType.startsWith('image/')
  const isPdf = mimeType === 'application/pdf'
  const isVideo = mimeType.startsWith('video/')
  const isAudio = mimeType.startsWith('audio/')

  if (isImage) {
    return (
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-text-muted/40" aria-hidden="true">
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <circle cx="8.5" cy="8.5" r="1.5" />
        <polyline points="21 15 16 10 5 21" />
      </svg>
    )
  }

  if (isPdf) {
    return (
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-accent/60" aria-hidden="true">
        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="9" y1="15" x2="15" y2="15" />
        <line x1="9" y1="11" x2="15" y2="11" />
      </svg>
    )
  }

  if (isVideo) {
    return (
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-text-muted/40" aria-hidden="true">
        <polygon points="23 7 16 12 23 17 23 7" />
        <rect x="1" y="5" width="15" height="14" rx="2" />
      </svg>
    )
  }

  if (isAudio) {
    return (
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-text-muted/40" aria-hidden="true">
        <path d="M9 18V5l12-2v13" />
        <circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
      </svg>
    )
  }

  // Generic file icon
  return (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-text-muted/40" aria-hidden="true">
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  )
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`
}
