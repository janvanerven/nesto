import { forwardRef, type InputHTMLAttributes } from 'react'

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, className = '', id, ...props }, ref) => {
    const inputId = id || label?.toLowerCase().replace(/\s+/g, '-')

    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label htmlFor={inputId} className="text-sm font-medium text-text-muted">
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          className={`
            h-12 px-4 rounded-[var(--radius-input)]
            border-2 border-black/10
            bg-surface text-text
            placeholder:text-text-muted/50
            focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20
            transition-all duration-200
            ${error ? 'border-accent focus:border-accent focus:ring-accent/20' : ''}
            ${className}
          `}
          {...props}
        />
        {error && <p className="text-sm text-accent">{error}</p>}
      </div>
    )
  },
)

Input.displayName = 'Input'
