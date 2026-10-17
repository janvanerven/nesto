# AI Assistant — Design

Date: 2026-10-17
Status: Draft for review

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
   calendar event, add items to an existing shopping list, and create a new
   grocery list with suggested items.
4. A new list can be filled from suggestions based on recently completed
   lists.
5. A recipe link can be pasted into a list. Its ingredients are extracted,
   pantry staples are left out, and the user reviews the rest before they are
   added. The recipe link stays on the list, with its ingredients grouped
   under it.

## 3. Non-goals (first version)

- Editing or deleting existing items through the assistant.
- Nesto's own speech recognition. Dictation is the phone keyboard's job.
- Scaling recipe quantities to a different number of servings.
- Address book actions. The address book is a separate, later project.
- Answering questions about the household's data ("what's on Saturday?").
  *Builder's call:* read tools may exist where an action needs them (for
  example looking up list names or members), but answering questions is not a
  goal.
- Persisted chat history.

## 4. Anti-goals

- The assistant changing data without an explicit Save tap.
- Household data used for model training: every OpenRouter request pins
  `provider.data_collection = "deny"`, the same as Kesto, and this is never
  relaxed.
- The API key showing up in logs, API responses, or the frontend after it
  has been saved.
- The assistant being able to touch another household's data.

## 5. Engine: OpenRouter, following Kesto

Reuse the pattern in `/home/jan/kesto/backend/app/services/ai/`:

- `openrouter.py`: async OpenAI-compatible chat completions with tool
  calling, error mapping (401/402/429/no-provider), and `check_key` via
  `GET /key`. Port it into `backend/app/services/ai/openrouter.py` and
  change the referer and title to Nesto.
- `models.py`: a curated list of models that support tool calling, the first
  being the default. Copy the list and update it to current model ids when
  building.
- `agent.py` / `proposals.py`: the agent loop runs read tools directly and
  turns every write tool call into a **proposal** that is never executed in
  the loop. Nesto uses the same split.

**Key and model are set in the app, not in env vars** (Jan's preference).
*My call:* one OpenRouter key and model per **household**, settable by any
member in Settings → Assistant (Nesto has no admin role). The key is stored
encrypted with the existing `crypto_service` (Fernet derived from
`SECRET_KEY`), in a new table `household_ai_settings(household_id PK,
encrypted_api_key, model, updated_by, updated_at)`. The API returns only
whether a key is set and its OpenRouter label, never the key itself. A "Test"
button calls `check_key`. If no key is set, the home-page box is hidden and
the list suggestion and recipe features show a hint pointing to Settings.

## 6. Home-page assistant

### What the user sees

- A text input at the top of the dashboard (`routes/index.tsx`), under the
  greeting, with placeholder text like "Add a birthday, reminder, event…".
  It is a normal multi-line text field, so the iOS keyboard mic works.
- On send, the reply appears below the box. The reply is a short line of
  text plus zero or more **proposal cards**.
- Each card shows the action in plain words and its fields, for example
  *New birthday · Oma · 3 March 1948*, with **Save** and **Cancel**. A
  multi-part request ("Oma's birthday is 3 March and remind me to buy a
  present the week before") gives one card per action.
- *Builder's call:* fields on a card can be edited before saving. The
  simplest version is an "Edit" button that opens the existing create sheet
  for that type, filled in (`create-birthday-sheet`, `create-task-sheet`,
  `create-event-sheet`).
- When information is missing or ambiguous, the assistant asks in plain text
  and the user answers in the same box. The conversation lasts until the user
  clears it or leaves the page. *My call:* the transcript lives in the client
  and is sent with each request. No server-side conversation table.
- After Save, the card turns into a confirmation with a link to the created
  item, and the relevant React Query caches are invalidated.

### Actions (write tools → proposals)

| Tool | Creates | Validated by |
|------|---------|--------------|
| `propose_birthday` | birthday (name, day, month, optional year) | `BirthdayCreate` schema |
| `propose_task` | reminder (title, due date, priority, assignee, recurrence) | `TaskCreate` schema |
| `propose_event` | calendar event (title, start/end, all-day, recurrence) | `EventCreate` schema |
| `propose_list_items` | items on an existing active list | list must belong to the household |
| `propose_grocery_list` | new list + suggested items (see §7) | — |

Read tools available to the agent: list household members (to resolve "remind
Lisa…"), list active shopping lists (to resolve "add milk to the groceries"),
and get grocery suggestions (§7).

The prompt includes today's date and the household timezone
(`households.timezone`), so "next Friday" and "in two weeks" resolve
correctly. Assignee names are resolved to member ids, and assignees are
validated against membership as they are everywhere else.

### Saving a proposal

*My call:* proposals are not stored on the server. The assistant endpoint
returns each proposal as `{type, payload}`, where the payload has already
been validated against the matching Pydantic create schema. On Save, the
frontend calls the **existing** create endpoints (`POST …/birthdays`,
`…/tasks`, `…/events`, `…/lists`, `…/lists/{id}/items`) with that payload.
All the existing validation, authorization and membership checks then apply
unchanged, and the assistant itself has no write path.

### Endpoint

`POST /api/households/{id}/assistant` with `{messages: [{role, content}]}`.
Returns `{reply: str, proposals: [{id, type, summary, payload}]}`. Membership
is checked like every other household route. *Builder's call:* streaming is
not needed. Show a loading state.

Limits (*my call*): at most 20 messages and 4,000 characters per message per
request, at most 6 agent steps per turn, and a per-user rate limit in
addition to nginx's general one.

## 7. Grocery lists

### List types

Lists get a type, chosen from a fixed set (Jan's decision). *My call* on the
set: **Groceries, Wish list, Packing, Other**. It is a new `kind` text column
on `shopping_lists` (default `other`, with the allowed values checked in the
schema), shown as a chip picker in the create and edit list sheets and as a
small label on list cards. Existing lists migrate to `other`, and the user
marks their grocery lists once. In the home box, "groceries" maps to
`kind = groceries`.

Suggestions, "Suggest items", "Add recipe" and `propose_grocery_list` apply
to **grocery lists only**. Recipes are about food, so other list types don't
show those buttons.

### Suggestions

"Suggest items" works from:

1. The "Suggest items" button on a new or empty list in `lists.$listId`.
2. The `propose_grocery_list` action in the home box ("make this week's
   grocery list").

The suggestion source is item names from the household's **completed**
(`status = "archived"`) **grocery** lists, using the most recent ~8. Normalise
names (case, whitespace, simple plurals) and rank by how many of those lists
contain the item. Items that appear on at least a few of them (*builder's
call* on the threshold, such as ≥3 of 8) are suggested, using the most recent
quantity. This part is plain code, not the LLM, so it works without an API
key. *Builder's call:* whether the LLM is also used to merge near-duplicates
("melk" / "halfvolle melk").

The UI shows suggestions as a checklist, all ticked by default. "Add
selected" adds them. Nothing is added without that tap.

When there are fewer than ~3 completed lists, say there isn't enough history
yet instead of showing a thin list.

### Recipe links

- In a list, the user taps "Add recipe" and pastes a URL.
- The backend fetches the page, extracts ingredients, and returns them for
  review. Extraction order: the page's schema.org `Recipe` JSON-LD
  (`recipeIngredient`) first, which most recipe sites provide, and the LLM
  over the page's visible text as a fallback. One LLM call over the ingredient
  lines splits each into name and quantity and flags **pantry staples** (salt, pepper, oil, butter,
  flour, sugar, common dried herbs and spices, water). Staples are unticked
  in the review list rather than hidden, so the user can still add one.
  Quantities are taken from the recipe as written.
- The user confirms, and the items are added.
- **The recipe stays on the list:** a new table `shopping_list_recipes(id,
  list_id FK cascade, url, title, image_url nullable, created_by,
  created_at)` and a nullable `recipe_id` FK on `shopping_items`. The list
  page shows each recipe as a header (title, link that opens the recipe)
  with its items grouped under it, and items without a recipe in the normal
  section. Deleting a recipe from the list asks whether to also remove its
  unchecked items.

### Fetching safety (SSRF)

The recipe fetcher runs on the home server, so it must:

- allow only `http`/`https`, and resolve the host and reject private,
  loopback, link-local and other reserved addresses, checking again after
  every redirect (at most 3 redirects),
- time out after ~10 seconds and cap the response at ~2 MB,
- send a normal browser-like User-Agent and never send cookies or auth,
- send only the extracted text to the LLM, never raw HTML with scripts.

## 8. Settings

A new "Assistant" section in `routes/settings.tsx`:

- an OpenRouter API key field (write-only; it shows "Key set · <label>" when
  one is saved) with Test and Remove buttons,
- a model picker from the curated list,
- one line explaining that requests go to OpenRouter with data collection
  denied.

Endpoints: `GET/PUT/DELETE /api/households/{id}/assistant/settings` and
`POST …/assistant/settings/test`.

## 9. Constraints

- Follow existing Nesto conventions: services hold logic, routers stay thin,
  UUID text ids, `Depends(get_current_user_id)`, a household membership check
  on every route, an Alembic migration for the new tables and column, kebab-case
  frontend files, React Query hooks in `frontend/src/api/assistant.ts` gated
  on `hasToken()`.
- No new heavy dependencies. `httpx` is already present. HTML text extraction
  should use the standard library or something small. *Builder's call.*
- The CSP in the nginx config: recipe images, if shown, come from external
  hosts. Either don't show them, or allow `img-src https:`. *Builder's
  call*, but don't loosen anything else.
- Backend tests (pytest) for: proposal validation per tool, that the agent
  never writes, suggestion ranking, JSON-LD ingredient extraction, SSRF
  rejection, key never returned, and cross-household access denied. Mock
  OpenRouter with `httpx.MockTransport` as Kesto's tests do.

## 10. Left to the builder

Prompt wording, the exact curated model list, the card visual design (it
should match Nesto's bold style and dark mode), the suggestion threshold and
name normalisation, the staples list, and loading and error states. When an
OpenRouter error occurs (bad key, no credits, no provider under the privacy
pin), show its message in the reply area.
