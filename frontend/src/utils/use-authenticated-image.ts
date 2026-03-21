import { useState, useEffect, useRef } from 'react'
import { getAccessToken } from '@/api/client'

export function useAuthenticatedImage(url: string | null): string | null {
  const [objectUrl, setObjectUrl] = useState<string | null>(null)
  const currentUrl = useRef<string | null>(null)

  useEffect(() => {
    if (!url) {
      if (currentUrl.current) {
        URL.revokeObjectURL(currentUrl.current)
        currentUrl.current = null
      }
      setObjectUrl(null)
      return
    }

    let cancelled = false
    const token = getAccessToken()

    fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load image')
        return res.blob()
      })
      .then((blob) => {
        if (!cancelled) {
          // Revoke previous URL before creating new one
          if (currentUrl.current) {
            URL.revokeObjectURL(currentUrl.current)
          }
          const newUrl = URL.createObjectURL(blob)
          currentUrl.current = newUrl
          setObjectUrl(newUrl)
        }
      })
      .catch(() => {
        if (!cancelled) setObjectUrl(null)
      })

    return () => {
      cancelled = true
      if (currentUrl.current) {
        URL.revokeObjectURL(currentUrl.current)
        currentUrl.current = null
      }
      setObjectUrl(null)
    }
  }, [url])

  return objectUrl
}
