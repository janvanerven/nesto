# Address Book (Contacts) — Design

Date: 2026-10-18
Status: Draft for review

## 1. Intent

A friend had a baby, and Jan wanted to send a card. He didn't have the
address to hand and thought it would be handy to have it in Nesto, "just
like the birthdays". Nesto should be the household's shared address book.
It is organised the way people actually live: an address, with the people
who live there.

Success: looking up "where do Mark & Lisa live" takes seconds, birthdays and
addresses for the same person live in one place, and keeping it up to date
(a move, a new baby) is quick, including by dictating to the home-page
assistant.

## 2. Goals

1. **Contacts.** A new section, listed in the More hub. The main entry is an
   **address** (Jan thinks of it as a household) with the **people** who live
   there.
2. **People.** Each person has a name, an optional birthday, phone, email
   and notes. A person lives at no address or at one address. Several people
   can share one address.
3. **Addresses.** Each address has a display name ("Mark & Lisa Jansen"),
   street and number, postcode, city, country and notes.
4. **Two ways in** (Jan's words):
   - create an address and add its people, or
   - create a person (for example from the Birthdays page) and give them an
     address later.
5. **Birthdays become a property of people.** The Birthdays page keeps
   working as today, but shows the people who have a birthday. Adding a
   birthday there creates a person without an address. Existing birthdays
   are migrated to people. The calendar, the home page "Upcoming" list and
   the .ics feed keep showing birthdays exactly as now.
6. **Search** on names, street and city. There is no grouping; Jan said
   search is enough.
7. **Assistant.** The home-page assistant can propose:
   - a new address with people,
   - a new person,
   - changes to an existing person or address ("Mark and Lisa moved to
     Kerkstraat 5", "Mark and Lisa had a baby, Noor, born 12 October").

   As with every assistant action, it is a card the user checks and saves.
   When the assistant recognises existing people, the card shows the change
   instead of creating a duplicate.
8. **Handy actions** (*my call*):
   - "Copy for envelope" copies the address, formatted for posting, to the
     clipboard.
   - "Map" opens the address in the phone's map app.
   - Phone numbers and email addresses are tap-to-call and tap-to-mail.

## 3. Non-goals

- Syncing with phone contacts, Google or CardDAV; importing or exporting
  vCards.
- Groups or tags (family, friends, school).
- More than one address per person, address history, or relations between
  people (partner, child).
- Photos or avatars.
- Contact-related reminders. Birthdays already appear on the calendar.

## 4. Anti-goals

- Breaking anything that birthdays do today:
  - the Birthdays page,
  - calendar birthday cards and editing them from the calendar,
  - the home "Upcoming" list,
  - .ics feed entries. Their UIDs must stay stable, or every subscribed
    calendar sees duplicates.
- Losing or duplicating existing birthdays in the migration.
- The assistant creating duplicate people when the person already exists,
  or writing anything without a Save tap.
- Contacts leaking across Nesto households.

## 5. Data model

Two new tables, both scoped to a Nesto household (naming *my call*, chosen
to avoid "household", which already means the user's own Nesto household):

```
contact_addresses
  id (uuid text PK), household_id FK households CASCADE (indexed)
  label        text NOT NULL      -- "Mark & Lisa Jansen"; UI suggests one from the people's names
  street       text NOT NULL default ''   -- street + house number, one line
  postcode     text NOT NULL default ''
  city         text NOT NULL default ''
  country      text NOT NULL default ''   -- free text; empty means "home country"
  notes        text NOT NULL default ''
  created_by, created_at, updated_at

people
  id (uuid text PK), household_id FK households CASCADE (indexed)
  address_id   FK contact_addresses SET NULL, nullable (indexed)
  name         text NOT NULL
  birth_month  int nullable, birth_day int nullable, birth_year int nullable
               -- month+day both set or both null; same validation as BirthdayCreate today
  phone, email, notes  text NOT NULL default ''
  created_by, created_at, updated_at
```

**Migration** (single Alembic revision, down_revision `b7c8d9e0f1a2`):
- Every `birthdays` row becomes a `people` row with **the same id**,
  `name = person_name`, the same birth fields, and the same timestamps and
  `created_by`. Keeping the id keeps the .ics UIDs (`birthday-{id}@nesto`)
  stable.
- The `birthdays` table is then dropped.
- `downgrade` recreates `birthdays` from people that have a birthday, drops
  the new tables, and loses addresses (acceptable).

Deleting an address keeps its people by default; they become people without
an address. The UI offers "Also delete the N people" as an explicit choice.

## 6. Backend

New router: `/api/households/{id}/contacts`. Every route calls
`get_household` first, and all queries filter on `household_id`.

| Method | Path | Purpose |
|---|---|---|
| GET | `/contacts` | Everything for the screen: `{addresses: [...with people], people_without_address: [...]}`. Small data, so it is fetched in one go and searched on the client. |
| POST | `/contacts/addresses` | Create an address, optionally with new people, in **one transaction**: `{label, street, postcode, city, country, notes, people: [PersonCreate]}`. |
| PATCH / DELETE | `/contacts/addresses/{id}` | Update fields (explicit allowlist). DELETE takes `?delete_people=false`. |
| POST | `/contacts/people` | Create a person, with optional `address_id`, validated to belong to the same household. |
| PATCH / DELETE | `/contacts/people/{id}` | Update fields, including `address_id` (validated, or null to unlink). |

Assistant saves sometimes need to create an address and move people in one
go. `PATCH /contacts/people/{id}` and `POST /contacts/addresses` cover that:
`POST /contacts/addresses` also accepts `move_people: [person_id]`, so
existing people are linked in the same transaction.

**Birthdays API stays and keeps its shape** (`BirthdayResponse` with
`person_name`, `age`, and so on), served from `people`:
- `GET /birthdays`: people with a birthday, sorted as today.
- `POST /birthdays`: creates a person without an address.
- `PATCH /birthdays/{id}`: updates the person's name or birthday.
- `DELETE /birthdays/{id}`: clears the birthday if the person has an
  address, phone, email or notes; otherwise deletes the person (*my call*).
  The confirmation text on the Birthdays page doesn't change.

`birthday_service` and `feed_service` read from `people`. The feed's UID
format stays the same. The `Birthday` model is removed. Nothing else in the
frontend that uses `api/birthdays.ts` needs to change.

Validation:
- birthday rules as in `BirthdayCreate` today;
- email: light format check, empty allowed;
- phone: free text, at most 50 characters;
- all text fields: length caps (*builder's call*, in line with existing
  schemas).

## 7. Frontend

Per the sketch Jan approved:

- **`/contacts` list:**
  - A search box at the top.
  - One card per address, sorted by label: label, a single-line address, and
    the people as chips. A birthday shows on the chip (🎂 12 Oct).
  - Then the people without an address, as single cards ("No address yet").
  - Search matches person names, label, street and city, case-insensitively.
  - A FAB adds an address.
- **`/contacts/$addressId` detail:**
  - The address block, with Copy for envelope, Map and the address notes.
  - "Living here": each person with birthday (with age when known), tappable
    phone (`tel:`), tappable email (`mailto:`) and their notes.
  - "+ Add person".
  - An Edit button opens the edit screen.
- **Person without an address:** tapping their card opens a person sheet
  with their fields. That sheet has an "Add to an address" picker (existing
  addresses, or "New address…").
- **Edit address:** one screen or sheet with the address fields and the list
  of people, each editable inline or in a small sheet, plus "+ Person" and
  Save. Removing a person from the list asks whether to unlink them (they
  stay as a contact) or delete them.
- **Copy for envelope:** label, street, `postcode city`, and the country only
  if it is set. It uses `navigator.clipboard` and shows a short "Copied"
  confirmation.
- **Map:** `https://maps.apple.com/?q=<encoded single-line address>`, opened
  in a new tab. It opens Apple Maps on iPhone and falls back to the web
  elsewhere (*my call*).
- **More hub:** a new "Contacts" entry. Birthdays stays as its own entry.
- **Birthdays page:** unchanged. *My call:* each birthday card gets a small
  "Open contact" link to the address detail, or to the person sheet when
  the person has no address.
- Follow existing patterns: sheets via the shared `BottomSheet`, theme
  tokens, React Query hooks in `api/contacts.ts` gated on `hasToken()`, and
  invalidation of both `contacts` and `birthdays` keys on every contact
  mutation (and the other way round).

## 8. Assistant

Extend `services/ai/assistant.py`:

- **Context:** add the household's contacts to the system prompt in compact
  form: people as (id, name, address id, birthday if any) and addresses as
  (id, label, city). Cap at 300 people. *Builder's call* on what to do above
  that; a `find_contacts` read tool is the fallback.
- **New write tools (proposals only):**
  - `propose_address`: a new address, with new people and/or existing
    person ids to move in. Saved via `POST /contacts/addresses`.
  - `propose_person`: a new person, optionally at an existing address.
    Saved via `POST /contacts/people`.
  - `propose_person_update`: changes to an existing person (address,
    birthday, phone, email, notes, name). Saved via `PATCH`.
  - `propose_address_update`: changes to an existing address, such as a
    move. Saved via `PATCH`.
- **Prompt rules:** prefer updating a known person over creating a new one.
  `propose_birthday` stays for "X's birthday is …" when X is not known. When
  X is known, use `propose_person_update`.
- **Cards:** an update card shows what changes (*"Mark & Lisa: Dorpsstraat 1
  → Kerkstraat 5, Utrecht"*, *"Add Noor (🎂 12 Oct 2026) to Mark & Lisa"*).
  Edit opens the matching sheet, pre-filled. A Save failure (for example,
  the person was deleted in the meantime) is shown on the card, as today.
- Payloads are validated against the new create/update schemas, as with the
  existing tools. IDs must come from the context; unknown ids are a tool
  error.

## 9. Constraints

- Same conventions as the rest of Nesto:
  - services hold logic, routers stay thin;
  - UUID text ids and explicit update allowlists;
  - `get_household` on every route;
  - kebab-case frontend files;
  - the shared test fixtures in `backend/tests/conftest.py`.
- No new dependencies.
- Backend tests:
  - migration correctness: every birthday becomes a person with the same id
    and fields;
  - the birthdays API unchanged in shape and behaviour, including the
    delete rule;
  - feed UIDs unchanged;
  - address create with people and `move_people` is atomic;
  - delete address with and without `delete_people`;
  - `address_id` from another household is rejected;
  - cross-household access returns 404 on every route;
  - assistant tool validation for the four new tools, including unknown ids.
- Keep new code free of duplication. The SonarCloud gate is ≤3% duplicated
  new lines and reliability A.

## 10. Left to the builder

- Exact component split and the visual details (follow the sketch and
  Nesto's style).
- Text length caps.
- How the label is suggested from people's names.
- Empty states.
- The person-sheet layout.
- Whether the edit address screen is a route or a sheet.
