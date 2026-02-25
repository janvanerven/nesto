import { WebStorageStateStore } from 'oidc-client-ts'

const cfg = (window as any).__NESTO_CONFIG__ || {}

export const oidcConfig = {
  authority: cfg.OIDC_AUTHORITY || import.meta.env.VITE_OIDC_AUTHORITY || '',
  client_id: cfg.OIDC_CLIENT_ID || import.meta.env.VITE_OIDC_CLIENT_ID || '',
  redirect_uri: cfg.OIDC_REDIRECT_URI || import.meta.env.VITE_OIDC_REDIRECT_URI || `${window.location.origin}/callback`,
  post_logout_redirect_uri: window.location.origin,
  scope: 'openid profile email offline_access',
  response_type: 'code',
  automaticSilentRenew: true,
  userStore: new WebStorageStateStore({ store: window.sessionStorage }),
}
