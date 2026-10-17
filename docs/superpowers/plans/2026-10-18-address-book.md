# Address Book Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A shared Contacts section in Nesto (addresses with the people living there), where birthdays become a property of people, plus assistant support for adding and updating contacts.

**Architecture:** Two new tables, `contact_addresses` and `people`. A migration moves every `birthdays` row into `people`, keeping the same id, then drops `birthdays`. The existing `/birthdays` API and `.ics` feed are re-backed by `people` without changing their shape. A new `/contacts` router does the CRUD. The frontend adds Contacts routes and reuses the shared `BottomSheet`. The assistant gets four new proposal tools.

**Tech Stack:** FastAPI, SQLAlchemy 2 async, Alembic, pytest-asyncio, React 19, TanStack Router/Query, Tailwind v4, Framer Motion.

**Spec:** `docs/superpowers/specs/2026-10-18-address-book-design.md`. Read it before any task.

## Global Constraints

- Every new household route calls `await get_household(db, household_id, user_id)` first. Every query filters on `household_id`.
- `people.id` for migrated birthdays equals the old `birthdays.id`. The feed UID format `birthday-{id}@nesto` is unchanged.
- The `/birthdays` API keeps its exact request/response shapes (`BirthdayCreate`, `BirthdayUpdate`, `BirthdayResponse` with `person_name`, `age`). The existing `backend/tests/test_birthdays.py` must keep passing unchanged, except for tests that encode the old delete behaviour; adjust those only as Task 1 specifies.
- Delete via `/birthdays/{id}` clears the birthday when the person has `address_id`, `phone`, `email` or `notes`. Otherwise it deletes the person.
- Deleting an address keeps its people (their `address_id` becomes NULL) unless `?delete_people=true`.
- `POST /contacts/addresses` with `people` and/or `move_people` runs in one transaction. Any invalid person id leaves nothing written.
- Explicit update allowlists. UUID text ids. No new dependencies.
- Birthday validation is identical to today's `BirthdayCreate`. On a person, month and day are both set or both null.
- Email: empty or matches `^[^@\s]+@[^@\s]+\.[^@\s]+$`. Phone: free text, ≤50 chars.
- Envelope copy format is `label`, `street`, `postcode city`, then `country` only if it is non-empty. Lines are joined with `\n`; empty lines are skipped.
- Map link: `https://maps.apple.com/?q=` + `encodeURIComponent("street, postcode city[, country]")`, opened with `target="_blank" rel="noopener noreferrer"`.
- Contacts in the assistant prompt: at most 300 people. People are listed as `id | name | address_id or - | birthday d Mon[ yyyy] or -`, and addresses as `id | label | city`.
- SonarCloud gate: duplicated new lines ≤3% and reliability A. No floating promises: await them, add `.catch`, or `void`.
- Backend tests use the shared fixtures in `backend/tests/conftest.py` (`db_session`, `client`, `extra_seed`, `USER_ID`, `HOUSEHOLD_ID`, `OTHER_HOUSEHOLD_ID`).
- Commands:
  - backend: `cd backend && .venv/bin/python -m pytest tests/ -q`
  - frontend: `cd frontend && npm run build`. Afterwards revert import-order-only churn in `routeTree.gen.ts`, but commit it when routes are added.

## Review Focus

1. **Deleting a birthday for someone who also has an address.** The person must stay in Contacts with the birthday cleared, not vanish. Test: Task 1.
2. **A Feb 29 birthday with no year, and a full-date birthday, through the migration.** Both must come out identical on `/birthdays` and in the feed. Test: Task 1.
3. **`move_people` containing a person from another Nesto household or an unknown id.** Expect a 404 and nothing written, not even the address. Test: Task 2.
4. **The assistant proposing an update for a person id that isn't in its context.** Expect a tool error so the model retries, with no card. Test: Task 3.
5. **Search with accents and case**: "zoe" finds "Zoë", "dorpsstr" finds "Dorpsstraat". Expect a diacritic- and case-insensitive substring match. Test: a pure function `matchesContactSearch` in Task 5, checked by build and by a small inline assertion module (see Task 5).

---

## File Structure

Backend:
- `app/models/contact.py`: new `ContactAddress` and `Person`. Delete `app/models/birthday.py` and update `app/models/__init__.py`.
- `alembic/versions/c1a2b3d4e5f6_contacts.py`: tables, data move, drop `birthdays`.
- `app/schemas/contact.py`: new contact create/update/response schemas. `app/schemas/birthday.py` is unchanged.
- `app/services/contact_service.py`: new.
- `app/services/birthday_service.py`: rewritten over `Person`.
- `app/services/feed_service.py`: reads `Person`.
- `app/routers/contacts.py`: new, registered in `app/main.py`.
- `app/services/ai/assistant.py` and `app/schemas/assistant.py`: new tools and proposal types.
- Tests: `test_contacts_migration.py`, `test_contacts_api.py`, `test_birthdays_on_people.py`, and additions to `test_assistant.py`.

Frontend:
- `src/api/contacts.ts`: new.
- `src/utils/contacts.ts`: new pure helpers (search match, envelope text, map URL, label suggestion).
- `src/routes/contacts.tsx` (layout), `contacts.index.tsx` (list), `contacts.$addressId.tsx` (detail).
- `src/components/contacts/`: `address-card.tsx`, `person-row.tsx`, `person-sheet.tsx`, `address-form-sheet.tsx`, `address-picker.tsx`.
- Modify `src/routes/more.tsx`, `src/components/birthdays/birthday-card.tsx` (Open contact link), `src/api/birthdays.ts` (cross-invalidation), and the assistant `proposal-card.tsx` and `api/assistant.ts`.

---

### Task 1: People/address tables, migration, birthdays re-backed by people

**Files:**
- Create: `backend/app/models/contact.py`, `backend/alembic/versions/c1a2b3d4e5f6_contacts.py`, `backend/tests/test_contacts_migration.py`, `backend/tests/test_birthdays_on_people.py`
- Modify: `backend/app/models/__init__.py`, `backend/app/services/birthday_service.py`, `backend/app/services/feed_service.py`
- Delete: `backend/app/models/birthday.py`

**Interfaces:**
- Produces:
  - `ContactAddress` (`__tablename__="contact_addresses"`): id, household_id (FK households CASCADE, index), label, street="", postcode="", city="", country="", notes="", created_by FK users, created_at, updated_at (onupdate).
  - `Person` (`__tablename__="people"`): id, household_id (FK CASCADE, index), address_id (FK contact_addresses.id SET NULL, nullable, index), name, birth_month/birth_day/birth_year (nullable ints), phone="", email="", notes="", created_by, created_at, updated_at.
  - `birthday_service` keeps its public functions and signatures (`list_birthdays`, `create_birthday`, `update_birthday`, `delete_birthday`, `get_birthdays_for_feed -> list[Person]`), now operating on `Person` (`person_name` ↔ `name`). Listing filters `birth_month IS NOT NULL`.

- [ ] **Step 1: Write failing tests**

```python
# test_birthdays_on_people.py
async def test_post_birthday_creates_person_without_address(client, db_session):
    r = await client.post(f"/api/households/{HOUSEHOLD_ID}/birthdays", json={"person_name": "Oma", "birth_month": 3, "birth_day": 3, "birth_year": 1948})
    assert r.status_code == 201
    p = await db_session.get(Person, r.json()["id"])
    assert (p.name, p.address_id, p.birth_year) == ("Oma", None, 1948)

async def test_person_without_birthday_not_listed(client, db_session): ...       # Person(name="X", no birth fields) → GET /birthdays == []
async def test_delete_birthday_of_bare_person_deletes_person(client, db_session): ...  # → person gone
async def test_delete_birthday_keeps_person_with_address(client, db_session):  # Review Focus 1
    # person with address_id set (and separately: phone set) → DELETE /birthdays/{id} → 204; person exists, birth_* all None
async def test_feed_uid_uses_person_id(...): ...  # feed_service output contains f"birthday-{person.id}@nesto"

# test_contacts_migration.py — runs alembic on a temp SQLite file
async def test_migration_moves_birthdays_to_people(tmp_path):  # Review Focus 2
    # upgrade to b7c8d9e0f1a2, insert birthdays rows (one Feb 29 no year, one full date), upgrade head
    # → people rows with same ids, name/person_name, birth fields, created_by; birthdays table gone
    # → downgrade -1 recreates birthdays with those rows
```

- [ ] **Step 2: Run them and confirm they fail.**
- [ ] **Step 3: Implement the models, the migration and the service rewrite.**
  - The migration has revision `c1a2b3d4e5f6` and down_revision `b7c8d9e0f1a2`.
  - It copies data with `INSERT INTO people (...) SELECT ... FROM birthdays`, then drops `birthdays`.
  - The migration test must point Alembic at the temp DB. Check `alembic/env.py`. If it ignores the passed URL, make `env.py` prefer `config.get_main_option("sqlalchemy.url")` when explicitly set via `Config.set_main_option`, keeping current behaviour otherwise.
  - Never touch `backend/data/nesto.db`.
- [ ] **Step 4: Verify.** The full backend suite passes, including the unchanged `test_birthdays.py`. If any of its tests asserted the old delete behaviour on a bare birthday, it still passes, because a bare person is deleted.
- [ ] **Step 5: Commit** `feat(contacts): people and addresses tables; birthdays backed by people`

---

### Task 2: Contacts API

**Files:**
- Create: `backend/app/schemas/contact.py`, `backend/app/services/contact_service.py`, `backend/app/routers/contacts.py`, `backend/tests/test_contacts_api.py`
- Modify: `backend/app/main.py`

**Interfaces:**
- Consumes: `ContactAddress` and `Person` from Task 1.
- Produces:
  - Schemas:
    - `PersonCreate(name 1..200, birth_month?, birth_day?, birth_year?, phone ≤50 ="", email ≤254 ="", notes ≤2000 ="", address_id: str|None=None)`. Uses the same birthday validator as `BirthdayCreate`, factored into a shared helper in `schemas/birthday.py` rather than duplicated. Also requires both-or-neither for month/day.
    - `PersonUpdate`: all fields optional. `address_id` may be explicitly null to unlink.
    - `PersonResponse(id, household_id, address_id, name, birth_month, birth_day, birth_year, age, phone, email, notes, created_at, updated_at)`.
    - `AddressCreate(label 1..200, street ≤200 ="", postcode ≤20 ="", city ≤100 ="", country ≤100 ="", notes ≤2000 ="", people: list[PersonCreate] ≤20 = [], move_people: list[str] ≤20 = [])`.
    - `AddressUpdate`: all address fields optional.
    - `AddressResponse(id, household_id, label, street, postcode, city, country, notes, people: list[PersonResponse], created_at, updated_at)`.
    - `ContactsResponse(addresses: list[AddressResponse], people_without_address: list[PersonResponse])`.
  - Routes, all under `/api/households/{household_id}/contacts`:

    | Method | Path | Response |
    |---|---|---|
    | GET | `""` | `ContactsResponse`. Addresses sorted by `label` (case-insensitive), people in an address by name, people without an address by name. |
    | POST | `/addresses` | 201 `AddressResponse` |
    | PATCH | `/addresses/{id}` | `AddressResponse` |
    | DELETE | `/addresses/{id}?delete_people=false` | 204 |
    | POST | `/people` | 201 `PersonResponse` |
    | PATCH | `/people/{id}` | `PersonResponse` |
    | DELETE | `/people/{id}` | 204 |
  - `age` is computed with the existing `_compute_age` (move it to a shared place if needed; no copy).

- [ ] **Step 1: Write failing tests**

```python
async def test_create_address_with_people(client): ...      # POST with 3 people → 201, people names sorted, each address_id == address id
async def test_create_address_moves_existing_people(client): ...  # bare person → move_people=[id] → person.address_id set
async def test_move_people_invalid_writes_nothing(client, db_session):  # Review Focus 3
    # move_people=[id of person in OTHER_HOUSEHOLD] → 404; no ContactAddress rows; also unknown id → 404
async def test_get_contacts_groups_and_sorts(client): ...
async def test_patch_person_unlink_and_relink(client): ...   # address_id null → appears in people_without_address
async def test_patch_person_address_other_household_404(client): ...
async def test_delete_address_keeps_people_by_default(client): ...
async def test_delete_address_with_people(client): ...       # delete_people=true → people gone
async def test_person_birthday_month_without_day_422(client): ...
async def test_invalid_email_422(client): ...
async def test_person_with_birthday_shows_on_birthdays(client): ...  # POST /people with birthday → GET /birthdays contains it
@pytest.mark.parametrize("method,path", [...all 7 routes...])
async def test_other_household_404(client, method, path): ...
```

- [ ] **Step 2: Run them and confirm they fail.**
- [ ] **Step 3: Implement.** Validate `address_id` and `move_people` against `household_id` before any write, so one commit happens at the end.
- [ ] **Step 4: Verify** that the full suite passes.
- [ ] **Step 5: Commit** `feat(contacts): contacts API`

---

### Task 3: Assistant contact tools

**Files:**
- Modify: `backend/app/services/ai/assistant.py`, `backend/app/schemas/assistant.py`, `backend/tests/test_assistant.py`

**Interfaces:**
- Consumes: the Task 2 schemas and `Person`/`ContactAddress`.
- Produces:
  - `Proposal.type` gains `"address" | "person" | "person_update" | "address_update"`.
  - `Proposal` gains `target_id: str | None = None`, the person or address id for updates.
  - Payloads:
    - `address`: `AddressCreate` dump (`people`, `move_people`).
    - `person`: `PersonCreate` dump.
    - `person_update`: `PersonUpdate` dump with `exclude_unset`, keeping an explicit `address_id: null`.
    - `address_update`: `AddressUpdate` dump with `exclude_unset`.
  - Tools:
    - `propose_address(label, street, postcode, city, country?, notes?, people?: [{name, birth_*?, phone?, email?, notes?}], move_person_ids?: [id])`
    - `propose_person(name, birth_*?, phone?, email?, notes?, address_id?)`
    - `propose_person_update(person_id, name?, birth_*?, phone?, email?, notes?, address_id?)`
    - `propose_address_update(address_id, label?, street?, postcode?, city?, country?, notes?)`
    - Every tool also takes the existing `replaces?`.
  - Ids must be in the contacts context, otherwise `ToolError("unknown person_id …")` or `ToolError("unknown address_id …")`.
  - Summaries:
    - `"New address · {label} · {city}"`
    - `"New contact · {name}"`
    - `"{name}: {changes}"`, where changes reads e.g. `"moves to Kerkstraat 5, Utrecht"` or `"🎂 12 Oct 2026"`
    - `"{label}: moves to {street}, {city}"`
  - `run_assistant` loads contacts with one query each for people and addresses, capped at 300 people, ordered by name. They go into the system prompt in the format given in Global Constraints, along with the rule: *"Prefer updating a known person or address over creating a new one; use propose_birthday only for people not in the contacts list."*

- [ ] **Step 1: Write failing tests** (scripted MockTransport as in the existing tests; seed via `extra_seed`)

```python
async def test_propose_address_with_new_and_moved_people(...): ...   # payload people/move_people, summary "New address · Mark & Lisa · Utrecht"
async def test_person_update_unknown_id_is_tool_error(...):          # Review Focus 4
    # call1 propose_person_update(person_id="nope") → tool msg starts "error: unknown person_id"; no proposals after call2 text-only
async def test_person_update_move_summary(...): ...  # address_id → summary contains "moves to"
async def test_address_update_payload_exclude_unset(...): ...
async def test_contacts_in_prompt_and_capped(...): ...  # 305 people seeded → prompt lists 300; contains "Prefer updating a known person"
async def test_person_update_unlink_address(...): ...   # address_id null kept in payload
```

- [ ] **Step 2: Run them and confirm they fail.**
- [ ] **Step 3: Implement.** Add handlers to `_HANDLERS`, reusing `_pick` and `_make_proposal`.
- [ ] **Step 4: Verify** that the full suite passes.
- [ ] **Step 5: Commit** `feat(ai): assistant proposes contact changes`

---

### Task 4: Frontend contacts API and helpers

**Files:**
- Create: `frontend/src/api/contacts.ts`, `frontend/src/utils/contacts.ts`
- Modify: `frontend/src/api/birthdays.ts`, `frontend/src/api/assistant.ts`

**Interfaces:**
- Produces:
  - Types mirroring the Task 2 schemas: `Person`, `ContactAddress`, `ContactsData`, `PersonCreate`, `PersonUpdate`, `AddressCreate`, `AddressUpdate`.
  - Hooks:
    - `useContacts(householdId)`, query key `['contacts', householdId]`, gated on `hasToken()`.
    - `useCreateAddress`, `useUpdateAddress(householdId)` (mutate `{id, data}`), `useDeleteAddress(householdId)` (mutate `{id, deletePeople}`), `useCreatePerson`, `useUpdatePerson` (mutate `{id, data}`), `useDeletePerson`.
    - Every contact mutation invalidates `['contacts', householdId]` and `['birthdays', householdId]`. Every birthday mutation in `birthdays.ts` also invalidates `['contacts', householdId]`.
  - Helpers in `utils/contacts.ts`:
    - `normalizeForSearch(s): string` (NFD, strip combining marks, lowercase)
    - `matchesContactSearch(query, address | null, people): boolean`
    - `envelopeText(address): string`
    - `mapUrl(address): string`
    - `suggestLabel(people: {name}[]): string`. One name gives "Mark"; two give "Mark & Lisa"; three or more give "Mark, Lisa & Noor".
  - Assistant: `ProposalType` gains `'address' | 'person' | 'person_update' | 'address_update'`. `Proposal` gains `target_id?: string | null`.

- [ ] **Step 1: Implement** the helpers as pure functions with no React. Implement envelope and map URL exactly per Global Constraints.
- [ ] **Step 2: Add a dev-only self-check** at `frontend/src/utils/contacts.check.ts`, run with `npx tsx` (already available via npx; nothing is added to package.json). It asserts:
  - `matchesContactSearch('zoe', null, [{name:'Zoë'}])` is true (Review Focus 5);
  - `matchesContactSearch('dorpsstr', {street:'Dorpsstraat 1',…}, [])` is true;
  - `envelopeText` for an address with an empty country has 3 lines;
  - `suggestLabel` gives the three forms above.

  Run: `cd frontend && npx --yes tsx src/utils/contacts.check.ts`. Expected: `ok`. If `npx tsx` isn't usable offline, note that in the report and verify by build only. Exclude the check file from the Vite build: it is never imported, so it isn't bundled.
- [ ] **Step 3: Verify** with `npm run build`.
- [ ] **Step 4: Commit** `feat(web): contacts API hooks and helpers`

---

### Task 5: Contacts list and detail screens

**Files:**
- Create: `frontend/src/routes/contacts.tsx`, `contacts.index.tsx`, `contacts.$addressId.tsx`, `frontend/src/components/contacts/address-card.tsx`, `person-row.tsx`
- Modify: `frontend/src/routes/more.tsx`

**Interfaces:**
- Consumes: Task 4 hooks and helpers.
- Produces:
  - Route `/contacts` (list) and `/contacts/$addressId` (detail).
  - `PersonRow({person})`, which renders the name, a 🎂 date with age when known, `tel:`/`mailto:` links and notes. Task 6 reuses it.

- [ ] **Step 1: Build the list.** Follow the spec §7 and the approved sketch:
  - a search box using `matchesContactSearch`;
  - address cards sorted as the API returns them, with people as chips and a birthday on the chip;
  - a "No address yet" section with person cards;
  - a FAB that opens the address form (provided by Task 6). Until Task 6 lands, the FAB navigates nowhere. Wire it in Task 6, and note that in the report.
- [ ] **Step 2: Build the detail screen.**
  - The address block: "Copy for envelope" uses `navigator.clipboard.writeText(envelopeText(a))` with `.catch` showing "Couldn't copy" and success showing "Copied" for 2s. "Map" uses `mapUrl`. Show the address notes.
  - "Living here" lists the people with `PersonRow`.
  - An unknown `addressId` shows "Address not found" with a link back.
- [ ] **Step 3: Add "Contacts" to the More hub,** above Birthdays, with the description "Addresses and the people who live there".
- [ ] **Step 4: Verify** with `npm run build`, committing `routeTree.gen.ts`.
- [ ] **Step 5: Commit** `feat(web): contacts list and address detail`

---

### Task 6: Create and edit addresses and people

**Files:**
- Create: `frontend/src/components/contacts/address-form-sheet.tsx`, `person-sheet.tsx`, `address-picker.tsx`
- Modify: `frontend/src/routes/contacts.index.tsx`, `contacts.$addressId.tsx`

**Interfaces:**
- Consumes: Task 4 hooks and Task 5 `PersonRow`.
- Produces:
  - `AddressFormSheet({open, onClose, householdId, address?: ContactAddress, initialValues?: Partial<AddressCreate>})`.
    - Create mode posts `AddressCreate`, with people added inline in the sheet.
    - Edit mode PATCHes the address. People are edited through `PersonSheet`.
    - The label field defaults to `suggestLabel(people)` until the user types in it.
  - `PersonSheet({open, onClose, householdId, person?: Person, initialValues?: Partial<PersonCreate>, defaultAddressId?: string})`.
    - Fields: name, birthday (reuse the existing `birthday-form.tsx` fields component, not a copy), phone, email, notes.
    - For a person without an address it includes `AddressPicker`.
  - `AddressPicker({value, onChange, householdId})`: existing addresses plus "New address…", which opens `AddressFormSheet` with `move_people=[person.id]`.
  - All sheets use `BottomSheet` and read `initialValues` on open.

- [ ] **Step 1: Implement the sheets.** Wire them in:
  - list FAB: new address;
  - person card in "No address yet": `PersonSheet`;
  - detail Edit: `AddressFormSheet` in edit mode;
  - "+ Add person": `PersonSheet` with `defaultAddressId`;
  - tapping a person row: `PersonSheet` in edit mode.
- [ ] **Step 2: Handle removing and deleting.**
  - In `PersonSheet` edit mode, "Remove from address" calls PATCH with `address_id: null`, and "Delete contact" deletes after confirmation.
  - Delete address on the detail screen confirms with the choice "Keep the N people as contacts" or "Delete them too".
- [ ] **Step 3: Verify** with `npm run build`.
- [ ] **Step 4: Commit** `feat(web): create and edit contacts`

---

### Task 7: Birthdays link and assistant cards for contacts

**Files:**
- Modify: `frontend/src/components/birthdays/birthday-card.tsx` (or the Birthdays route that renders it), `frontend/src/components/assistant/proposal-card.tsx`, `.claude/CLAUDE.md`

**Interfaces:**
- Consumes: Task 4 hooks, Task 6 sheets, and the Task 3 proposal shapes.

- [ ] **Step 1: Add "Open contact" to the Birthdays page cards.**
  - It links to `/contacts/$addressId` when the person has an address. The data comes from `useContacts`: find the person by id, since `BirthdayResponse` has no `address_id`.
  - Otherwise it opens `PersonSheet` for that person.
- [ ] **Step 2: Handle the new proposal types in `ProposalCard`.**
  - Save calls:
    - `address`: `useCreateAddress` with the payload;
    - `person`: `useCreatePerson`;
    - `person_update`: `useUpdatePerson({id: target_id, data})`;
    - `address_update`: `useUpdateAddress({id: target_id, data})`.
  - Edit opens `AddressFormSheet` or `PersonSheet` with `initialValues = payload`. For updates, pass the existing record from `useContacts` plus `initialValues` overlaid.
  - After saving, link to `/contacts/$addressId` when known, otherwise to `/contacts`.
  - Keep the existing state machine and the save-error display.
- [ ] **Step 3: Update `.claude/CLAUDE.md`:** the new tables, the router, the routes, the components, and "birthdays are people with a birthday".
- [ ] **Step 4: Verify** that the backend suite and `npm run build` both pass.
- [ ] **Step 5: Manual checks for the user** (no browser here; list them in the report):
  1. Dictate "Mark and Lisa had a baby, Noor, born 12 October" with Mark & Lisa already in contacts. Expect a "Noor" person card at their address.
  2. "Mark and Lisa moved to Kerkstraat 5, 3511 AB Utrecht". Expect an address update card.
  3. Delete Oma's birthday when she has an address. Expect her to stay in Contacts.
  4. Use Copy for envelope, then paste it.
- [ ] **Step 6: Commit** `feat(web): contacts in birthdays and assistant cards`
