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
  secondary: 'bg-secondary text-white hover:bg-secondary-light shadow-sm',
  ghost: 'bg-text/10 text-text hover:bg-text/15',
  danger: 'bg-accent text-white hover:bg-accent-light shadow-sm',
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
