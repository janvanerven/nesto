import { useId } from 'react'

export function errorText(e: unknown): string {
  return e instanceof Error && e.message ? e.message : 'Something went wrong'
}

export function SheetHeader({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div className="flex items-center justify-between mb-4">
      <h2 className="text-xl font-bold text-text">{title}</h2>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="p-1.5 -mr-1.5 rounded-full text-text-muted hover:bg-text/5 transition-colors"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
  )
}

export function NotesField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const id = useId()
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-text-muted">
        Notes
      </label>
      <textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={2000}
        rows={3}
        className="px-4 py-3 rounded-[var(--radius-input)] border-2 border-text/10 bg-surface text-text text-base placeholder:text-text-muted/50 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all duration-200"
      />
    </div>
  )
}

export function FormError({ error }: { error: string | null }) {
  return error ? <p role="alert" className="text-sm text-accent">{error}</p> : null
}
