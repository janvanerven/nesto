interface AvatarProps {
  src?: string | null
  name: string
  size?: 'sm' | 'md' | 'lg'
  ringColor?: string
  ring?: boolean
}

const sizeMap = { sm: 'w-8 h-8 text-xs', md: 'w-10 h-10 text-sm', lg: 'w-14 h-14 text-lg' }

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
}

function hashColor(name: string): string {
  const colors = ['#6C5CE7', '#00CEC9', '#FF6B6B', '#00B894', '#FDCB6E', '#E84393', '#0984E3']
  let hash = 0
  for (const char of name) hash = char.charCodeAt(0) + ((hash << 5) - hash)
  return colors[Math.abs(hash) % colors.length]
}

export function Avatar({ src, name, size = 'md', ringColor, ring: showRing = true }: AvatarProps) {
  const ring = ringColor || hashColor(name)

  return (
    <div
      className={`${sizeMap[size]} rounded-full flex items-center justify-center font-bold ${showRing ? 'ring-2' : ''} overflow-hidden`}
      style={showRing ? { ringColor: ring, '--tw-ring-color': ring } as React.CSSProperties : undefined}
    >
      {src ? (
        <img src={src} alt={name} className="w-full h-full object-cover" />
      ) : (
        <div
          className="w-full h-full flex items-center justify-center text-white"
          style={{ backgroundColor: ring }}
        >
          {getInitials(name)}
        </div>
      )}
    </div>
  )
}
