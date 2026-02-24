# UI/UX Improvements Round 1 - Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Elevate Nesto's visual polish with Outfit font, personal onboarding, dark mode, and task→reminder rename with assignee picker.

**Architecture:** Five independent improvements touching both frontend and backend. The backend changes are limited to: (1) adding `first_name` to the user model with an update endpoint, and (2) adding a household members list endpoint. All other changes are frontend-only.

**Tech Stack:** Outfit font (Google Fonts), Tailwind CSS v4 dark mode, Alembic migration, React Query hooks, Framer Motion

---

### Task 1: Outfit Font

**Files:**
- Modify: `frontend/index.html`
- Modify: `frontend/src/styles/index.css`

**Step 1: Replace Inter with Outfit in index.html**

Replace the Inter font links in `frontend/index.html` with Google Fonts Outfit:

```html
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Outfit:wght@300..700&display=swap" />
```

Remove the old Inter lines:
```html
<link rel="preconnect" href="https://rsms.me/" />
<link rel="stylesheet" href="https://rsms.me/inter/inter.css" />
```

**Step 2: Update font-family in CSS**

In `frontend/src/styles/index.css`, change the `--font-family-sans` theme variable:

```css
--font-family-sans: 'Outfit', system-ui, sans-serif;
```

**Step 3: Verify**

Run: `docker compose up -d frontend` and check the app in a browser. The font should visibly change to Outfit — rounder, more geometric terminals than Inter.

**Step 4: Commit**

```bash
git add frontend/index.html frontend/src/styles/index.css
git commit -m "feat: replace Inter with Outfit font"
```

---

### Task 2: Backend — first_name field + update endpoint

**Files:**
- Modify: `backend/app/models/user.py`
- Modify: `backend/app/schemas/user.py`
- Modify: `backend/app/services/user_service.py`
- Modify: `backend/app/routers/auth.py`
- Create: `backend/alembic/versions/<auto>_add_user_first_name.py` (via autogenerate)

**Step 1: Add first_name to User model**

In `backend/app/models/user.py`, add after the `avatar_url` field:

```python
first_name: Mapped[str | None] = mapped_column(Text, nullable=True)
```

**Step 2: Add first_name to UserResponse and create UserUpdate schema**

In `backend/app/schemas/user.py`:

```python
from pydantic import BaseModel, Field


class UserResponse(BaseModel):
    id: str
    email: str
    display_name: str
    first_name: str | None
    avatar_url: str | None
    created_at: datetime
    last_login: datetime

    model_config = {"from_attributes": True}


class UserUpdate(BaseModel):
    first_name: str = Field(min_length=1, max_length=50)
```

**Step 3: Add update_user_first_name to user_service**

In `backend/app/services/user_service.py`, add:

```python
async def update_user_first_name(db: AsyncSession, user_id: str, first_name: str) -> User:
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user.first_name = first_name
    await db.commit()
    await db.refresh(user)
    return user
```

Add the import at the top:
```python
from fastapi import HTTPException
```

**Step 4: Add PATCH /api/auth/me endpoint**

In `backend/app/routers/auth.py`, add:

```python
from app.schemas.user import UserResponse, UserUpdate
from app.services.user_service import upsert_user, update_user_first_name

@router.patch("/me", response_model=UserResponse)
async def update_me(
    body: UserUpdate,
    token: dict[str, Any] = Depends(decode_token),
    db: AsyncSession = Depends(get_db),
):
    sub = token.get("sub")
    if not sub:
        raise HTTPException(status_code=401, detail="Token missing subject")
    return await update_user_first_name(db, sub, body.first_name)
```

**Step 5: Generate and apply Alembic migration**

Run inside the backend container:
```bash
docker compose exec backend alembic revision --autogenerate -m "add user first_name"
docker compose exec backend alembic upgrade head
```

**Step 6: Test the endpoint**

Verify with curl or the frontend dev tools that `GET /api/auth/me` now returns `first_name: null` and `PATCH /api/auth/me` with `{"first_name": "Jan"}` updates it.

**Step 7: Commit**

```bash
git add backend/app/models/user.py backend/app/schemas/user.py backend/app/services/user_service.py backend/app/routers/auth.py backend/alembic/versions/
git commit -m "feat: add first_name field to user model with update endpoint"
```

---

### Task 3: Backend — household members endpoint

**Files:**
- Modify: `backend/app/services/household_service.py`
- Modify: `backend/app/routers/households.py`
- Modify: `backend/app/schemas/household.py`

**Step 1: Add MemberResponse schema**

In `backend/app/schemas/household.py`, add:

```python
class MemberResponse(BaseModel):
    id: str
    display_name: str
    first_name: str | None
    avatar_url: str | None

    model_config = {"from_attributes": True}
```

**Step 2: Add list_household_members to service**

In `backend/app/services/household_service.py`, add:

```python
from app.models.user import User

async def list_household_members(db: AsyncSession, household_id: str, user_id: str) -> list[User]:
    # Verify caller is a member
    await get_household(db, household_id, user_id)
    result = await db.execute(
        select(User)
        .join(HouseholdMember, User.id == HouseholdMember.user_id)
        .where(HouseholdMember.household_id == household_id)
    )
    return list(result.scalars().all())
```

**Step 3: Add GET /{household_id}/members route**

In `backend/app/routers/households.py`, add:

```python
from app.schemas.household import HouseholdCreate, HouseholdResponse, InviteResponse, JoinRequest, MemberResponse
from app.services.household_service import create_household, create_invite, join_household, list_user_households, list_household_members

@router.get("/{household_id}/members", response_model=list[MemberResponse])
async def members(
    household_id: str,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    return await list_household_members(db, household_id, user_id)
```

**Step 4: Verify**

```bash
docker compose exec backend python -c "print('imports ok')"
```

And test via the browser or curl that `GET /api/households/{id}/members` returns members.

**Step 5: Commit**

```bash
git add backend/app/schemas/household.py backend/app/services/household_service.py backend/app/routers/households.py
git commit -m "feat: add household members list endpoint"
```

---

### Task 4: Frontend — user API hook for update + members hook

**Files:**
- Modify: `frontend/src/api/user.ts`
- Modify: `frontend/src/api/households.ts`

**Step 1: Add useUpdateUser mutation to user.ts**

In `frontend/src/api/user.ts`:

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch, hasToken } from './client'

export interface User {
  id: string
  email: string
  display_name: string
  first_name: string | null
  avatar_url: string | null
  created_at: string
  last_login: string
}

export function useCurrentUser() {
  return useQuery({
    queryKey: ['user', 'me'],
    queryFn: () => apiFetch<User>('/auth/me'),
    enabled: hasToken(),
  })
}

export function useUpdateUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: { first_name: string }) =>
      apiFetch<User>('/auth/me', {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['user', 'me'] }),
  })
}
```

**Step 2: Add useHouseholdMembers hook to households.ts**

In `frontend/src/api/households.ts`, add:

```typescript
export interface HouseholdMember {
  id: string
  display_name: string
  first_name: string | null
  avatar_url: string | null
}

export function useHouseholdMembers(householdId: string) {
  return useQuery({
    queryKey: ['households', householdId, 'members'],
    queryFn: () => apiFetch<HouseholdMember[]>(`/households/${householdId}/members`),
    enabled: !!householdId && hasToken(),
  })
}
```

**Step 3: Commit**

```bash
git add frontend/src/api/user.ts frontend/src/api/households.ts
git commit -m "feat: add user update and household members API hooks"
```

---

### Task 5: Onboarding — first name step

**Files:**
- Modify: `frontend/src/routes/onboarding.tsx`

**Step 1: Add first name step to onboarding flow**

The onboarding page currently has modes: `'choose' | 'create' | 'join'`. Add a `'name'` step that appears first when the user has no `first_name`.

Rewrite the OnboardingPage component to add the name step:

```typescript
import { createFileRoute, Navigate, useNavigate } from '@tanstack/react-router'
import { useAuth } from 'react-oidc-context'
import { motion, AnimatePresence } from 'framer-motion'
import { useState } from 'react'
import { Button, Card, Input } from '@/components/ui'
import { useCreateHousehold, useHouseholds, useJoinHousehold } from '@/api/households'
import { useCurrentUser, useUpdateUser } from '@/api/user'

export const Route = createFileRoute('/onboarding')({
  component: OnboardingPage,
})

function OnboardingPage() {
  const auth = useAuth()
  const { data: households, isLoading: loadingHouseholds } = useHouseholds()
  const { data: user, isLoading: loadingUser } = useCurrentUser()
  const [mode, setMode] = useState<'name' | 'choose' | 'create' | 'join'>('name')

  if (!auth.isAuthenticated) return <Navigate to="/login" />
  if (loadingHouseholds || loadingUser) return <LoadingScreen />
  if (households && households.length > 0) return <Navigate to="/" />

  // Skip name step if user already has a first name
  const effectiveMode = mode === 'name' && user?.first_name ? 'choose' : mode

  return (
    <div className="min-h-dvh flex flex-col items-center justify-center px-6">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-sm"
      >
        <AnimatePresence mode="wait">
          {effectiveMode === 'name' && (
            <FirstNameStep key="name" onComplete={() => setMode('choose')} />
          )}
          {effectiveMode === 'choose' && (
            <HouseholdStep key="choose" mode="choose" onSelect={setMode} />
          )}
          {effectiveMode === 'create' && (
            <CreateHousehold key="create" onBack={() => setMode('choose')} />
          )}
          {effectiveMode === 'join' && (
            <JoinHousehold key="join" onBack={() => setMode('choose')} />
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  )
}
```

Add the FirstNameStep component:

```typescript
function FirstNameStep({ onComplete }: { onComplete: () => void }) {
  const [name, setName] = useState('')
  const updateUser = useUpdateUser()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    await updateUser.mutateAsync({ first_name: name.trim() })
    onComplete()
  }

  return (
    <motion.form
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, x: -20 }}
      onSubmit={handleSubmit}
      className="flex flex-col gap-4"
    >
      <h1 className="text-3xl font-extrabold text-text mb-1">Welcome to Nesto!</h1>
      <p className="text-text-muted mb-4">What should we call you?</p>
      <Input
        label="Your first name"
        placeholder="e.g. Jan"
        value={name}
        onChange={(e) => setName(e.target.value)}
        autoFocus
      />
      <Button type="submit" disabled={!name.trim() || updateUser.isPending}>
        {updateUser.isPending ? 'Saving...' : 'Continue'}
      </Button>
    </motion.form>
  )
}
```

Rename the existing `ChooseMode` and wrap it in the household step heading:

```typescript
function HouseholdStep({ mode, onSelect }: { mode: string; onSelect: (m: 'create' | 'join') => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0 }}
    >
      <h1 className="text-3xl font-extrabold text-text mb-2">Set up your home</h1>
      <p className="text-text-muted mb-8">Create a new household or join one.</p>
      <div className="flex flex-col gap-3">
        <Card interactive onClick={() => onSelect('create')}>
          <p className="font-semibold text-lg">Create a new household</p>
          <p className="text-sm text-text-muted mt-1">Start fresh and invite others</p>
        </Card>
        <Card interactive onClick={() => onSelect('join')}>
          <p className="font-semibold text-lg">Join with an invite code</p>
          <p className="text-sm text-text-muted mt-1">Someone shared a code with you</p>
        </Card>
      </div>
    </motion.div>
  )
}
```

Keep CreateHousehold, JoinHousehold, LoadingScreen unchanged.

**Step 2: Verify**

Clear your session storage (to reset OIDC state) or use incognito. After login, you should see the "What should we call you?" screen before the household create/join step.

**Step 3: Commit**

```bash
git add frontend/src/routes/onboarding.tsx
git commit -m "feat: add first name step to onboarding flow"
```

---

### Task 6: Dashboard — personal greeting + prominent household name

**Files:**
- Modify: `frontend/src/routes/index.tsx`

**Step 1: Update dashboard header to use first_name and bigger household name**

In `frontend/src/routes/index.tsx`, update the header section in DashboardPage:

```tsx
{/* Header */}
<div className="flex items-center justify-between mt-2 mb-6">
  <div>
    <h1 className="text-2xl font-extrabold text-text">
      {getGreeting()}, {user?.first_name || user?.display_name?.split(' ')[0] || 'there'}
    </h1>
    <p className="text-xl font-semibold text-text mt-1">{household.name}</p>
  </div>
  <Avatar name={user?.display_name || '?'} src={user?.avatar_url} />
</div>
```

Key changes:
- Use `user?.first_name` with fallback to display_name split
- Household name: `text-xl font-semibold` instead of `text-sm text-text-muted`
- Remove `text-text-muted` from household name

Also update the task summary section — replace "Upcoming tasks" with "Upcoming reminders", "View all" links to `/tasks`, and rename references:

```tsx
<h2 className="text-lg font-bold text-text">Upcoming reminders</h2>
```

And in the `EmptyState`:
```tsx
<p className="font-semibold text-text">All caught up!</p>
```

**Step 2: Commit**

```bash
git add frontend/src/routes/index.tsx
git commit -m "feat: personal greeting with first_name and prominent household name"
```

---

### Task 7: Dark Mode — CSS theme + toggle

**Files:**
- Modify: `frontend/src/styles/index.css`
- Create: `frontend/src/stores/theme-store.ts`
- Modify: `frontend/src/routes/__root.tsx`
- Modify: `frontend/src/routes/settings.tsx`

**Step 1: Add dark mode CSS variables**

In `frontend/src/styles/index.css`, add a dark mode override using Tailwind v4's `@variant dark` approach. After the existing `html` rule, add:

```css
.dark {
  --color-surface: #1E1E2E;
  --color-background: #141420;
  --color-text: #E8E8EE;
  --color-text-muted: #9CA3AF;
  --color-primary: #8B7CF0;
  --color-primary-light: #A499F7;
  --color-primary-dark: #6C5CE7;
  --shadow-card: 0 2px 8px rgba(0, 0, 0, 0.3);
  --shadow-card-hover: 0 4px 16px rgba(0, 0, 0, 0.4);
  --shadow-fab: 0 4px 12px rgba(139, 124, 240, 0.4);
}
```

**Step 2: Create theme store**

Create `frontend/src/stores/theme-store.ts`:

```typescript
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
  // Apply on initial load
  const initial = getInitialMode()
  applyTheme(initial)

  // Listen for system preference changes
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
```

**Step 3: Initialize theme in root layout**

In `frontend/src/routes/__root.tsx`, add at the top of `RootComponent` (before the existing useEffect):

```typescript
import '@/stores/theme-store' // side-effect: applies saved theme on load
```

This just ensures the store module is imported and the theme is applied before first render.

**Step 4: Add theme toggle to settings page**

In `frontend/src/routes/settings.tsx`, add a theme section between the Household card and Sign out button:

```tsx
import { useThemeStore } from '@/stores/theme-store'

// Inside SettingsPage, before the Sign out button:
<Card className="mb-4">
  <h2 className="font-bold text-text mb-3">Appearance</h2>
  <ThemeToggle />
</Card>
```

Add the ThemeToggle component:

```tsx
function ThemeToggle() {
  const { mode, setMode } = useThemeStore()
  const options: { value: 'system' | 'light' | 'dark'; label: string }[] = [
    { value: 'system', label: 'System' },
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' },
  ]

  return (
    <div className="flex gap-2">
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => setMode(opt.value)}
          className={`
            flex-1 py-2 rounded-xl text-sm font-medium transition-all
            ${mode === opt.value
              ? 'bg-primary text-white shadow-md'
              : 'bg-black/5 dark:bg-white/10 text-text-muted'
            }
          `}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}
```

**Step 5: Fix hardcoded colors in components**

Several components use hardcoded `bg-black/5`, `bg-black/10`, `bg-black/30` which will look wrong in dark mode. Update these throughout:

- In `frontend/src/components/layout/bottom-nav.tsx`: Change `border-black/5` to `border-text/5`
- In `frontend/src/routes/tasks.tsx`: Change filter button `bg-black/5` → `bg-text/5`, `bg-black/10` → `bg-text/10`
- In `frontend/src/components/tasks/create-task-sheet.tsx`: Change backdrop `bg-black/30` stays as-is (it's an overlay), but change the grab handle `bg-black/10` → `bg-text/10`, and priority button `bg-black/5` → `bg-text/5`
- In `frontend/src/routes/settings.tsx`: The invite code background `bg-background` should work fine already

**Step 6: Verify**

Toggle between system/light/dark in settings. The background, cards, text should all adapt. Check that the bottom nav, task cards, create sheet, and priority buttons all look correct.

**Step 7: Commit**

```bash
git add frontend/src/styles/index.css frontend/src/stores/theme-store.ts frontend/src/routes/__root.tsx frontend/src/routes/settings.tsx frontend/src/components/layout/bottom-nav.tsx frontend/src/routes/tasks.tsx frontend/src/components/tasks/create-task-sheet.tsx
git commit -m "feat: add dark/light mode with system preference detection"
```

---

### Task 8: Task → Reminder rename + remove category + assignee picker

**Files:**
- Modify: `frontend/src/routes/tasks.tsx`
- Modify: `frontend/src/routes/index.tsx`
- Modify: `frontend/src/components/tasks/create-task-sheet.tsx`
- Modify: `frontend/src/components/tasks/task-card.tsx`
- Modify: `frontend/src/components/layout/bottom-nav.tsx`
- Modify: `frontend/src/api/tasks.ts`

**Step 1: Rename "Tasks" → "Reminders" in bottom nav**

In `frontend/src/components/layout/bottom-nav.tsx`, change:
```typescript
{ to: '/tasks' as const, label: 'Reminders', icon: CheckIcon },
```

**Step 2: Update tasks page heading**

In `frontend/src/routes/tasks.tsx`, change:
```tsx
<h1 className="text-2xl font-extrabold text-text mt-2 mb-4">Reminders</h1>
```

And update empty state text:
```tsx
<p className="font-semibold text-text">
  {filter === 'done' ? 'No completed reminders yet' : 'No reminders yet'}
</p>
<p className="text-sm text-text-muted mt-1">
  {filter === 'done' ? 'Complete some reminders to see them here.' : 'Tap + to add your first reminder.'}
</p>
```

**Step 3: Update create sheet — remove category/due_date, add assignee picker**

Rewrite `frontend/src/components/tasks/create-task-sheet.tsx`:

```typescript
import { motion, AnimatePresence } from 'framer-motion'
import { useState } from 'react'
import { Button, Input, Avatar } from '@/components/ui'
import type { TaskCreate } from '@/api/tasks'
import type { HouseholdMember } from '@/api/households'

interface CreateReminderSheetProps {
  open: boolean
  onClose: () => void
  onSubmit: (task: TaskCreate) => void
  isPending: boolean
  members: HouseholdMember[]
}

export function CreateReminderSheet({ open, onClose, onSubmit, isPending, members }: CreateReminderSheetProps) {
  const [title, setTitle] = useState('')
  const [priority, setPriority] = useState(3)
  const [assignedTo, setAssignedTo] = useState<string | null>(null)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return
    onSubmit({
      title: title.trim(),
      priority,
      assigned_to: assignedTo || undefined,
    })
    setTitle('')
    setPriority(3)
    setAssignedTo(null)
  }

  const priorities = [
    { value: 1, label: 'Urgent', color: 'bg-priority-urgent' },
    { value: 2, label: 'High', color: 'bg-priority-high' },
    { value: 3, label: 'Normal', color: 'bg-priority-normal' },
    { value: 4, label: 'Low', color: 'bg-priority-low' },
  ]

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/30 z-40"
            onClick={onClose}
          />
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="fixed bottom-0 left-0 right-0 bg-surface rounded-t-3xl p-6 pb-[env(safe-area-inset-bottom)] z-50 max-w-lg mx-auto"
          >
            <div className="w-12 h-1.5 bg-text/10 rounded-full mx-auto mb-6" />
            <h2 className="text-xl font-bold text-text mb-4">New reminder</h2>

            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <Input
                label="What needs to be done?"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                autoFocus
              />

              {/* Assignee picker */}
              {members.length > 0 && (
                <div>
                  <label className="text-sm font-medium text-text-muted mb-2 block">Assign to</label>
                  <div className="flex gap-3 overflow-x-auto pb-1">
                    {members.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => setAssignedTo(assignedTo === m.id ? null : m.id)}
                        className={`flex flex-col items-center gap-1 min-w-[3.5rem] transition-all ${
                          assignedTo === m.id ? 'opacity-100 scale-105' : 'opacity-50'
                        }`}
                      >
                        <Avatar
                          name={m.display_name}
                          src={m.avatar_url}
                          size="md"
                          ring={assignedTo === m.id}
                        />
                        <span className="text-xs text-text-muted truncate w-full text-center">
                          {m.first_name || m.display_name.split(' ')[0]}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Priority selector */}
              <div>
                <label className="text-sm font-medium text-text-muted mb-2 block">Priority</label>
                <div className="flex gap-2">
                  {priorities.map((p) => (
                    <button
                      key={p.value}
                      type="button"
                      onClick={() => setPriority(p.value)}
                      className={`
                        flex-1 py-2 rounded-xl text-sm font-medium transition-all
                        ${priority === p.value
                          ? `${p.color} text-white shadow-md`
                          : 'bg-text/5 text-text-muted'
                        }
                      `}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              <Button type="submit" disabled={!title.trim() || isPending}>
                {isPending ? 'Adding...' : 'Add reminder'}
              </Button>
            </form>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
```

**Step 4: Add `ring` prop to Avatar component**

Check if Avatar already supports a `ring` prop. If not, in `frontend/src/components/ui/avatar.tsx`, add:

```typescript
interface AvatarProps {
  name: string
  src?: string | null
  size?: 'sm' | 'md' | 'lg'
  ring?: boolean
}
```

And conditionally add a ring class: `${ring ? 'ring-2 ring-primary' : ''}`

**Step 5: Update task-card to remove category display**

In `frontend/src/components/tasks/task-card.tsx`, remove the category badge from the card content. Remove these lines:
```tsx
{task.category && (
  <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">
    {task.category}
  </span>
)}
```

**Step 6: Update tasks page to pass members to create sheet**

In `frontend/src/routes/tasks.tsx`:

- Import `useHouseholdMembers` from `@/api/households`
- Rename `CreateTaskSheet` import to `CreateReminderSheet`
- In `TasksContent`, add: `const { data: members = [] } = useHouseholdMembers(householdId)`
- Pass `members` to the sheet: `<CreateReminderSheet ... members={members} />`

**Step 7: Remove category from frontend TaskCreate type**

In `frontend/src/api/tasks.ts`, remove `category` from `TaskCreate` interface:

```typescript
export interface TaskCreate {
  title: string
  description?: string
  priority?: number
  assigned_to?: string
}
```

**Step 8: Update dashboard to remove category references**

In `frontend/src/routes/index.tsx`, remove this line from the task preview:
```tsx
{task.category && ` · ${task.category}`}
```

**Step 9: Verify**

Check that:
- Bottom nav says "Reminders" instead of "Tasks"
- The reminders page heading says "Reminders"
- Create sheet shows assignee picker with household member avatars
- No category field in create sheet
- Task cards don't show category badge

**Step 10: Commit**

```bash
git add frontend/src/components/layout/bottom-nav.tsx frontend/src/routes/tasks.tsx frontend/src/components/tasks/create-task-sheet.tsx frontend/src/components/tasks/task-card.tsx frontend/src/routes/index.tsx frontend/src/api/tasks.ts
git commit -m "feat: rename tasks to reminders, add assignee picker, remove category"
```

Check if Avatar needs the ring prop update — if so, also:
```bash
git add frontend/src/components/ui/avatar.tsx
```

---

### Task 9: Final polish + verify all changes work together

**Files:**
- All previously modified files

**Step 1: Full smoke test**

1. Clear session storage and log in fresh
2. Verify onboarding asks for first name
3. Verify dashboard shows personal greeting with first name
4. Verify household name is prominent
5. Verify Outfit font is active (check in devtools → Computed → font-family)
6. Verify dark mode toggle works in settings (system/light/dark)
7. Verify reminder create sheet has assignee picker
8. Verify no category anywhere in the UI

**Step 2: Fix any dark mode misses**

Check all pages in dark mode for any elements that don't adapt — look for white backgrounds, invisible text, or hardcoded colors.

**Step 3: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix: dark mode polish and final adjustments"
```
