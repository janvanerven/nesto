import { useState, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Button } from '@/components/ui'
import { useUploadFile } from '@/api/sekura'
import { useScrollLock } from '@/utils/use-scroll-lock'

interface UploadFileSheetProps {
  open: boolean
  onClose: () => void
  householdId: string
  folderId?: string
}

export function UploadFileSheet({ open, onClose, householdId, folderId }: UploadFileSheetProps) {
  useScrollLock(open)
  const fileRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState('')

  const uploadMutation = useUploadFile(householdId)

  const reset = () => {
    setFile(null)
    setError('')
    if (fileRef.current) fileRef.current.value = ''
  }

  const handleClose = () => {
    if (uploadMutation.isPending) return
    reset()
    onClose()
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    setFile(f)
    setError('')
  }

  const handleUpload = async () => {
    if (!file) return
    setError('')
    try {
      await uploadMutation.mutateAsync({ file, folderId })
      reset()
      onClose()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Upload failed')
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
            <h2 className="text-lg font-bold text-text mb-5">Upload file</h2>

            {/* File picker */}
            <input
              ref={fileRef}
              type="file"
              onChange={handleFileChange}
              className="hidden"
            />

            {file ? (
              <div className="bg-background rounded-xl p-4 mb-5 flex items-center gap-3">
                <FileIcon mimeType={file.type} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-text truncate">{file.name}</p>
                  <p className="text-xs text-text-muted mt-0.5">{formatBytes(file.size)}</p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={uploadMutation.isPending}
                  onClick={() => {
                    setFile(null)
                    if (fileRef.current) fileRef.current.value = ''
                  }}
                >
                  Change
                </Button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="w-full h-24 rounded-2xl border-2 border-dashed border-text/15 flex flex-col items-center justify-center gap-2 text-text-muted hover:border-primary hover:text-primary transition-colors mb-5"
              >
                <UploadIcon />
                <span className="text-sm font-medium">Choose a file</span>
              </button>
            )}

            {error && <p className="text-xs text-accent mb-4">{error}</p>}

            <div className="flex gap-3">
              <Button
                variant="ghost"
                className="flex-1"
                onClick={handleClose}
                disabled={uploadMutation.isPending}
              >
                Cancel
              </Button>
              <Button
                className="flex-1"
                onClick={handleUpload}
                disabled={!file || uploadMutation.isPending}
              >
                {uploadMutation.isPending ? 'Uploading...' : 'Upload'}
              </Button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}

function FileIcon({ mimeType }: { mimeType: string }) {
  const isImage = mimeType.startsWith('image/')
  const color = isImage ? 'text-primary' : 'text-text-muted'
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 ${color}`} aria-hidden="true">
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  )
}

function UploadIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="16 16 12 12 8 16" />
      <line x1="12" y1="12" x2="12" y2="21" />
      <path d="M20.39 18.39A5 5 0 0018 9h-1.26A8 8 0 103 16.3" />
    </svg>
  )
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
