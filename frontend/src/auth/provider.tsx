import { AuthProvider as OidcProvider } from 'react-oidc-context'
import { type ReactNode } from 'react'
import { oidcConfig } from './config'

export function AuthProvider({ children }: { children: ReactNode }) {
  return (
    <OidcProvider
      {...oidcConfig}
      onSigninCallback={() => {
        // Remove the code/state from the URL after login
        window.history.replaceState({}, document.title, window.location.pathname)
      }}
    >
      {children}
    </OidcProvider>
  )
}
