import { createFileRoute, Navigate, useNavigate } from '@tanstack/react-router'
import { useAuth } from 'react-oidc-context'
import { useState } from 'react'
import { useHouseholds } from '@/api/households'
import {
  useDocument,
  useDeleteDocument,
  useUpdateDocument,
  useDocumentTags,
  getDocumentFileUrl,
} from '@/api/documents'
import { useAuthenticatedImage } from '@/utils/use-authenticated-image'
import { getAccessToken } from '@/api/client'
import { Button, Card } from '@/components/ui'

export const Route = createFileRoute('/documents/$docId')({
  component: DocumentDetailPage,
})

function DocumentDetailPage() {
  const auth = useAuth()
  const { data: households } = useHouseholds()

  if (!auth.isAuthenticated) return <Navigate to="/login" />
  if (!households?.length) return <Navigate to="/onboarding" />

  return <DocumentDetail householdId={households[0].id} />
}

function DocumentDetail({ householdId }: { householdId: string }) {
  const { docId } = Route.useParams()
  const navigate = useNavigate()
  const { data: doc, isLoading } = useDocument(householdId, docId)
  const { data: allTags = [] } = useDocumentTags(householdId)
  const deleteMutation = useDeleteDocument(householdId)
  const updateMutation = useUpdateDocument(householdId)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const isImage = doc?.mime_type?.startsWith('image/')
  const fullImageUrl = doc && isImage ? getDocumentFileUrl(householdId, doc.id) : null
  const imageSrc = useAuthenticatedImage(fullImageUrl)

  const handleDelete = async () => {
    await deleteMutation.mutateAsync(docId)
    navigate({ to: '/documents' })
  }

  const handleDownload = () => {
    if (!doc) return
    const token = getAccessToken()
    const url = getDocumentFileUrl(householdId, doc.id)
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
        a.download = doc.filename
        a.click()
        // Delay revocation for Safari compatibility
        setTimeout(() => URL.revokeObjectURL(a.href), 1000)
      })
      .catch(() => {
        // Could add a toast/error state here
      })
  }

  const toggleTag = async (tagId: string) => {
    if (!doc) return
    const currentTagIds = doc.tags.map((t) => t.id)
    const newTagIds = currentTagIds.includes(tagId)
      ? currentTagIds.filter((id) => id !== tagId)
      : [...currentTagIds, tagId]
    await updateMutation.mutateAsync({ docId: doc.id, tag_ids: newTagIds })
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

  if (!doc) {
    return (
      <div className="pb-4">
        <div className="flex items-center gap-3 mt-2 mb-4">
          <button
            onClick={() => navigate({ to: '/documents' })}
            className="p-1.5 -ml-1.5 rounded-full text-text-muted hover:bg-text/5 transition-colors"
            aria-label="Back to documents"
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
          <h1 className="text-2xl font-extrabold text-text">Document not found</h1>
        </div>
        <Card className="text-center py-8">
          <p className="font-semibold text-text">This document no longer exists</p>
          <p className="text-sm text-text-muted mt-1">It may have been deleted.</p>
        </Card>
      </div>
    )
  }

  return (
    <div className="pb-4">
      {/* Header */}
      <div className="flex items-center gap-3 mt-2 mb-4">
        <button
          onClick={() => navigate({ to: '/documents' })}
          className="p-1.5 -ml-1.5 rounded-full text-text-muted hover:bg-text/5 transition-colors"
          aria-label="Back to documents"
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
        <h1 className="text-2xl font-extrabold text-text flex-1 truncate">{doc.filename}</h1>
      </div>

      {/* Preview */}
      {isImage && imageSrc ? (
        <div className="rounded-2xl overflow-hidden mb-4 bg-background">
          <img
            src={imageSrc}
            alt={doc.filename}
            className="w-full object-contain max-h-96"
          />
        </div>
      ) : (
        <Card className="flex flex-col items-center justify-center py-12 mb-4">
          <svg
            width="48"
            height="48"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-text-muted/40 mb-3"
          >
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
            <polyline points="14 2 14 8 20 8" />
          </svg>
          <p className="text-sm font-medium text-text">{doc.filename}</p>
          <p className="text-xs text-text-muted mt-1">
            {(doc.size_bytes / 1024 / 1024).toFixed(1)} MB
          </p>
        </Card>
      )}

      {/* Download button */}
      <Button variant="secondary" className="w-full mb-4" onClick={handleDownload}>
        Download
      </Button>

      {/* Info */}
      <Card className="mb-4">
        <p className="text-sm font-medium text-text">{doc.filename}</p>
        <p className="text-xs text-text-muted mt-1">
          {doc.mime_type} · {(doc.size_bytes / 1024 / 1024).toFixed(1)} MB ·{' '}
          {new Date(doc.created_at).toLocaleDateString()}
        </p>
      </Card>

      {/* Tags */}
      <Card className="mb-4">
        <p className="text-sm font-medium text-text mb-2">Tags</p>
        <div className="flex flex-wrap gap-2">
          {allTags.map((tag) => {
            const isActive = doc.tags.some((t) => t.id === tag.id)
            const colors =
              tag.category === 'type'
                ? isActive
                  ? 'bg-primary text-white'
                  : 'bg-primary/10 text-primary'
                : isActive
                  ? 'bg-secondary text-white'
                  : 'bg-secondary/10 text-secondary'
            return (
              <button
                key={tag.id}
                type="button"
                onClick={() => toggleTag(tag.id)}
                disabled={updateMutation.isPending}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${colors}`}
              >
                {tag.name}
              </button>
            )
          })}
          {allTags.length === 0 && (
            <p className="text-xs text-text-muted">No tags created yet</p>
          )}
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
            <span className="text-accent">Delete document</span>
          </Button>
        )}
      </div>
    </div>
  )
}
