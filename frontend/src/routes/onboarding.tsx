import { createFileRoute, Navigate, useNavigate } from '@tanstack/react-router'
import { useAuth } from 'react-oidc-context'
import { motion, AnimatePresence } from 'framer-motion'
import { useState } from 'react'
import { Button, Card, Input } from '@/components/ui'
import { useCreateHousehold, useHouseholds, useJoinHousehold } from '@/api/households'
import { useCurrentUser, useUpdateUser } from '@/api/user'

export const Route = createFileRoute('/onboarding')({
  component: OnboardingPage,
})

function OnboardingPage() {
  const auth = useAuth()
  const { data: households, isLoading: loadingHouseholds } = useHouseholds()
  const { data: user, isLoading: loadingUser } = useCurrentUser()
  const [mode, setMode] = useState<'name' | 'choose' | 'create' | 'join'>('name')

  if (!auth.isAuthenticated) return <Navigate to="/login" />
  if (loadingHouseholds || loadingUser) return <LoadingScreen />
  if (households && households.length > 0) return <Navigate to="/" />

  // Skip name step if user already has a first name
  const effectiveMode = mode === 'name' && user?.first_name ? 'choose' : mode

  return (
    <div className="min-h-dvh flex flex-col items-center justify-center px-6">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-sm"
      >
        <AnimatePresence mode="wait">
          {effectiveMode === 'name' && (
            <FirstNameStep key="name" onComplete={() => setMode('choose')} />
          )}
          {effectiveMode === 'choose' && (
            <HouseholdStep key="choose" onSelect={setMode} />
          )}
          {effectiveMode === 'create' && (
            <CreateHousehold key="create" onBack={() => setMode('choose')} />
          )}
          {effectiveMode === 'join' && (
            <JoinHousehold key="join" onBack={() => setMode('choose')} />
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  )
}

function FirstNameStep({ onComplete }: { onComplete: () => void }) {
  const [name, setName] = useState('')
  const updateUser = useUpdateUser()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    await updateUser.mutateAsync({ first_name: name.trim() })
    onComplete()
  }

  return (
    <motion.form
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, x: -20 }}
      onSubmit={handleSubmit}
      className="flex flex-col gap-4"
    >
      <h1 className="text-3xl font-extrabold text-text mb-1">Welcome to Nesto!</h1>
      <p className="text-text-muted mb-4">What should we call you?</p>
      <Input
        label="Your first name"
        placeholder="e.g. Jan"
        value={name}
        onChange={(e) => setName(e.target.value)}
        autoFocus
      />
      <Button type="submit" disabled={!name.trim() || updateUser.isPending}>
        {updateUser.isPending ? 'Saving...' : 'Continue'}
      </Button>
    </motion.form>
  )
}

function HouseholdStep({ onSelect }: { onSelect: (m: 'create' | 'join') => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0 }}
    >
      <h1 className="text-3xl font-extrabold text-text mb-2">Set up your home</h1>
      <p className="text-text-muted mb-8">Create a new household or join one.</p>
      <div className="flex flex-col gap-3">
        <Card interactive onClick={() => onSelect('create')}>
          <p className="font-semibold text-lg">Create a new household</p>
          <p className="text-sm text-text-muted mt-1">Start fresh and invite others</p>
        </Card>
        <Card interactive onClick={() => onSelect('join')}>
          <p className="font-semibold text-lg">Join with an invite code</p>
          <p className="text-sm text-text-muted mt-1">Someone shared a code with you</p>
        </Card>
      </div>
    </motion.div>
  )
}

function CreateHousehold({ onBack }: { onBack: () => void }) {
  const [name, setName] = useState('')
  const createMutation = useCreateHousehold()
  const navigate = useNavigate()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    await createMutation.mutateAsync(name.trim())
    navigate({ to: '/' })
  }

  return (
    <motion.form
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      onSubmit={handleSubmit}
      className="flex flex-col gap-4"
    >
      <Input
        label="Household name"
        placeholder="e.g. The Smith Home"
        value={name}
        onChange={(e) => setName(e.target.value)}
        autoFocus
      />
      <Button type="submit" disabled={!name.trim() || createMutation.isPending}>
        {createMutation.isPending ? 'Creating...' : 'Create household'}
      </Button>
      <Button variant="ghost" type="button" onClick={onBack}>
        Back
      </Button>
    </motion.form>
  )
}

function JoinHousehold({ onBack }: { onBack: () => void }) {
  const [code, setCode] = useState('')
  const joinMutation = useJoinHousehold()
  const navigate = useNavigate()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!code.trim()) return
    await joinMutation.mutateAsync(code.trim())
    navigate({ to: '/' })
  }

  return (
    <motion.form
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      onSubmit={handleSubmit}
      className="flex flex-col gap-4"
    >
      <Input
        label="Invite code"
        placeholder="Paste your invite code"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        autoFocus
      />
      <Button type="submit" disabled={!code.trim() || joinMutation.isPending}>
        {joinMutation.isPending ? 'Joining...' : 'Join household'}
      </Button>
      <Button variant="ghost" type="button" onClick={onBack}>
        Back
      </Button>
    </motion.form>
  )
}

function LoadingScreen() {
  return (
    <div className="min-h-dvh flex items-center justify-center">
      <div className="text-primary text-xl font-bold animate-pulse">Loading...</div>
    </div>
  )
}
