# Loyalty Cards Feature Design

## Overview

Shared loyalty cards within a household. Users enter barcode numbers manually, the app renders scannable barcodes on screen. Any household member can view and use all cards.

## Data Model

One new table, household-scoped:

```
loyalty_cards
├── id (text, UUID primary key)
├── household_id (text, FK → households.id, indexed)
├── store_name (text, required)
├── barcode_number (text, required)
├── barcode_format (text, required — "code128", "ean13", "qr", "code39")
├── color (text, required — hex color like "#4F46E5")
├── created_by (text, FK → users.id)
├── created_at (datetime)
└── updated_at (datetime)
```

No child tables — a card is a single flat entity.

## API Endpoints

```
GET    /api/households/{id}/cards          — List all cards
POST   /api/households/{id}/cards          — Create card
PATCH  /api/households/{id}/cards/{cardId} — Update card
DELETE /api/households/{id}/cards/{cardId} — Delete card
```

Standard household-scoped CRUD. Follows shopping lists pattern.

## Frontend

### Routes

- `/cards` — List of all loyalty cards (grid of colored cards showing store name)
- `/cards/$cardId` — Full-screen card detail view with large scannable barcode

### Components

- `components/cards/card-card.tsx` — Card tile for the list (colored background, store name, small barcode preview)
- `components/cards/create-card-sheet.tsx` — Bottom sheet form: store name, barcode number, format dropdown, color picker
- `components/cards/edit-card-sheet.tsx` — Edit/delete form
- `components/cards/barcode-display.tsx` — Renders barcode from number+format using JsBarcode/qrcode libs

### Detail Page UX

When tapping a card, it opens full-screen with:
- Large barcode rendered at maximum width for easy scanning
- Store name displayed above
- Colored background matching the card's color
- High brightness styling to help scanners read the barcode

### Navigation

New "Cards" tab in bottom nav with credit-card icon, positioned between Lists and More.

## Dependencies

- `jsbarcode` — renders Code128, EAN-13, Code39 to SVG
- `qrcode.react` — renders QR codes as React SVG components

## Approach

Manual barcode number entry only. Camera-based scanning deferred as a future enhancement (data model supports it without changes).

## Decisions

- Shared pool model: all household members see all cards, no per-card permissions
- Color picker (user-selected palette), no store logo uploads or auto-detection
- Supported formats: Code 128, EAN-13, QR Code, Code 39
