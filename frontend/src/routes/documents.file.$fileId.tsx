import { createFileRoute, Navigate, useNavigate } from '@tanstack/react-router'
import { useAuth } from 'react-oidc-context'
import { useState } from 'react'
import { useHouseholds } from '@/api/households'
import {
  useFile,
  useDeleteFile,
  useRenameFile,
  getFileDownloadUrl,
  getFileThumbnailUrl,
} from '@/api/sekura'
import { useAuthenticatedImage } from '@/utils/use-authenticated-image'
import { getAccessToken } from '@/api/client'
import { Button, Card } from '@/components/ui'
import { RenameSheet } from '@/components/documents/rename-sheet'

export const Route = createFileRoute('/documents/file/$fileId')({
  component: FileDetailPage,
})

function FileDetailPage() {
  const auth = useAuth()
  const { data: households } = useHouseholds()

  if (!auth.isAuthenticated) return <Navigate to="/login" />
  if (!households?.length) return <Navigate to="/onboarding" />

  return <FileDetail householdId={households[0].id} />
}

function FileDetail({ householdId }: { householdId: string }) {
  const { fileId } = Route.useParams()
  const navigate = useNavigate()
  const { data: file, isLoading } = useFile(householdId, fileId)
  const deleteMutation = useDeleteFile(householdId)
  const renameMutation = useRenameFile(householdId)
  const [showRename, setShowRename] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const isImage = file?.mime_type?.startsWith('image/')
  // Use thumbnail for preview if available; fall back to full download URL for images
  const previewUrl = file
    ? file.has_thumbnail
      ? getFileThumbnailUrl(householdId, file.id)
      : isImage
      ? getFileDownloadUrl(householdId, file.id)
      : null
    : null
  const imageSrc = useAuthenticatedImage(previewUrl)

  const handleDelete = async () => {
    await deleteMutation.mutateAsync({
      fileId,
      folderId: file?.folder_id ?? undefined,
    })
    // Navigate to parent folder or root
    if (file?.folder_id) {
      navigate({ to: '/documents/folder/$folderId', params: { folderId: file.folder_id } })
    } else {
      navigate({ to: '/documents' })
    }
  }

  const handleDownload = () => {
    if (!file) return
    const token = getAccessToken()
    const url = getFileDownloadUrl(householdId, file.id)
    fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then((res) => {
        if (!res.ok) throw new Error('Download failed')
        return res.blob()
      })
      .then((blob) => {
        const a = document.createElement('a')
        a.href = URL.createObjectURL(blob)
        a.download = file.name
        a.click()
        setTimeout(() => URL.revokeObjectURL(a.href), 1000)
      })
      .catch(() => {
        // Silent fail — user can retry
      })
  }

  const handleBack = () => {
    if (file?.folder_id) {
      navigate({ to: '/documents/folder/$folderId', params: { folderId: file.folder_id } })
    } else {
      navigate({ to: '/documents' })
    }
  }

  if (isLoading) {
    return (
      <div className="pb-4">
        <div className="h-10 bg-surface rounded-xl animate-pulse mt-2 mb-4" />
        <div className="h-64 bg-surface rounded-2xl animate-pulse mb-4" />
        <div className="h-8 bg-surface rounded-xl animate-pulse w-2/3" />
      </div>
    )
  }

  if (!file) {
    return (
      <div className="pb-4">
        <div className="flex items-center gap-3 mt-2 mb-4">
          <BackButton onClick={() => navigate({ to: '/documents' })} label="Back to documents" />
          <h1 className="text-2xl font-extrabold text-text">File not found</h1>
        </div>
        <Card className="text-center py-8">
          <p className="font-semibold text-text">This file no longer exists</p>
          <p className="text-sm text-text-muted mt-1">It may have been deleted.</p>
        </Card>
      </div>
    )
  }

  return (
    <div className="pb-4">
      {/* Header */}
      <div className="flex items-center gap-3 mt-2 mb-4">
        <BackButton onClick={handleBack} label="Back" />
        <h1 className="text-2xl font-extrabold text-text flex-1 truncate">{file.name}</h1>
        <button
          type="button"
          onClick={() => setShowRename(true)}
          className="p-1.5 -mr-1.5 rounded-full text-text-muted hover:bg-text/5 transition-colors"
          aria-label="Rename file"
        >
          <PencilIcon />
        </button>
      </div>

      {/* Preview */}
      {isImage && imageSrc ? (
        <div className="rounded-2xl overflow-hidden mb-4 bg-background">
          <img
            src={imageSrc}
            alt={file.name}
            className="w-full object-contain max-h-96"
          />
        </div>
      ) : (
        <Card className="flex flex-col items-center justify-center py-12 mb-4">
          <LargeFileIcon mimeType={file.mime_type} />
          <p className="text-sm font-medium text-text mt-3">{file.name}</p>
          <p className="text-xs text-text-muted mt-1">{formatBytes(file.size_bytes)}</p>
        </Card>
      )}

      {/* Download */}
      <Button variant="secondary" className="w-full mb-4" onClick={handleDownload}>
        Download
      </Button>

      {/* Metadata */}
      <Card className="mb-4">
        <p className="text-sm font-medium text-text mb-2">Details</p>
        <div className="space-y-1.5">
          <MetaRow label="Name" value={file.name} />
          <MetaRow label="Type" value={file.mime_type} />
          <MetaRow label="Size" value={formatBytes(file.size_bytes)} />
          <MetaRow label="Added" value={new Date(file.created_at).toLocaleDateString()} />
        </div>
      </Card>

      {/* Delete */}
      <div className="flex justify-end">
        {confirmDelete ? (
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              variant="danger"
              onClick={handleDelete}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? '...' : 'Confirm delete'}
            </Button>
          </div>
        ) : (
          <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(true)}>
            <span className="text-accent">Delete file</span>
          </Button>
        )}
      </div>

      {/* Rename sheet */}
      <RenameSheet
        isOpen={showRename}
        onClose={() => setShowRename(false)}
        currentName={file.name}
        onRename={async (newName) => {
          await renameMutation.mutateAsync({
            fileId: file.id,
            name: newName,
            folderId: file.folder_id ?? undefined,
          })
          setShowRename(false)
        }}
        isPending={renameMutation.isPending}
      />
    </div>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function BackButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="p-1.5 -ml-1.5 rounded-full text-text-muted hover:bg-text/5 transition-colors shrink-0"
      aria-label={label}
    >
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M15 18l-6-6 6-6" />
      </svg>
    </button>
  )
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="text-xs text-text-muted shrink-0">{label}</span>
      <span className="text-xs text-text text-right truncate">{value}</span>
    </div>
  )
}

function PencilIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  )
}

function LargeFileIcon({ mimeType }: { mimeType: string }) {
  const isPdf = mimeType === 'application/pdf'
  const color = isPdf ? 'text-accent/60' : 'text-text-muted/40'
  return (
    <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" className={color} aria-hidden="true">
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      {isPdf && (
        <>
          <line x1="9" y1="15" x2="15" y2="15" />
          <line x1="9" y1="11" x2="15" y2="11" />
        </>
      )}
    </svg>
  )
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`
}
