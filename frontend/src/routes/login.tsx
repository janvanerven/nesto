import { createFileRoute, Navigate } from '@tanstack/react-router'
import { useAuth } from 'react-oidc-context'
import { motion } from 'framer-motion'
import { Button } from '@/components/ui'

export const Route = createFileRoute('/login')({
  component: LoginPage,
})

function LoginPage() {
  const auth = useAuth()

  if (auth.isAuthenticated) {
    return <Navigate to="/" />
  }

  return (
    <div className="min-h-dvh flex flex-col items-center justify-center px-6 bg-gradient-to-br from-primary/5 via-background to-secondary/5">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="text-center"
      >
        <h1 className="text-5xl font-extrabold text-primary mb-2">Nesto</h1>
        <p className="text-lg text-text-muted mb-12">Your home, organized.</p>

        <Button size="lg" onClick={() => auth.signinRedirect()}>
          Sign in
        </Button>
      </motion.div>
    </div>
  )
}
