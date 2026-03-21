import { createFileRoute, Navigate } from '@tanstack/react-router'
import { useAuth } from 'react-oidc-context'
import { Card } from '@/components/ui'

export const Route = createFileRoute('/documents')({
  component: DocumentsPage,
})

function DocumentsPage() {
  const auth = useAuth()
  if (!auth.isAuthenticated) return <Navigate to="/login" />

  return (
    <div className="pb-4">
      <h1 className="text-2xl font-extrabold text-text mt-2 mb-4">Documents</h1>
      <Card className="text-center py-8">
        <p className="text-4xl mb-3">&#128196;</p>
        <p className="font-semibold text-text">No documents yet</p>
        <p className="text-sm text-text-muted mt-1">Store warranties, receipts, and manuals here.</p>
      </Card>
    </div>
  )
}
