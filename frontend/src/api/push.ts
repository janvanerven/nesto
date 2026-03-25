import { useMutation } from '@tanstack/react-query'
import { apiFetch } from './client'
import { vapidPublicKey } from '@/auth/config'

function urlBase64ToUint8Array(base64String: string): ArrayBuffer {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = window.atob(base64)
  const arr = Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)))
  return arr.buffer as ArrayBuffer
}

function arrayBufferToBase64Url(buf: ArrayBuffer): string {
  let binary = ''
  const bytes = new Uint8Array(buf)
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export async function getSwRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null
  try {
    return await navigator.serviceWorker.ready
  } catch {
    return null
  }
}

export async function getCurrentPushSubscription(): Promise<PushSubscription | null> {
  const reg = await getSwRegistration()
  if (!reg) return null
  return reg.pushManager.getSubscription()
}

export async function subscribeToPush(): Promise<PushSubscription | null> {
  if (!vapidPublicKey) {
    console.warn('VAPID_PUBLIC_KEY not configured')
    return null
  }
  const reg = await getSwRegistration()
  if (!reg) return null
  return reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
  })
}

interface PushSubscriptionPayload {
  endpoint: string
  p256dh: string
  auth: string
}

function serializeSubscription(sub: PushSubscription): PushSubscriptionPayload {
  const key = sub.getKey('p256dh')
  const auth = sub.getKey('auth')
  return {
    endpoint: sub.endpoint,
    p256dh: key ? arrayBufferToBase64Url(key) : '',
    auth: auth ? arrayBufferToBase64Url(auth) : '',
  }
}

export function useSavePushSubscription() {
  return useMutation({
    mutationFn: (sub: PushSubscription) =>
      apiFetch<void>('/auth/me/push-subscription', {
        method: 'POST',
        body: JSON.stringify(serializeSubscription(sub)),
      }),
  })
}

export function useDeletePushSubscription() {
  return useMutation({
    mutationFn: (endpoint: string) =>
      apiFetch<void>(`/auth/me/push-subscription?endpoint=${encodeURIComponent(endpoint)}`, {
        method: 'DELETE',
      }),
  })
}

const PUSH_DISMISSED_KEY = 'nesto-push-dismissed'
const PUSH_DISMISSED_TTL_MS = 7 * 24 * 60 * 60 * 1000

export function wasPushRecentlyDismissed(): boolean {
  const ts = localStorage.getItem(PUSH_DISMISSED_KEY)
  if (!ts) return false
  return Date.now() - parseInt(ts, 10) < PUSH_DISMISSED_TTL_MS
}

export function recordPushDismissal(): void {
  localStorage.setItem(PUSH_DISMISSED_KEY, String(Date.now()))
}
