import { useState, useEffect } from 'react'
import { getAccessToken } from '@/api/client'

export function useAuthenticatedImage(url: string | null): string | null {
  const [objectUrl, setObjectUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!url) {
      setObjectUrl(null)
      return
    }

    let revoked = false
    const token = getAccessToken()

    fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load image')
        return res.blob()
      })
      .then((blob) => {
        if (!revoked) {
          setObjectUrl(URL.createObjectURL(blob))
        }
      })
      .catch(() => {
        if (!revoked) setObjectUrl(null)
      })

    return () => {
      revoked = true
      setObjectUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev)
        return null
      })
    }
  }, [url])

  return objectUrl
}
