import { Outlet } from '@tanstack/react-router'
import { BottomNav } from './bottom-nav'

export function AppShell() {
  return (
    <div className="min-h-dvh bg-background pb-20">
      <main className="max-w-lg mx-auto px-4 pt-4">
        <Outlet />
      </main>
      <BottomNav />
    </div>
  )
}
