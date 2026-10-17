# AI Assistant — Design

Date: 2026-10-17
Status: Draft for review (revised after design review)

## 1. Intent

Adding things to Nesto takes too many taps. The case that started this was
adding a birthday: opening Birthdays, the sheet, and filling in name, day,
month and year by hand. Jan wants to open the home page, dictate a sentence
with the iPhone keyboard's built-in microphone ("Oma's birthday is 3 March
1948"), and have Nesto turn it into the right item.

The second wish is help with the weekly groceries: Nesto suggests a new list
from past shopping, and recipe links can be pasted in to add their
ingredients.

Success means the common "add something" actions are quicker by voice than
through the forms, and making the weekly grocery list is mostly picking from
suggestions.

## 2. Goals

1. A text box on the home page that understands natural-language requests
   and proposes actions.
2. Every proposed change is shown as a card that the user checks and saves.
   **Nothing is written without the user tapping Save.**
3. First-version actions: add a birthday, add a reminder (task), add a
   calendar event, add items to an existing shopping list, and start a new
   grocery list.
4. Lists get a type. A grocery list can be filled from suggestions based on
   recently completed grocery lists.
5. A recipe link can be pasted into a grocery list. Its ingredients are
   extracted, pantry staples are unticked, and the user reviews the rest
   before they are added. The recipe link stays on the list, with its
   ingredients grouped under it.

## 3. Non-goals (first version)

- Editing or deleting existing items through the assistant.
- Nesto's own speech recognition. Dictation is the phone keyboard's job.
- Scaling recipe quantities to a different number of servings.
- Recipe images.
- Address book actions. The address book is a separate, later project.
- Answering questions about the household's data ("what's on Saturday?").
- Persisted chat history.
- Streaming responses.

## 4. Anti-goals

- The assistant changing data without an explicit Save tap.
- Household data used for model training: every OpenRouter request pins
  `provider.data_collection = "deny"`, the same as Kesto, and this is never
  relaxed.
- The API key showing up in logs, API responses, or the frontend after it
  has been saved.
- The assistant being able to touch another household's data.
- Content from a recipe page being able to make the assistant do anything.

## 5. Engine: OpenRouter, following Kesto

Port from `/home/jan/kesto/backend/app/services/ai/` into
`backend/app/services/ai/`:

- `openrouter.py`: async chat completions with tool calling, error mapping
  (401/402/429/no-provider), and `check_key` via `GET /key`. Change the
  referer and title to Nesto. Kesto raises `app.errors.ConfigError` /
  `UpstreamError`, which Nesto doesn't have. Map these to `HTTPException`
  (400 for a bad key, 502 for upstream failures) with the provider message.
  Non-streaming only. Set `max_tokens` on every call.
- `models.py`: a curated list of models that support tool calling, the first
  being the default. Update the list to current model ids when building.
- Agent loop: a **simplified** port of `agent.py`. Kesto's conversation
  storage, streaming and `proposal_id` plumbing are not needed. Write tool
  calls become proposals and are never executed.

**Key and model are set in the app, not in env vars** (Jan's preference).
*My call:* one OpenRouter key and model per **household**, settable by any
member in Settings → Assistant (Nesto has no admin role). The settings page
says plainly that whoever's key is saved pays for everyone's use, and
recommends setting a credit limit on the key at OpenRouter.

Storage: a new table `household_ai_settings(household_id PK FK cascade,
encrypted_api_key, model, updated_by, updated_at)`, encrypted with the
existing `crypto_service`. The API returns only whether a key is set and its
OpenRouter label, never the key itself. If decryption fails (for example
after `SECRET_KEY` changes), treat it as "no key set — please re-enter".

**What needs a key:** the home-page box and recipe extraction. Without a
key the box is hidden, and "Add recipe" shows a hint pointing to Settings.
List suggestions do not use the AI and always work.

## 6. Home-page assistant

### What the user sees

- A text input at the top of the dashboard (`routes/index.tsx`), under the
  greeting, with placeholder text like "Add a birthday, reminder, event…".
  It is a normal multi-line text field, so the iOS keyboard mic works.
- On send, the reply appears below the box. The reply is a short line of
  text plus zero or more **proposal cards**.
- Each card shows the action in plain words and its fields, for example
  *New birthday · Oma · 3 March 1948*, with **Save**, **Edit** and
  **Cancel**. A multi-part request ("Oma's birthday is 3 March and remind me
  to buy a present the week before") gives one card per action.
- **Edit** opens the existing create sheet for that type, filled in with the
  card's values. This needs new work: `CreateBirthdaySheet`,
  `CreateReminderSheet` (`create-task-sheet.tsx`) and `CreateEventSheet` get
  an `initialValues` prop. When it is set, the sheet starts from those values
  instead of resetting on open (`create-event-sheet.tsx:97-100` currently
  resets every time). The sheets must keep every field the proposal can
  carry, including ones they don't show today (task `description`,
  `category`, `recurrence_end`, event `recurrence_end`), so editing never
  drops a proposed field. The event sheet must be able to show an arbitrary
  start and end. Saving from the sheet clears the card.
- When information is missing or ambiguous, the assistant asks in plain text
  and the user answers in the same box. The conversation lasts until the user
  clears it or leaves the page.
- A follow-up correction ("actually make it 4 March") **replaces** the
  earlier unsaved card it refers to instead of adding a second one. See
  "Transcript" below for how the model knows the card exists.
- After Save, the card turns into a confirmation with a link to the page
  where the item lives (the list for list items, otherwise the Birthdays,
  Reminders or Calendar page). The relevant React Query caches are
  invalidated.

### Context instead of read tools

Members (id, first name) and **active** lists (id, name, kind) are small.
They go into the system prompt, so there are no read tools and most turns
are a single model call. The prompt also includes today's date and the
**user's timezone**: the client sends its IANA zone
(`Intl.DateTimeFormat().resolvedOptions().timeZone`) with each request, and
the backend validates it with `ZoneInfo` and falls back to UTC.
`households.timezone` exists but is never set anywhere, so it is not used.

### Actions (write tools → proposals)

| Tool | Proposes | Payload validated by |
|------|----------|----------------------|
| `propose_birthday` | birthday (name, day, month, optional year) | `BirthdayCreate` |
| `propose_task` | reminder (title, due date, priority, assignee, recurrence) | `TaskCreate`, plus the UI's rule that recurrence needs a due date |
| `propose_event` | calendar event | `EventCreate`, with the rules below |
| `propose_list_items` | items on an existing **active** list | list id must be in the prompt's active lists; each item validated by `ShoppingItemCreate` |
| `propose_grocery_list` | "create a groceries list named …" | `ShoppingListCreate` with `kind = groceries` |

Event rules, matching how the app already stores events:

- Times are naive local wall-clock strings (`YYYY-MM-DDTHH:MM:SS`), as
  `create-event-sheet.tsx` sends them. Strip or reject offsets and `Z`.
- All-day events use the existing convention: `T00:00:00` to `T23:59:59`.
- If no end is given, default to start + 1 hour. `EventCreate` rejects
  end <= start.

Assignee names resolve to member ids from the prompt context. Normal
membership validation still applies on save.

`propose_grocery_list` creates the list only. After Save, the user goes to
the new list, where the suggestions checklist opens automatically (§7). The
suggestion logic lives in one place.

### Transcript

*My call:* proposals and the transcript are not stored on the server. The
client sends `{messages: [{role, content}], timezone}`.

- Only `user` and `assistant` roles are accepted. `system` and `tool` are
  rejected and any `tool_calls` are dropped. The server always builds its
  own system prompt.
- So that follow-ups work, the assistant `content` the server returns
  ends with a compact note of the proposals it made in that turn (type, card
  id and key fields). The client sends it back as-is. A forged assistant turn
  only steers the model, because every save still goes through the normal
  endpoints under the user's own auth.
- Limits: at most 20 messages, 4,000 characters per message, and 24,000
  characters total. At most 3 model calls per turn.

### Saving a proposal

The endpoint returns each proposal as `{id, type, summary, payload}`. The
payload has already been validated against the matching create schema. On
Save, the frontend calls the **existing** create endpoint (`POST
…/birthdays`, `…/tasks`, `…/events`, `…/lists`) or the new bulk items
endpoint (§7) with that payload. All existing validation, authorization and
membership checks apply unchanged. The assistant itself has no write path.

### Endpoint and infrastructure

- `POST /api/households/{id}/assistant` returns `{reply, proposals}`.
  Membership is checked like on every other household route.
- **nginx:** `/api/` has `proxy_read_timeout 30s` (`nginx/nginx.conf:45`).
  Add a `location` for the assistant and recipe-extract routes with a 120s
  timeout. Keep the OpenRouter client timeout under that.
- **Cost cap:** there is no backend rate limiter today. Add a small
  in-memory one (the backend runs as one uvicorn process): a
  **per-household daily cap** on AI calls (*my call:* 200 a day), plus a
  short per-user burst limit. Hitting the cap returns a clear message.

## 7. Grocery lists

### List types

Lists get a type, chosen from a fixed set (Jan's decision). *My call* on the
set: **Groceries, Wish list, Packing, Other**.

- Data model: a new `kind` text column on `shopping_lists` with
  `server_default 'other'`. The allowed values are checked in the schema.
- Schemas: add `kind` to `ShoppingListCreate`, `ShoppingListUpdate` and
  `ShoppingListResponse`. Also add it to the dicts built field by field in
  `list_shopping_lists` (`shopping_list_service.py:52-63`). If that step is
  missed, it is silently absent from list responses.
- UI: a chip picker in `create-list-sheet.tsx` and `edit-list-sheet.tsx`,
  and a small label on list cards.
- Migration backfill (*my call*): lists whose name contains "boodschap",
  "grocer", "supermarkt" or "AH"/"Jumbo"/"Lidl" (case-insensitive, whole
  word for the shop names) become `groceries`. Everything else becomes
  `other`. That way suggestions have history from day one.

Suggestions, "Add recipe" and `propose_grocery_list` apply to **grocery
lists only**.

### Suggestions

- When a grocery list is new or empty, a "Suggest items" button appears.
  It also opens automatically after the list was created from the home box.
- Source: items from the most recent 8 **archived** grocery lists, ordered
  by `updated_at` (there is no completed-at column; this is good enough).
  Items with a `recipe_id` are excluded, because they are one-off recipe
  ingredients rather than regulars.
- Normalisation: case and whitespace only. Plural stripping would be wrong
  for Dutch names (ei/eieren).
- Ranking: by how many of those lists contain the item. Items on at least 3
  of the 8 are suggested, using the most recent quantity. Items already on
  the current list are left out.
- Known limitation: completing a list marks every item checked
  (`complete_shopping_list`), so "was on the list" is the signal, not "was
  bought". This is fine for spotting regulars.
- UI: a checklist, all ticked by default, then "Add selected". With fewer
  than 3 archived grocery lists, show "Not enough history yet".
- Endpoint: `GET /api/households/{id}/lists/{listId}/suggestions` returns
  `[{name, quantity, count}]`. This is plain code with no AI.

### Recipe links

Flow: the user taps "Add recipe", pastes a URL, reviews the extracted
ingredients, and taps "Add".

- `POST /api/households/{id}/lists/{listId}/recipes/extract` with `{url}`
  returns `{title, url, ingredients: [{name, quantity, staple}]}`. Nothing
  is saved.
  1. Fetch the page with `safe_fetch` (below).
  2. Extraction: use schema.org `Recipe` JSON-LD (`name`,
     `recipeIngredient`) if present. Otherwise use the page's visible text,
     capped at 15,000 characters.
  3. One LLM call splits the lines into name and quantity and flags pantry
     staples (salt, pepper, oil, butter, flour, sugar, common dried herbs and
     spices, water). This call has **no tools** and must return structured
     JSON only. Its output is clipped to `ShoppingItemCreate` limits and to
     60 items. Page content never reaches the home-box agent.
- The review list shows staples **unticked** rather than hidden, so the user
  can still add one.
- Saving uses the bulk endpoint below with a `recipe` object. The stored
  `url` is always the validated URL the user pasted, never a URL taken from
  the page. The title is plain text.

### Data model and bulk endpoint

- A new table `shopping_list_recipes(id, list_id FK cascade, url, title,
  created_by, created_at)`.
- A new column `shopping_items.recipe_id`, nullable, FK with
  `ondelete="SET NULL"`.
- `recipe_id` is set by the server only. It is not accepted in
  `ShoppingItemCreate` or `_ITEM_UPDATABLE_FIELDS`, so a client can't point
  an item at another list's recipe. Add it to `ShoppingItemResponse`.
- `POST /api/households/{id}/lists/{listId}/items/bulk` with
  `{items: [{name, quantity}], recipe?: {url, title}}`. In **one
  transaction** it creates the recipe row (if given) and all items with
  sequential positions. It rejects archived lists. "Add selected", recipe
  add and `propose_list_items` all use it. This avoids half-filled lists and
  the `max(position)+1` race that parallel single posts would hit.
- `GET …/lists/{listId}/recipes` and `DELETE …/recipes/{recipeId}?remove_items=true|false`.
  Removing a recipe asks whether to also remove its unchecked items.
- List page: each recipe shows as a header (title plus a link to the recipe)
  with its items grouped under it. Items without a recipe stay in the normal
  section.

### `safe_fetch` (SSRF protection)

A shared helper in `backend/app/services/safe_fetch.py`. The existing
`_validate_url_not_internal` in `calendar_sync_service.py` misses ranges,
blocks the event loop, and is open to DNS rebinding, so it is not reused.

- Accept `http`/`https` only, on ports 80/443.
- Resolve with `loop.getaddrinfo`. Every address must be `ip.is_global`,
  with IPv4-mapped IPv6 unwrapped first.
- **Connect to the validated IP**, with the hostname in the `Host` header and
  `extensions={"sni_hostname": host}`, so DNS can't change between check and
  connect.
- `follow_redirects=False`. Follow at most 3 redirects manually and
  re-validate each one.
- `trust_env=False`, a browser-like User-Agent, no cookies, and a 10s
  timeout.
- Accept only `text/html` content. Stream the body and abort after 2 MB of
  **decoded** bytes.
- *Builder's call:* moving CalDAV onto it is a good follow-up, but not part
  of this work.

## 8. Settings

A new "Assistant" section in `routes/settings.tsx`:

- an OpenRouter API key field (write-only; it shows "Key set · <label>" when
  one is saved) with Test and Remove buttons,
- a model picker from the curated list,
- a short note covering two things: requests go to OpenRouter with data
  collection denied, and the key's owner pays for the whole household's use
  (with a suggestion to set a credit limit).

Endpoints: `GET/PUT/DELETE /api/households/{id}/assistant/settings` and
`POST …/assistant/settings/test`.

## 9. Constraints

- Follow existing Nesto conventions:
  - services hold logic and routers stay thin;
  - UUID text ids and `Depends(get_current_user_id)`;
  - a household membership check on every route;
  - one Alembic migration for the new tables and columns, including the
    backfill;
  - kebab-case frontend files;
  - React Query hooks in `frontend/src/api/assistant.ts`, gated on
    `hasToken()`.
- No new heavy dependencies. `httpx` is already present. HTML text and
  JSON-LD extraction should use the standard library (`html.parser`,
  `json`).
- The CSP stays unchanged (no recipe images).
- Backend tests (pytest), with OpenRouter mocked via `httpx.MockTransport`
  as in Kesto's tests:
  - assistant behaviour: proposal validation per tool (including the event
    time rules), that the agent never writes, rejection of `system`/`tool`
    roles in the transcript, the daily cap;
  - lists: suggestion ranking (recipe items excluded, only grocery lists),
    bulk endpoint atomicity and archived-list rejection, `kind` present in
    list responses;
  - recipes: JSON-LD extraction, `safe_fetch` rejection (private, CGNAT,
    mapped IPv6, redirect to internal, oversize);
  - security: key never returned, `InvalidToken` handled, cross-household
    access denied on every new route.

## 10. Left to the builder

Left to you:

- prompt wording and the exact curated model list;
- `max_tokens` values;
- the card visual design (match Nesto's bold style and dark mode);
- the exact staples list;
- the per-user burst limit;
- loading and error states.

Show OpenRouter errors (bad key, no credits, no provider under the privacy
pin, timeout) in the reply area as plain messages.
