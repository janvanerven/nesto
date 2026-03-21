import { forwardRef, useId, type InputHTMLAttributes } from 'react'

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, className = '', id, ...props }, ref) => {
    // useId() generates a stable, collision-safe ID across concurrent renders
    const generatedId = useId()
    const inputId = id || generatedId

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
            border-2 border-text/10
            bg-surface text-text text-base
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
