# Lists Module Design (Groceries + Wishlist)

## Summary

A unified "Lists" module that serves both grocery shopping and wishlists. Users create named lists with priority, add items with freeform quantity, check items off, and archive completed lists. Shared across the household.

## Data Model

### `shopping_lists` table

| Column | Type | Notes |
|--------|------|-------|
| id | Text (UUID) | PK |
| household_id | Text | FK to households |
| name | Text | Optional — e.g. "Groceries Sat", "Birthday wishlist" |
| priority | Integer | Default 3 (1=urgent, 2=high, 3=normal, 4=low) |
| status | Text | `active` or `archived` |
| created_by | Text | FK to users |
| created_at | DateTime | server_default=func.now() |
| updated_at | DateTime | auto-update on change |

### `shopping_items` table

| Column | Type | Notes |
|--------|------|-------|
| id | Text (UUID) | PK |
| list_id | Text | FK to shopping_lists (cascade delete) |
| name | Text | "Milk", "HDMI cable" |
| quantity | Text | Freeform: "500g", "2L", "3", or blank |
| checked | Boolean | Default false |
| position | Integer | Ordering within list |
| created_at | DateTime | server_default=func.now() |

## API Endpoints

All under `/api/households/{household_id}/`:

| Method | Path | Description |
|--------|------|-------------|
| GET | /lists | List all lists (with item counts + checked counts) |
| POST | /lists | Create a list |
| PATCH | /lists/{id} | Update name/priority/status |
| DELETE | /lists/{id} | Delete list + cascade items |
| GET | /lists/{id}/items | Get items for a list |
| POST | /lists/{id}/items | Add item |
| PATCH | /lists/{id}/items/{itemId} | Update item (name, quantity, checked) |
| DELETE | /lists/{id}/items/{itemId} | Remove item |
| POST | /lists/{id}/complete | Archive list + check all items |

## Frontend

### Navigation

Add 5th tab to bottom nav: "Lists" with a cart/list icon, positioned between Calendar and Settings.

### Route: `/lists` — Main view

- Filter tabs: Active | Archived
- List cards showing: name (or "Untitled list"), priority dot, progress bar/count (3/7 items), creator avatar
- FAB to create new list
- Tap list card opens detail page

### Route: `/lists/$listId` — List detail

- Header: list name + edit icon (opens edit sheet)
- Inline "Add item" input at top (name field + quantity field + add button)
- Items as checkable rows: tap checkbox to toggle, trash icon to delete
- Checked items: dim + strike-through, sink to bottom of list
- "Complete list" button archives the list and navigates back
- Back button to `/lists`

### Sheets

- **Create list sheet**: name input (optional), priority pills. Minimal — items added on detail page.
- **Edit list sheet**: name, priority, archive button, two-step delete.

## Decisions

- **Combined module**: Groceries and wishlists use the same data model; priority + naming differentiates intent.
- **Freeform quantity**: Single text field for maximum flexibility ("500g", "2 bunches", etc.).
- **Archive on complete**: Completed lists move to archived state, viewable but hidden from active view.
- **Household-shared**: All lists visible to all household members, same as tasks/events.
- **Inline item entry**: Items added directly on the detail page, not via a bottom sheet — optimized for quick grocery entry.
- **List detail as separate route**: Keeps the lists overview clean; scales well with multiple lists.
