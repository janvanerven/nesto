import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Button, Input } from '@/components/ui'
import { useCreateCalendarConnection } from '@/api/calendar-sync'
import { useScrollLock } from '@/utils/use-scroll-lock'

interface AddCalendarSheetProps {
  open: boolean
  onClose: () => void
}

const PROVIDERS = [
  { value: 'icloud', label: 'iCloud', hint: 'https://caldav.icloud.com' },
  { value: 'nextcloud', label: 'Nextcloud', hint: 'https://your-server.com/remote.php/dav' },
  { value: 'caldav', label: 'Other', hint: 'https://...' },
] as const

const COLORS = ['#6C5CE7', '#00CEC9', '#FF6B6B', '#FDCB6E', '#00B894', '#E17055', '#0984E3', '#A29BFE']

export function AddCalendarSheet({ open, onClose }: AddCalendarSheetProps) {
  useScrollLock(open)

  const [step, setStep] = useState<'url' | 'name'>('url')
  const [provider, setProvider] = useState<string>('caldav')
  const [serverUrl, setServerUrl] = useState('')
  const [calendarUrl, setCalendarUrl] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [color, setColor] = useState(COLORS[0])
  const [error, setError] = useState('')

  const createMutation = useCreateCalendarConnection()

  const reset = () => {
    setStep('url')
    setProvider('caldav')
    setServerUrl('')
    setCalendarUrl('')
    setUsername('')
    setPassword('')
    setName('')
    setColor(COLORS[0])
    setError('')
  }

  const handleClose = () => {
    reset()
    onClose()
  }

  const handleValidate = () => {
    if (!serverUrl || !calendarUrl || !username || !password) {
      setError('All fields are required')
      return
    }
    setError('')
    setStep('name')
    if (!name) setName(`${PROVIDERS.find(p => p.value === provider)?.label || 'Calendar'}`)
  }

  const handleSubmit = async () => {
    if (!name.trim()) return
    setError('')
    try {
      await createMutation.mutateAsync({
        name: name.trim(),
        provider,
        server_url: serverUrl,
        calendar_url: calendarUrl,
        username,
        password,
        color,
      })
      handleClose()
    } catch (e: any) {
      setError(e?.message || 'Failed to connect')
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

            {step === 'url' && (
              <>
                <h2 className="text-lg font-bold text-text mb-4">Add Calendar</h2>

                <p className="text-sm font-medium text-text mb-2">Provider</p>
                <div className="flex gap-2 mb-4">
                  {PROVIDERS.map((p) => (
                    <button
                      key={p.value}
                      onClick={() => {
                        setProvider(p.value)
                        if (p.value === 'icloud') setServerUrl(p.hint)
                      }}
                      className={`flex-1 py-2 rounded-xl text-sm font-medium transition-all ${
                        provider === p.value
                          ? 'bg-primary text-white shadow-md'
                          : 'bg-text/5 text-text-muted'
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>

                {provider === 'icloud' && (
                  <div className="bg-warning/10 rounded-xl p-3 mb-4">
                    <p className="text-xs text-text-muted">
                      iCloud requires an <strong>app-specific password</strong>. Generate one at{' '}
                      <span className="text-primary">appleid.apple.com</span> under Sign-In and Security.
                    </p>
                  </div>
                )}

                <div className="space-y-3">
                  <Input
                    label="Server URL"
                    value={serverUrl}
                    onChange={(e) => setServerUrl(e.target.value)}
                    placeholder="https://caldav.example.com"
                  />
                  <Input
                    label="Calendar URL"
                    value={calendarUrl}
                    onChange={(e) => setCalendarUrl(e.target.value)}
                    placeholder="https://caldav.example.com/user/calendar/"
                  />
                  <Input
                    label="Username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                  />
                  <Input
                    label="Password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>

                {error && <p className="text-xs text-accent mt-2">{error}</p>}

                <Button className="w-full mt-4" onClick={handleValidate}>
                  Next
                </Button>
              </>
            )}

            {step === 'name' && (
              <>
                <h2 className="text-lg font-bold text-text mb-4">Calendar Details</h2>

                <Input
                  label="Display name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="My Calendar"
                  autoFocus
                />

                <p className="text-sm font-medium text-text mt-4 mb-2">Color</p>
                <div className="flex gap-2 flex-wrap">
                  {COLORS.map((c) => (
                    <button
                      key={c}
                      onClick={() => setColor(c)}
                      className={`w-8 h-8 rounded-full transition-all ${
                        color === c ? 'ring-2 ring-offset-2 ring-primary' : ''
                      }`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>

                {error && <p className="text-xs text-accent mt-3">{error}</p>}

                <div className="flex gap-2 mt-6">
                  <Button variant="ghost" className="flex-1" onClick={() => setStep('url')}>
                    Back
                  </Button>
                  <Button
                    className="flex-1"
                    onClick={handleSubmit}
                    disabled={!name.trim() || createMutation.isPending}
                  >
                    {createMutation.isPending ? 'Connecting...' : 'Add Calendar'}
                  </Button>
                </div>
              </>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
