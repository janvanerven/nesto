import { createFileRoute, Navigate } from '@tanstack/react-router'
import { useAuth } from 'react-oidc-context'
import { useHouseholds } from '@/api/households'
import { FolderContents } from '@/components/documents/folder-contents'

export const Route = createFileRoute('/documents/folder/$folderId')({
  component: FolderPage,
})

function FolderPage() {
  const auth = useAuth()
  const { data: households } = useHouseholds()
  const { folderId } = Route.useParams()

  if (!auth.isAuthenticated) return <Navigate to="/login" />
  if (!households?.length) return <Navigate to="/onboarding" />

  const householdId = households[0].id

  return (
    <div className="pb-4">
      <h1 className="text-2xl font-extrabold text-text mt-2 mb-4">Documents</h1>
      <FolderContents householdId={householdId} folderId={folderId} />
    </div>
  )
}
