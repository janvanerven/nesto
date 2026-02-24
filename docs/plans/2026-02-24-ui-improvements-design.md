# UI/UX Improvements Round 1 - Design

## Summary

Five targeted improvements to elevate the Nesto app's polish and usability.

## 1. Typography: Outfit Font

Replace Inter with **Outfit** (Google Fonts, variable weight 300-700). Outfit is a geometric sans-serif with distinctive rounded terminals — premium feel without being childish. Works well at both display and body sizes.

- Load via Google Fonts CDN (variable font, single request)
- Use weight 400 for body, 500 for labels, 600-700 for headings
- Household name on dashboard: Outfit 600, ~1.5rem

## 2. Onboarding: First Name Step

After OIDC callback, if user has no `first_name` stored, show a welcome screen before household setup:

- Screen: "Welcome to Nesto! What should we call you?"
- Single text input + continue button
- Stores `first_name` on user model (new nullable column, Alembic migration)
- Backend: `PATCH /api/auth/me` endpoint to update first_name
- Dashboard greeting: "Good morning, Jan" using first_name (fallback to display_name)

## 3. Household Name Prominence

On the dashboard, make the household name a visual anchor:

- Outfit 600 weight, ~1.5rem size
- Positioned prominently below the greeting
- Replaces current small/muted treatment

## 4. Dark Mode

- **Default**: Follow system preference via `prefers-color-scheme`
- **Override**: Manual toggle in settings, stored in localStorage
- **Implementation**: Tailwind v4 dark variant with CSS custom properties
- **Dark palette**: Deep navy/charcoal backgrounds (#1a1a2e, #16213e), slightly desaturated accent colors
- **Toggle location**: Settings page with sun/moon icon
- **Persistence**: localStorage key `nesto-theme` with values `system`, `light`, `dark`

## 5. Task → Reminder Rename + Data Changes

UI-only rename (keep `tasks` DB table name):

- **Remove**: category field (from UI, create form, backend schema)
- **Add**: Assignee picker — horizontal avatar row of household members
- **Remove**: due_date from create form (deferred to calendar feature)
- **Keep**: title, description, priority, assigned_to, status
- **New endpoint**: `GET /api/households/{id}/members` to list members for the picker
- **Rename throughout UI**: "Tasks" → "Reminders" in nav, headings, empty states

## Out of Scope

- Date picker redesign (deferred to calendar feature)
- Calendar/reminder merge (future work)
- Rate limiting (handled by Cloudflare)
- Category removal from DB (just stop using it in UI)
