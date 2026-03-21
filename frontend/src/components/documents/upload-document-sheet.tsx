import { useState, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Button, Input } from '@/components/ui'
import { useUploadDocument, useDocumentTags, useCreateDocumentTag } from '@/api/documents'
import type { DocumentTag } from '@/api/documents'
import { useScrollLock } from '@/utils/use-scroll-lock'

interface UploadDocumentSheetProps {
  open: boolean
  onClose: () => void
  householdId: string
}

export function UploadDocumentSheet({ open, onClose, householdId }: UploadDocumentSheetProps) {
  useScrollLock(open)
  const fileRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [newTagName, setNewTagName] = useState('')
  const [newTagCategory, setNewTagCategory] = useState<'type' | 'subject'>('type')
  const [error, setError] = useState('')

  const { data: tags = [] } = useDocumentTags(householdId)
  const uploadMutation = useUploadDocument(householdId)
  const createTagMutation = useCreateDocumentTag(householdId)

  const typeTags = tags.filter((t) => t.category === 'type')
  const subjectTags = tags.filter((t) => t.category === 'subject')

  const reset = () => {
    setFile(null)
    setSelectedTags([])
    setNewTagName('')
    setError('')
    if (fileRef.current) fileRef.current.value = ''
  }

  const handleClose = () => {
    reset()
    onClose()
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f) {
      if (f.size > 25 * 1024 * 1024) {
        setError('File too large. Max 25 MB.')
        return
      }
      setFile(f)
      setError('')
    }
  }

  const toggleTag = (tagId: string) => {
    setSelectedTags((prev) =>
      prev.includes(tagId) ? prev.filter((id) => id !== tagId) : [...prev, tagId],
    )
  }

  const handleCreateTag = async () => {
    if (!newTagName.trim()) return
    try {
      const tag = await createTagMutation.mutateAsync({
        name: newTagName.trim(),
        category: newTagCategory,
      })
      setSelectedTags((prev) => [...prev, tag.id])
      setNewTagName('')
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to create tag'
      setError(msg)
    }
  }

  const handleUpload = async () => {
    if (!file) return
    setError('')
    try {
      await uploadMutation.mutateAsync({ file, tagIds: selectedTags })
      handleClose()
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Upload failed'
      setError(msg)
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 bg-black/30 z-40"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={handleClose}
          />
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="fixed bottom-0 left-0 right-0 bg-surface rounded-t-3xl p-6 pb-[env(safe-area-inset-bottom)] z-50 max-w-lg mx-auto max-h-[85vh] overflow-y-auto"
          >
            <div className="w-12 h-1.5 bg-text/10 rounded-full mx-auto mb-6" />
            <h2 className="text-lg font-bold text-text mb-4">Upload Document</h2>

            {/* File picker */}
            <div className="mb-4">
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,application/pdf"
                onChange={handleFileChange}
                className="hidden"
              />
              {file ? (
                <div className="bg-background rounded-xl p-3 flex items-center justify-between">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-text truncate">{file.name}</p>
                    <p className="text-xs text-text-muted">{(file.size / 1024 / 1024).toFixed(1)} MB</p>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setFile(null)
                      if (fileRef.current) fileRef.current.value = ''
                    }}
                  >
                    Change
                  </Button>
                </div>
              ) : (
                <Button
                  variant="secondary"
                  className="w-full"
                  onClick={() => fileRef.current?.click()}
                >
                  Choose file
                </Button>
              )}
            </div>

            {/* Type tags */}
            {typeTags.length > 0 && (
              <div className="mb-3">
                <p className="text-sm font-medium text-text mb-1">Type</p>
                <div className="flex flex-wrap gap-2">
                  {typeTags.map((tag) => (
                    <TagPill
                      key={tag.id}
                      tag={tag}
                      selected={selectedTags.includes(tag.id)}
                      onClick={() => toggleTag(tag.id)}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Subject tags */}
            {subjectTags.length > 0 && (
              <div className="mb-3">
                <p className="text-sm font-medium text-text mb-1">Subject</p>
                <div className="flex flex-wrap gap-2">
                  {subjectTags.map((tag) => (
                    <TagPill
                      key={tag.id}
                      tag={tag}
                      selected={selectedTags.includes(tag.id)}
                      onClick={() => toggleTag(tag.id)}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Create new tag */}
            <div className="mb-4">
              <p className="text-sm font-medium text-text mb-1">Add tag</p>
              <div className="flex gap-2">
                <Input
                  value={newTagName}
                  onChange={(e) => setNewTagName(e.target.value)}
                  placeholder="Tag name"
                  className="flex-1 !h-10"
                />
                <select
                  value={newTagCategory}
                  onChange={(e) => setNewTagCategory(e.target.value as 'type' | 'subject')}
                  className="h-10 px-2 rounded-xl bg-background text-text text-sm border border-text/10"
                >
                  <option value="type">Type</option>
                  <option value="subject">Subject</option>
                </select>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={handleCreateTag}
                  disabled={!newTagName.trim() || createTagMutation.isPending}
                >
                  +
                </Button>
              </div>
            </div>

            {error && <p className="text-xs text-accent mb-3">{error}</p>}

            <Button
              className="w-full"
              onClick={handleUpload}
              disabled={!file || uploadMutation.isPending}
            >
              {uploadMutation.isPending ? 'Uploading...' : 'Upload'}
            </Button>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}

function TagPill({
  tag,
  selected,
  onClick,
}: {
  tag: DocumentTag
  selected: boolean
  onClick: () => void
}) {
  const colors =
    tag.category === 'type'
      ? selected
        ? 'bg-primary text-white'
        : 'bg-primary/10 text-primary'
      : selected
        ? 'bg-secondary text-white'
        : 'bg-secondary/10 text-secondary'
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${colors}`}
    >
      {tag.name}
    </button>
  )
}
