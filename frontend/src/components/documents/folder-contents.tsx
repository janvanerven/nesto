import { useState, useEffect, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useFolderContents, useSekuraConnection } from '@/api/sekura'
import { Card } from '@/components/ui'
import { Breadcrumbs } from './breadcrumbs'
import { FolderCard } from './folder-card'
import { FileCard } from './file-card'
import { UploadFileSheet } from './upload-file-sheet'
import { CreateFolderSheet } from './create-folder-sheet'

interface FolderContentsProps {
  householdId: string
  folderId?: string
}

export function FolderContents({ householdId, folderId }: FolderContentsProps) {
  const { data: connection } = useSekuraConnection()
  const { data, isLoading, isError, error } = useFolderContents(householdId, folderId)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [showUpload, setShowUpload] = useState(false)
  const [showCreateFolder, setShowCreateFolder] = useState(false)
  const [showFabMenu, setShowFabMenu] = useState(false)

  const canWrite = connection?.configured && connection.key_scope === 'readwrite'

  // 300ms debounce for client-side search
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(timer)
  }, [search])

  const filteredFolders = useMemo(() => {
    if (!data?.folders) return []
    if (!debouncedSearch) return data.folders
    const q = debouncedSearch.toLowerCase()
    return data.folders.filter((f) => f.name.toLowerCase().includes(q))
  }, [data?.folders, debouncedSearch])

  const filteredFiles = useMemo(() => {
    if (!data?.files) return []
    if (!debouncedSearch) return data.files
    const q = debouncedSearch.toLowerCase()
    return data.files.filter((f) => f.name.toLowerCase().includes(q))
  }, [data?.files, debouncedSearch])

  const isEmpty = !isLoading && filteredFolders.length === 0 && filteredFiles.length === 0
  const hasContent = filteredFolders.length > 0 || filteredFiles.length > 0

  return (
    <div className="pb-24">
      {/* Breadcrumbs */}
      {data && (
        <Breadcrumbs
          ancestors={data.ancestors}
          current={data.folder}
        />
      )}

      {/* Search input */}
      <div className="relative mb-4">
        <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none">
          <SearchIcon />
        </div>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search files and folders..."
          className="w-full h-10 pl-9 pr-4 rounded-xl bg-surface text-text text-sm placeholder:text-text-muted border border-text/10 focus:outline-none focus:border-primary transition-colors"
        />
      </div>

      {/* Loading skeleton */}
      {isLoading && (
        <div className="grid grid-cols-2 gap-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-36 bg-surface rounded-2xl animate-pulse" />
          ))}
        </div>
      )}

      {/* Error state */}
      {isError && (
        <Card className="text-center py-8">
          <ErrorIcon />
          <p className="font-semibold text-text mt-3">Could not load contents</p>
          <p className="text-sm text-text-muted mt-1">
            {error instanceof Error ? error.message : 'Something went wrong'}
          </p>
        </Card>
      )}

      {/* Empty state */}
      {!isLoading && !isError && isEmpty && (
        <Card className="text-center py-10">
          <EmptyFolderIcon />
          <p className="font-semibold text-text mt-3">
            {debouncedSearch ? 'No results found' : 'This folder is empty'}
          </p>
          <p className="text-sm text-text-muted mt-1">
            {debouncedSearch
              ? 'Try a different search term'
              : canWrite
              ? 'Tap + to upload a file or create a folder'
              : 'Nothing here yet'}
          </p>
        </Card>
      )}

      {/* Contents grid */}
      {hasContent && (
        <div className="space-y-4">
          {/* Folders */}
          {filteredFolders.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">
                Folders
              </p>
              <motion.div className="grid grid-cols-2 gap-3">
                <AnimatePresence>
                  {filteredFolders.map((folder, i) => (
                    <motion.div
                      key={folder.id}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      transition={{ delay: i * 0.04 }}
                    >
                      <FolderCard folder={folder} />
                    </motion.div>
                  ))}
                </AnimatePresence>
              </motion.div>
            </div>
          )}

          {/* Files */}
          {filteredFiles.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">
                Files
              </p>
              <motion.div className="grid grid-cols-2 gap-3">
                <AnimatePresence>
                  {filteredFiles.map((file, i) => (
                    <motion.div
                      key={file.id}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.9 }}
                      transition={{ delay: i * 0.04 }}
                    >
                      <FileCard file={file} householdId={householdId} />
                    </motion.div>
                  ))}
                </AnimatePresence>
              </motion.div>
            </div>
          )}
        </div>
      )}

      {/* FAB — only shown when user has write access */}
      {canWrite && (
        <>
          {/* Backdrop to close FAB menu */}
          <AnimatePresence>
            {showFabMenu && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-40"
                onClick={() => setShowFabMenu(false)}
              />
            )}
          </AnimatePresence>

          {/* FAB menu items */}
          <AnimatePresence>
            {showFabMenu && (
              <div className="fixed bottom-36 right-4 z-50 flex flex-col items-end gap-2">
                <motion.div
                  initial={{ opacity: 0, scale: 0.8, y: 10 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.8, y: 10 }}
                  transition={{ delay: 0.05 }}
                >
                  <button
                    type="button"
                    onClick={() => { setShowFabMenu(false); setShowCreateFolder(true) }}
                    className="flex items-center gap-2 bg-surface shadow-lg rounded-2xl px-4 py-2.5 text-sm font-semibold text-text border border-text/10"
                  >
                    <FolderPlusIcon />
                    New folder
                  </button>
                </motion.div>
                <motion.div
                  initial={{ opacity: 0, scale: 0.8, y: 10 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.8, y: 10 }}
                  transition={{ delay: 0 }}
                >
                  <button
                    type="button"
                    onClick={() => { setShowFabMenu(false); setShowUpload(true) }}
                    className="flex items-center gap-2 bg-surface shadow-lg rounded-2xl px-4 py-2.5 text-sm font-semibold text-text border border-text/10"
                  >
                    <UploadIcon />
                    Upload file
                  </button>
                </motion.div>
              </div>
            )}
          </AnimatePresence>

          {/* Main FAB button */}
          <motion.button
            type="button"
            whileTap={{ scale: 0.9 }}
            onClick={() => setShowFabMenu((v) => !v)}
            className={`
              fixed bottom-20 right-4 z-50
              w-14 h-14 rounded-full
              bg-gradient-to-r from-primary to-primary-light
              text-white text-2xl font-bold
              shadow-[var(--shadow-fab)]
              flex items-center justify-center
              transition-transform
              ${showFabMenu ? 'rotate-45' : ''}
            `}
            aria-label="Actions"
          >
            +
          </motion.button>
        </>
      )}

      {/* Sheets */}
      <UploadFileSheet
        open={showUpload}
        onClose={() => setShowUpload(false)}
        householdId={householdId}
        folderId={folderId}
      />
      <CreateFolderSheet
        open={showCreateFolder}
        onClose={() => setShowCreateFolder(false)}
        householdId={householdId}
        parentId={folderId}
      />
    </div>
  )
}

// ─── Icons ────────────────────────────────────────────────────────────────────

function SearchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-text-muted" aria-hidden="true">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  )
}

function EmptyFolderIcon() {
  return (
    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" className="text-text-muted/30 mx-auto" aria-hidden="true">
      <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
    </svg>
  )
}

function ErrorIcon() {
  return (
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-accent/60 mx-auto" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  )
}

function FolderPlusIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-primary shrink-0" aria-hidden="true">
      <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
      <line x1="12" y1="11" x2="12" y2="17" />
      <line x1="9" y1="14" x2="15" y2="14" />
    </svg>
  )
}

function UploadIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-primary shrink-0" aria-hidden="true">
      <polyline points="16 16 12 12 8 16" />
      <line x1="12" y1="12" x2="12" y2="21" />
      <path d="M20.39 18.39A5 5 0 0018 9h-1.26A8 8 0 103 16.3" />
    </svg>
  )
}
