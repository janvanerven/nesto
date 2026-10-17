import { useId, useState } from 'react'
import { Button, Input } from '@/components/ui'
import {
  useAiSettings,
  useSaveAiSettings,
  useDeleteAiSettings,
  useTestAiSettings,
} from '@/api/assistant'

function errorMessage(e: unknown, fallback: string) {
  return e instanceof Error ? e.message : fallback
}

export function AssistantSettings({ householdId }: { householdId: string }) {
  const { data: settings, isLoading } = useAiSettings(householdId)
  const saveMutation = useSaveAiSettings(householdId)
  const deleteMutation = useDeleteAiSettings(householdId)
  const testMutation = useTestAiSettings(householdId)
  const modelId = useId()
  const [apiKey, setApiKey] = useState('')
  const [modelDraft, setModelDraft] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [confirmRemove, setConfirmRemove] = useState(false)

  if (isLoading || !settings) {
    return <div className="h-10 bg-background rounded-xl animate-pulse" />
  }

  const model = modelDraft ?? settings.model

  // With a saved key, changing the model saves immediately; without one the
  // choice is held locally and sent together with the key on Save.
  const handleModelChange = async (value: string) => {
    setModelDraft(value)
    setError('')
    setTestResult(null)
    if (!settings.has_key) return
    try {
      await saveMutation.mutateAsync({ model: value })
      setModelDraft(null)
    } catch (e: unknown) {
      setModelDraft(null)
      setError(errorMessage(e, 'Failed to save model'))
    }
  }

  const handleSave = async () => {
    const key = apiKey.trim()
    if (!key) return
    setError('')
    setTestResult(null)
    try {
      await saveMutation.mutateAsync({ api_key: key, model })
      setApiKey('')
      setModelDraft(null)
    } catch (e: unknown) {
      setError(errorMessage(e, 'Failed to save API key'))
    }
  }

  const handleTest = async () => {
    setTestResult(null)
    try {
      const result = await testMutation.mutateAsync()
      setTestResult({ ok: result.ok, message: result.ok ? `Key works · ${result.label}` : 'Key test failed' })
    } catch (e: unknown) {
      setTestResult({ ok: false, message: errorMessage(e, 'Test failed') })
    }
  }

  const handleRemove = async () => {
    setConfirmRemove(false)
    setTestResult(null)
    setError('')
    try {
      await deleteMutation.mutateAsync()
      setModelDraft(null)
    } catch (e: unknown) {
      setError(errorMessage(e, 'Failed to remove API key'))
    }
  }

  return (
    <div>
      {settings.has_key ? (
        <div className="flex items-center gap-2 mb-3">
          <span className="w-2.5 h-2.5 rounded-full bg-green-500 shrink-0" />
          <p className="text-sm text-text">Key set · {settings.label}</p>
        </div>
      ) : (
        <p className="text-sm text-text-muted mb-3">
          Add an OpenRouter API key to enable the household assistant.
        </p>
      )}

      <div className="mb-3">
        <label htmlFor={modelId} className="text-sm font-medium text-text-muted mb-1.5 block">
          Model
        </label>
        <select
          id={modelId}
          value={model}
          onChange={(e) => handleModelChange(e.target.value)}
          disabled={saveMutation.isPending}
          className="w-full h-12 px-3 rounded-[var(--radius-input)] border-2 border-text/10 bg-surface text-text text-base focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/30 transition-all"
        >
          {settings.models.map((m) => (
            <option key={m.id} value={m.id}>{m.label}</option>
          ))}
        </select>
      </div>

      <Input
        label={settings.has_key ? 'Replace API key' : 'OpenRouter API key'}
        type="password"
        autoComplete="off"
        value={apiKey}
        onChange={(e) => setApiKey(e.target.value)}
        placeholder="sk-or-..."
        className="mb-3 !h-10"
      />

      {error && <p className="text-xs text-accent mb-3">{error}</p>}

      {testResult && (
        <div
          className={`text-xs rounded-xl p-3 mb-3 ${
            testResult.ok
              ? 'bg-green-500/10 text-green-600 dark:text-green-400'
              : 'bg-accent/10 text-accent'
          }`}
        >
          {testResult.message}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          onClick={handleSave}
          disabled={!apiKey.trim() || saveMutation.isPending}
        >
          {saveMutation.isPending ? 'Saving...' : 'Save'}
        </Button>

        {settings.has_key && (
          <>
            <Button
              size="sm"
              variant="secondary"
              onClick={handleTest}
              disabled={testMutation.isPending}
            >
              {testMutation.isPending ? 'Testing...' : 'Test'}
            </Button>

            {confirmRemove ? (
              <>
                <Button size="sm" variant="danger" onClick={handleRemove} disabled={deleteMutation.isPending}>
                  {deleteMutation.isPending ? '...' : 'Confirm'}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmRemove(false)}>
                  Cancel
                </Button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmRemove(true)}
                className="text-xs text-accent font-medium px-2"
              >
                Remove
              </button>
            )}
          </>
        )}
      </div>

      <p className="text-xs text-text-muted mt-4">
        Requests go to OpenRouter with data collection turned off. The person whose key is saved pays for everyone in the household — consider setting a credit limit on the key.
      </p>
    </div>
  )
}
