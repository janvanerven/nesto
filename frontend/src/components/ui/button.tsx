import { motion } from 'framer-motion'
import { type ButtonHTMLAttributes, forwardRef } from 'react'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size = 'sm' | 'md' | 'lg'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
}

const variantStyles: Record<Variant, string> = {
  primary: 'bg-gradient-to-r from-primary to-primary-light text-white shadow-md hover:shadow-lg',
  secondary: 'bg-secondary/10 text-secondary hover:bg-secondary/20',
  ghost: 'bg-transparent text-text-muted hover:bg-text/5',
  danger: 'bg-accent/10 text-accent hover:bg-accent/20',
}

const sizeStyles: Record<Size, string> = {
  sm: 'px-4 py-2 text-sm',
  md: 'px-6 py-3 text-base',
  lg: 'px-8 py-4 text-lg',
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', size = 'md', className = '', children, ...props }, ref) => {
    return (
      <motion.button
        ref={ref}
        whileTap={{ scale: 0.96 }}
        className={`
          inline-flex items-center justify-center gap-2
          font-semibold rounded-full
          transition-colors duration-200
          disabled:opacity-50 disabled:pointer-events-none
          ${variantStyles[variant]}
          ${sizeStyles[size]}
          ${className}
        `}
        {...(props as any)}
      >
        {children}
      </motion.button>
    )
  },
)

Button.displayName = 'Button'
