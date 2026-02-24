import { motion, type HTMLMotionProps } from 'framer-motion'
import { forwardRef } from 'react'

interface CardProps extends HTMLMotionProps<'div'> {
  interactive?: boolean
}

export const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ interactive = false, className = '', children, ...props }, ref) => {
    return (
      <motion.div
        ref={ref}
        whileTap={interactive ? { scale: 0.98 } : undefined}
        className={`
          bg-surface rounded-[var(--radius-card)] p-5
          shadow-[var(--shadow-card)]
          ${interactive ? 'cursor-pointer hover:shadow-[var(--shadow-card-hover)] transition-shadow' : ''}
          ${className}
        `}
        {...props}
      >
        {children}
      </motion.div>
    )
  },
)

Card.displayName = 'Card'
