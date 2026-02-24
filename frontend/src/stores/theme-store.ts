import { create } from 'zustand'

type ThemeMode = 'system' | 'light' | 'dark'

interface ThemeStore {
  mode: ThemeMode
  setMode: (mode: ThemeMode) => void
}

function getInitialMode(): ThemeMode {
  return (localStorage.getItem('nesto-theme') as ThemeMode) || 'system'
}

function applyTheme(mode: ThemeMode) {
  const isDark =
    mode === 'dark' || (mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.classList.toggle('dark', isDark)
  localStorage.setItem('nesto-theme', mode)
}

export const useThemeStore = create<ThemeStore>((set) => {
  const initial = getInitialMode()
  applyTheme(initial)

  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    const current = (localStorage.getItem('nesto-theme') as ThemeMode) || 'system'
    if (current === 'system') applyTheme('system')
  })

  return {
    mode: initial,
    setMode: (mode) => {
      applyTheme(mode)
      set({ mode })
    },
  }
})
