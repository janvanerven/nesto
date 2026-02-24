import { create } from 'zustand'

interface AuthState {
  isInitialized: boolean
  setInitialized: (v: boolean) => void
}

export const useAuthStore = create<AuthState>((set) => ({
  isInitialized: false,
  setInitialized: (v) => set({ isInitialized: v }),
}))
