// This file is intentionally left as a redirect stub.
// The old document detail route has been replaced by /documents/file/$fileId.
// This file should be deleted; it is kept to avoid breaking the TanStack Router
// file-based routing scan during the transition.
import { createFileRoute, Navigate } from '@tanstack/react-router'

export const Route = createFileRoute('/documents/$docId')({
  component: () => <Navigate to="/documents" />,
})
