import { motion, type HTMLMotionProps } from 'framer-motion'

interface FabProps extends HTMLMotionProps<'button'> {
  pulse?: boolean
}

export function Fab({ pulse = false, children, ...props }: FabProps) {
  return (
    <motion.button
      whileTap={{ scale: 0.9 }}
      className={`
        fixed bottom-20 right-4
        w-14 h-14 rounded-full
        bg-gradient-to-r from-primary to-primary-light
        text-white text-2xl font-bold
        shadow-[var(--shadow-fab)]
        flex items-center justify-center
        z-50
        ${pulse ? 'animate-pulse' : ''}
      `}
      {...props}
    >
      {children}
    </motion.button>
  )
}
