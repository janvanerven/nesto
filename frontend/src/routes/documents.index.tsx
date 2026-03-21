import { createFileRoute, Navigate, useNavigate } from '@tanstack/react-router'
import { useAuth } from 'react-oidc-context'
import { useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useHouseholds } from '@/api/households'
import { useDocuments, useDocumentTags, getDocumentThumbnailUrl } from '@/api/documents'
import type { Document } from '@/api/documents'
import { useAuthenticatedImage } from '@/utils/use-authenticated-image'
import { UploadDocumentSheet } from '@/components/documents/upload-document-sheet'
import { Fab, Card, Input } from '@/components/ui'

export const Route = createFileRoute('/documents/')({
  component: DocumentsPage,
})

function DocumentsPage() {
  const auth = useAuth()
  const { data: households } = useHouseholds()
  const [showUpload, setShowUpload] = useState(false)

  if (!auth.isAuthenticated) return <Navigate to="/login" />
  if (!households?.length) return <Navigate to="/onboarding" />

  return (
    <DocumentsContent
      householdId={households[0].id}
      showUpload={showUpload}
      setShowUpload={setShowUpload}
    />
  )
}

function DocumentsContent({
  householdId,
  showUpload,
  setShowUpload,
}: {
  householdId: string
  showUpload: boolean
  setShowUpload: (v: boolean) => void
}) {
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [activeTypeTag, setActiveTypeTag] = useState<string | null>(null)
  const [activeSubjectTag, setActiveSubjectTag] = useState<string | null>(null)

  const filters = useMemo(
    () => ({
      type_tag: activeTypeTag || undefined,
      subject_tag: activeSubjectTag || undefined,
      search: search || undefined,
    }),
    [activeTypeTag, activeSubjectTag, search],
  )

  const { data: documents, isLoading } = useDocuments(householdId, filters)
  const { data: tags = [] } = useDocumentTags(householdId)

  const typeTags = tags.filter((t) => t.category === 'type')
  const subjectTags = tags.filter((t) => t.category === 'subject')

  return (
    <div className="pb-4">
      <h1 className="text-2xl font-extrabold text-text mt-2 mb-4">Documents</h1>

      {/* Search */}
      <div className="mb-3">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search documents..."
        />
      </div>

      {/* Type tag filters */}
      {typeTags.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-2">
          {typeTags.map((tag) => (
            <button
              key={tag.id}
              type="button"
              onClick={() => setActiveTypeTag(activeTypeTag === tag.id ? null : tag.id)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${
                activeTypeTag === tag.id
                  ? 'bg-primary text-white'
                  : 'bg-primary/10 text-primary'
              }`}
            >
              {tag.name}
            </button>
          ))}
        </div>
      )}

      {/* Subject tag filters */}
      {subjectTags.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-4">
          {subjectTags.map((tag) => (
            <button
              key={tag.id}
              type="button"
              onClick={() => setActiveSubjectTag(activeSubjectTag === tag.id ? null : tag.id)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${
                activeSubjectTag === tag.id
                  ? 'bg-secondary text-white'
                  : 'bg-secondary/10 text-secondary'
              }`}
            >
              {tag.name}
            </button>
          ))}
        </div>
      )}

      {/* Document grid */}
      {isLoading ? (
        <div className="grid grid-cols-2 gap-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-40 bg-surface rounded-2xl animate-pulse" />
          ))}
        </div>
      ) : !documents?.length ? (
        <Card className="text-center py-8">
          <svg
            width="40"
            height="40"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="mx-auto mb-3 text-text-muted/40"
          >
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
            <polyline points="14 2 14 8 20 8" />
          </svg>
          <p className="font-semibold text-text">No documents yet</p>
          <p className="text-sm text-text-muted mt-1">Tap + to upload your first document.</p>
        </Card>
      ) : (
        <motion.div className="grid grid-cols-2 gap-3">
          <AnimatePresence>
            {documents.map((doc, i) => (
              <motion.div
                key={doc.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={{ delay: i * 0.05 }}
              >
                <DocumentCard
                  doc={doc}
                  householdId={householdId}
                  onClick={() =>
                    navigate({ to: '/documents/$docId', params: { docId: doc.id } })
                  }
                />
              </motion.div>
            ))}
          </AnimatePresence>
        </motion.div>
      )}

      <Fab pulse={!documents?.length} onClick={() => setShowUpload(true)}>
        +
      </Fab>

      <UploadDocumentSheet
        open={showUpload}
        onClose={() => setShowUpload(false)}
        householdId={householdId}
      />
    </div>
  )
}

function DocumentCard({
  doc,
  householdId,
  onClick,
}: {
  doc: Document
  householdId: string
  onClick: () => void
}) {
  const thumbnailUrl = doc.has_thumbnail ? getDocumentThumbnailUrl(householdId, doc.id) : null
  const thumbSrc = useAuthenticatedImage(thumbnailUrl)

  return (
    <Card interactive onClick={onClick} className="overflow-hidden p-0">
      <div className="h-28 bg-background flex items-center justify-center overflow-hidden">
        {thumbSrc ? (
          <img src={thumbSrc} alt={doc.filename} className="w-full h-full object-cover" />
        ) : (
          <svg
            width="32"
            height="32"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            className="text-text-muted/30"
          >
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
            <polyline points="14 2 14 8 20 8" />
          </svg>
        )}
      </div>
      <div className="p-3">
        <p className="text-sm font-medium text-text truncate">{doc.filename}</p>
        <div className="flex flex-wrap gap-1 mt-1">
          {doc.tags.slice(0, 3).map((tag) => (
            <span
              key={tag.id}
              className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                tag.category === 'type'
                  ? 'bg-primary/10 text-primary'
                  : 'bg-secondary/10 text-secondary'
              }`}
            >
              {tag.name}
            </span>
          ))}
        </div>
      </div>
    </Card>
  )
}
