# ioBroker Kanban – Documentation (English)

A full-featured **Kanban board as a dedicated ioBroker adapter**. The adapter ships its own web server, serves a lean single-page app (vanilla JS, no framework) and keeps all open views in sync live via WebSocket. Cards are moved by drag & drop, boards and columns are freely configurable, tasks can recur, notifications go out by e-mail (including calendar invites), and everything can be driven from other automations via REST, webhooks or `sendTo`.

> **Who is it for?** Anyone who wants shared task management in their smart home – family, flat-share, house maintenance – tightly integrated with ioBroker (scripts, Lovelace, Node-RED).

> **Version 0.1.2** – "Share view": labels now act as a **blacklist** (selection hides them, new labels stay visible); `doneLimit` distinguishes **empty = all** from **`0` = none**.

> **Version 0.1.1** – security update: write protection for the REST API via token (`X-Kanban-Token`), XSS-sanitized Markdown preview, safe link schemes only, and a Content Security Policy. See [Security & access control](#security--access-control).

![Kanban board – overview](img/board.png)

---

## Contents

- [Installation & first steps](#installation--first-steps)
- [Users](#users)
- [Cards – all fields](#cards--all-fields)
- [Recurrence](#recurrence)
- [Public holidays](#public-holidays)
- [Columns & WIP limit](#columns--wip-limit)
- [Sharing views / URL parameters](#sharing-views--url-parameters)
- [Notifications](#notifications)
- [Webhooks – inbound](#webhooks--inbound)
- [Webhooks – outbound](#webhooks--outbound)
- [REST API](#rest-api)
- [Security & access control](#security--access-control)
- [Other integration paths (sendTo, action state)](#other-integration-paths)
- [Live sync & deep links](#live-sync--deep-links)
- [ioBroker states & objects](#iobroker-states--objects)
- [Language / internationalization](#language--internationalization)
- [FAQ & pitfalls](#faq--pitfalls)

---

## Installation & first steps

1. Install the adapter and create an **instance** (`kanban.0`).
2. In the instance settings, adjust **port** (default `8095`), **IP binding** (default `0.0.0.0`) and **base URL** as needed.
3. Open the web UI: **`http://<host>:8095/`**
4. On first launch there is no board yet. Use the **gear icon (⚙)** at the top right to create one. Every new board comes with three default columns:
   - **To do** (`todo`)
   - **In progress** (`doing`)
   - **Done** (`done`, flagged as the "Done" column)
5. Create your first task with **"+ Card"**.

### General settings (tab "General")

| Setting | Meaning |
|---|---|
| **Port** | Web server port (default `8095`). If it is taken, the adapter automatically picks a free one. |
| **IP address** | Bind address (default `0.0.0.0` = all interfaces). |
| **Base URL** | Publicly reachable URL used in e-mail links (e.g. behind a reverse proxy). Empty = auto-detect local IP. |
| **Default theme** | `auto` (system), `light` or `dark`. |
| **Accent color** | Color of the controls (default `#7E57C2`). |
| **Custom CSS** | Served as `/api/custom.css` – for individual tweaks. |

---

## Users

Users are maintained as a table in the instance settings (tab **"Users"**). They appear as chips in the header and can be assigned to cards.

| Field | Meaning |
|---|---|
| **name** | Internal ID, lowercase, no special characters (e.g. `bjoern`). Used in URL parameters and assignments. |
| **displayName** | Display name (e.g. `Björn`). |
| **email** | Optional. Target address for e-mail notifications. |
| **color** | Avatar/chip color (default as long as no avatar image is set). |
| **notify…** | Six per-user checkboxes controlling notifications – see [Notifications](#notifications). |

**Avatar image (optional):** By default the avatar shows the initials (on the user color). In the board UI under **⚙ → "User avatars"** you can **upload a PNG/JPG** per user, which is then shown as a round avatar (with preview; the image is automatically cropped to a square, scaled to 128 px and stored in the ioBroker file storage – no config bloat). "Remove avatar" reverts to the initials.

---

## Cards – all fields

**Clicking a card** opens the editor. A card has the following content fields (settable via the API under the same names):

![Card editor](img/card-editor.png)

| Field | Type | Description |
|---|---|---|
| **title** | text | Task title (required). |
| **description** | Markdown | Description, rendered as Markdown (links, images, lists …). Embedded HTML is sanitized before display (XSS protection). |
| **due** | `YYYY-MM-DD` | Due date. Overdue / soon-due cards are highlighted. |
| **dueTime** | `HH:MM` | Optional time of day. Enabled via a checkbox, shown on the card after the date. Only effective together with `due`. |
| **priority** | `0`/`1`/`2` | Normal / High / Urgent. |
| **assignees** | list of user IDs | Assignees. Determine who receives notifications. |
| **labels** | list of label IDs | Colored tags. Labels are managed per board (create, rename, recolor, delete). |
| **color** | hex color | Colored bar on the left edge of the card. Chosen via an embedded color picker (color field + hue slider + hex input) or presets. |
| **link** | URL | A link. The card shows a **type-dependent icon**: ✉️ `mailto:`, 📞 `tel:`, ▶️ YouTube, 📄 PDF, 🖼️ image, 🚗 route/navigation (Waze, Google Maps route), 📍 place (Maps/Apple/OSM/`geo:`), 🏠 internal IP (172.30./192.168./10./localhost), 🔗 otherwise. |
| **location** | text | Location. Shown as a 📍 badge on the card and copied into the calendar invite as `LOCATION`. |
| **checklist** | list | Sub-items with checkboxes; shown as progress `✓ 2/5` on the card. The **chevron (▾/▴)** at the top right expands/collapses the items directly on the card, where they can also be **ticked off** (saved immediately). |
| **calendarInvite** | yes/no | If enabled **and** a due date is set, a **`.ics` calendar invite** is attached to every notification e-mail for this card. |
| **recurrence** | object | Recurrence rule – see [Recurrence](#recurrence). |

The adapter also manages automatically: `id`, `columnId`, `order`, `createdAt`, `createdBy`, `movedAt`, `doneAt`.

---

## Recurrence

Recurring tasks work **on completion** (the Kanban way): as soon as a recurring card is moved to the "Done" column, a **fresh card** with the next matching due date is created automatically in the first non-done column (checklist items reset). Cards with recurrence carry a 🔁 badge.

If a recurring card is created **without** a manual date, the adapter automatically sets the next matching date.

| Type (`recurrence.type`) | Meaning | Additional fields |
|---|---|---|
| `daily` | Every day | – |
| `weekly` | On specific weekdays | `dayOfWeek`: list `[1..7]` (1 = Monday … 7 = Sunday) |
| `monthly` | Fixed day of month | `dayOfMonth`: `1..31` (the 31st is clamped to the last day in short months) |
| `monthly_weekday` | N-th/last weekday of the month, e.g. **2nd Tuesday** | `ordinal`: `1..4` or `-1` (last), `dayOfWeek`: `[iso]` |
| `workday` | First/last/n-th **working day** of the month | `workdayPos`: `first` / `last` / `nth` / `nth_last`, `n`: for `nth`/`nth_last` |
| `yearly` | Yearly | `month`: `1..12`, `dayOfMonth`: `1..31` |
| `every_n_days` | Every X days from a start date | `interval`: N, `startDate`: `YYYY-MM-DD` |

A **working day** means: not a weekend **and** not a public holiday (see below). Example: "first working day in May" lands on the 4th if May 1st is a holiday/weekend.

---

## Public holidays

For the **working-day recurrences** the adapter computes public holidays itself (Easter formula + fixed dates + the German "Buß- und Bettag"), so even dates far in the future are calculated correctly.

- If the ioBroker **`feiertage`** adapter is installed, the Kanban adapter adopts its **state/region configuration** (which holidays apply). Only genuinely work-free public holidays count – decorative days (e.g. Valentine's Day) are ignored.
- Without the `feiertage` adapter a **fallback** with the nationwide public holidays is used.

> Changes to the `feiertage` adapter are picked up on the next start of `kanban.0`.

---

## Columns & WIP limit

Columns are managed per board via the **gear (⚙)**: create, reorder by drag & drop, rename, delete.

![Settings: board, columns, labels](img/settings.png)

- **WIP limit** (work in progress): a number > 0 caps the recommended card count. If exceeded, the column warns visually (counter & header are highlighted). `0` = no limit. The limit is a **warning**, not a hard block.
- **"Done" column** (`isDone`): cards moved here count as completed (`doneAt` is set, recurrences are triggered).
- **Show/hide done (👁):** every done column has an eye toggle at the top right that shows or hides the completed cards (stored per device).
- **Limit of visible done cards:** the URL parameter `doneLimit=N` (see below) shows only the N most recently completed cards – handy for compact, shared views.

---

## Sharing views / URL parameters

The **🔗 icon** in the header opens the **"Share view"** dialog. There you assemble a filtered view (board, users (multiple), labels (multiple), visible columns, done-card limit, controls to hide) and get a **ready-to-copy URL** below. Ideal for embedding in Lovelace (webpage card) or for sharing.

![Share view](img/share.png)

All parameters can also be appended to the URL directly:

| Parameter | Effect |
|---|---|
| `board=<id>` | Opens this board. |
| `user=<name>` | Sets the active user (chip highlight, "only my cards"). |
| `filter=1` | Enables the person filter for the active user. |
| `users=<name,name>` | **Multi-user filter**: shows cards assigned to at least one of these users. |
| `label=<id,id>` | **Label blacklist** (multiple possible): hides cards that have one of these labels – new labels stay visible automatically. |
| `columns=<id,id>` | Shows only these columns. Others are hidden. |
| `doneLimit=N` | In done columns, show only the N most recently completed cards (`0` = none, omit = all). |
| `hideSettings=1` | Hides the settings gear. |
| `hideFilter=1` | Hides the filter button. |
| `embed=1` | **Embed mode**: hides the whole header bar (for iframe/Lovelace). |
| `theme=auto\|light\|dark` | Forces a theme. |
| `accent=%23RRGGBB` | Accent color (hex, encode `#` as `%23`). |
| `card=<id>` | Opens a card directly (deep link, e.g. from e-mails). |

**Examples**

```
# Compact embed: only board "familie", no header
http://192.168.1.10:8095/?board=familie&embed=1&theme=auto

# Only "In progress" + last 3 done cards, filtered to two people
http://192.168.1.10:8095/?board=familie&columns=doing,done&doneLimit=3&users=bjoern,heike

# Everything except cards with label "private", settings hidden
http://192.168.1.10:8095/?board=familie&label=private&hideSettings=1
```

> **Lovelace/iframe:** the adapter sets **no** frame headers (`X-Frame-Options`/`frame-ancestors`). The CSP added in 0.1.1 is a `<meta>` tag and does **not** restrict embedding – so the UI can still be embedded directly in a Lovelace webpage card or an `<iframe>`.

---

## Notifications

Notifications are triggered on card events and delivered via **e-mail** (through the ioBroker `email` adapter) and/or **outbound webhooks**. In addition, every event is written to the state `kanban.0.lastEvent` (as a script trigger).

### Per-user control

The user table has six checkboxes per user – for which events they should receive an e-mail:

| Event | Trigger |
|---|---|
| **Card assigned** (`notifyAssigned`) | A card was assigned to this user. |
| **Card due** (`notifyDue`) | Due date reached/passed (see reminder time). |
| **Card changed** (`notifyUpdated`) | A card was edited. |
| **Card moved** (`notifyMoved`) | Card moved to another column. |
| **Card done** (`notifyDone`) | Card moved to the done column. |
| **Card created** (`notifyCreated`) | New card created. |

**Fallback:** if a user has nothing set for an event, the **global default** applies (tab "Email", section "Default"). This way existing users keep receiving notifications without having to configure everything individually.

**No self-spam:** whoever triggers a change is not notified about that very change.

**Recipients:** on assignment only the newly assigned user, otherwise all assignees of the card (that have an e-mail address on file).

### E-mail & reminders (tab "Email")

| Setting | Meaning |
|---|---|
| **Email adapter instance** | Which `email.x` instance is used for sending. |
| **Sender** | Optional sender address (empty = email adapter default). |
| **Reminder time** | `HH:MM` – when due cards are checked (default `08:00`). |
| **Remind X days before due** | Lead time for `cardDue` reminders. |
| **Default** | Global fallback switches per event (see above). |

### Calendar invite (.ics)

If **"Calendar invite"** is enabled on a card and a date is set, the adapter attaches a `termin.ics` to the notification e-mail:

- **Without time** → all-day event on the due date.
- **With time** → timed event of one hour duration.
- Title (`SUMMARY`), description, **location** (`LOCATION`) and link (`URL`) are carried over.
- **Time zone:** timed events are emitted unambiguously in UTC; the underlying time zone is determined from the system (or `system.config`) – including daylight saving. All-day events are deliberately time-zone-free.

The attachment is included with **every** notification for the card – so if you enable the invite only later, it arrives with the next "Card changed" mail.

---

## Webhooks – inbound

Other systems (or ioBroker itself) can modify cards/boards via HTTP. Inbound webhooks are secured with **tokens** (tab **"Webhooks (in)"**).

### Token management

| Field | Meaning |
|---|---|
| **name** | Label (shown as the source in logs). |
| **token** | Secret token, part of the URL. |
| **allowedBoards** | `*` = all boards, or a list of allowed board IDs (separated by space/comma). |
| **enabled** | Token active/inactive. |

The **"Generate new token"** button (above the table) automatically adds a new row with a secure random token (32 hex chars) and the name `agent`/`agent1`/…. Then adjust the name, optionally restrict `allowedBoards`, and **Save**. Alternatively fill the token field manually (e.g. `openssl rand -hex 16`). **Recommendation:** use a separate token for each integration (each agent, each script) — that way each one can be revoked or replaced individually via the `enabled` checkbox.

Invalid token → HTTP `401`. Board not allowed → HTTP `403`.

### Generic endpoint (recommended)

```
POST /webhook/<token>/action
Content-Type: application/json
```

The body contains `cmd` plus the appropriate fields. The same **command vocabulary** applies as for `sendTo` and the `action` state:

| `cmd` | Required fields | Additional fields |
|---|---|---|
| `addBoard` | `title` | `id` (optional, otherwise derived from the title) |
| `deleteBoard` | `board` | – |
| `addCard` | `board`, `title` | all card fields (`due`, `assignees`, `labels`, `priority`, `location`, `recurrence`, …), `columnId` |
| `updateCard` (alias `editCard`) | `board`, `cardId`\|`id` | card fields to change |
| `moveCard` | `board`, `cardId`\|`id`, `column`\|`columnId` | `order` |
| `doneCard` | `board`, `cardId`\|`id` | – (moves to the done column) |
| `deleteCard` | `board`, `cardId`\|`id` | – |
| `listBoards` / `getBoards` | – | – |
| `getBoard` | `board` | – |

> **Field-name pitfalls (important!)**
> - The card ID is **`cardId` OR `id`** – **not** `card`.
> - The target column of `moveCard` is **`column` OR `columnId`**.
> - The board is given via **`board` OR `boardId`**.

**Examples**

```bash
TOKEN=your_token
BASE=http://192.168.1.10:8095

# Create a card
curl -X POST "$BASE/webhook/$TOKEN/action" -H 'Content-Type: application/json' -d '{
  "cmd": "addCard",
  "board": "familie",
  "columnId": "todo",
  "title": "Take out the bins",
  "due": "2026-07-20",
  "assignees": ["bjoern"],
  "labels": ["household"],
  "priority": 1
}'

# Move a card to another column
curl -X POST "$BASE/webhook/$TOKEN/action" -H 'Content-Type: application/json' -d '{
  "cmd": "moveCard", "board": "familie", "cardId": "c_abc123", "column": "doing"
}'

# Mark a card as done
curl -X POST "$BASE/webhook/$TOKEN/action" -H 'Content-Type: application/json' -d '{
  "cmd": "doneCard", "board": "familie", "id": "c_abc123"
}'

# Update a card (e.g. enable the calendar invite afterwards)
curl -X POST "$BASE/webhook/$TOKEN/action" -H 'Content-Type: application/json' -d '{
  "cmd": "updateCard", "board": "familie", "id": "c_abc123",
  "calendarInvite": true, "location": "Town hall"
}'

# Delete a card
curl -X POST "$BASE/webhook/$TOKEN/action" -H 'Content-Type: application/json' -d '{
  "cmd": "deleteCard", "board": "familie", "id": "c_abc123"
}'
```

### Resource endpoints (alternative)

The same actions are also available as REST-like webhook routes (token in the URL):

```
POST   /webhook/<token>/boards/<id>/cards
PATCH  /webhook/<token>/boards/<id>/cards/<cardId>
POST   /webhook/<token>/boards/<id>/cards/<cardId>
POST   /webhook/<token>/boards/<id>/cards/<cardId>/move
```

---

## Webhooks – outbound

The adapter can send an **HTTP POST** to arbitrary URLs on every event (tab **"Webhooks (out)"**) – e.g. to Node-RED, IFTTT, a chat service or your own scripts.

| Field | Meaning |
|---|---|
| **name** | Label. |
| **url** | Target URL (receives `POST` with a JSON body). |
| **events** | `*` = all events, or a list of event types (separated by comma/semicolon/space). |
| **enabled** | Active/inactive. |

**Event types:** `cardCreated`, `cardUpdated`, `cardMoved`, `cardAssigned`, `cardDone`, `cardDeleted`, `cardDue`.

**Delivery:** HTTP POST with `Content-Type: application/json`, 5-second timeout, **one** automatic retry after 2 seconds.

**Example payload** (body of the outbound POST):

```json
{
  "event": "cardMoved",
  "ts": "2026-07-12T14:05:46.415Z",
  "board": { "id": "familie", "title": "Family" },
  "card": {
    "id": "c_abc123",
    "title": "Take out the bins",
    "columnId": "doing",
    "due": "2026-07-20",
    "assignees": ["bjoern"],
    "labels": ["household"],
    "priority": 1
  },
  "detail": { "fromColumn": "todo", "toColumn": "doing", "by": "bjoern" }
}
```

Every event has the shape `{ event, ts, board:{id,title}, card:{…}, detail:{…} }`. The `detail` field varies by event type (e.g. `assignee` for `cardAssigned`, `fromColumn`/`toColumn` for `cardMoved`).

---

## REST API

For integrations on the same network there is a REST API (the same one the web UI uses). **Reading** (`GET`) is open, **writing** (`POST`/`PATCH`/`DELETE`) requires a token from 0.1.1 – see [Security & access control](#security--access-control).

| Method & path | Purpose |
|---|---|
| `GET /api/config` | UI configuration (users, theme, accent color). |
| `GET /api/users` | User list. |
| `GET /api/custom.css` | The custom CSS configured in the settings. |
| `GET /avatars/<name>` | A user's avatar image (PNG). |
| `POST /api/users/<name>/avatar` | Set avatar (`{ image: "data:image/png;base64,…" }`, max 512 KB; token required). |
| `DELETE /api/users/<name>/avatar` | Remove avatar (token required). |
| `GET /api/boards` | All boards (short form). |
| `POST /api/boards` | Create a board (`{ id?, title }`). |
| `GET /api/boards/<id>` | Board with all cards. With `?rev=<n>` it returns `{unchanged:true}` if unchanged (polling). |
| `PATCH /api/boards/<id>` | Change a board (title, columns, labels). |
| `DELETE /api/boards/<id>` | Delete a board. |
| `POST /api/boards/<id>/cards` | Create a card. |
| `PATCH /api/boards/<id>/cards/<cardId>` | Change a card. |
| `POST /api/boards/<id>/cards/<cardId>/move` | Move a card (`{ columnId, order }`). |
| `DELETE /api/boards/<id>/cards/<cardId>` | Delete a card. |

> **Write access** to `/api` requires a token from 0.1.1 (`X-Kanban-Token`; the web UI sends it automatically), **reading** stays open on the LAN. Details and limits: [Security & access control](#security--access-control). For external access use the token-based [webhooks](#webhooks--inbound).

---

## Security & access control

> **New in 0.1.1** – added after a security review.

**Write protection for the REST API (token).** Read access (`GET`) to `/api` stays open on the LAN (the web UI and simple dashboards need no token). **Write** access (`POST`/`PATCH`/`DELETE`) requires a token in the `X-Kanban-Token` header. Valid tokens are:

- the automatically generated **SPA secret** (state `kanban.0.info.apiSecret`), which the server hands to its own UI as `<meta name="kanban-token">` – the web UI sends it transparently, nothing to configure;
- any active **inboundToken** (tab "Webhooks (in)"), so scripts/agents can also write via `/api`.

Without a valid token → HTTP `401`. The native setting `apiWriteProtection: false` disables the protection (then `/api` behaves as in 0.1.0).

> **Honest limit of this protection:** because the UI works **without a login**, any device on the same network that loads the page can read the SPA secret. The token thus reliably blocks **third-party websites/CSRF** and naive scanners, but is **not** a substitute for network isolation. For hard isolation, bind the port to the LAN/`127.0.0.1` only and put an authenticating reverse proxy in front.

**Sanitized description preview.** The Markdown description is cleaned with an HTML sanitizer (DOMPurify) before display – embedded `<script>`, `onerror` etc. is removed (protection against stored XSS).

**Safe link schemes only.** A card's link badge is clickable only for `http(s)`, `mailto:`, `tel:` and `geo:`; other schemes (e.g. `javascript:`) are not executed as a link.

**Content Security Policy.** The UI sets a CSP (as `<meta>`) that blocks third-party/inline scripts. It **deliberately omits** `frame-ancestors` so the iframe/Lovelace embedding stays free.

---

## Other integration paths

The same command vocabulary (`addCard`, `moveCard`, …) is reachable in several ways:

**`sendTo` (from ioBroker scripts):**

```javascript
sendTo('kanban.0', 'addCard', {
    board: 'familie',
    title: 'Created from a script',
    due: '2026-07-20',
    assignees: ['bjoern']
}, (res) => log(JSON.stringify(res)));
```

**`action` state:** write a JSON command to the state `kanban.0.action` (without `ack`):

```javascript
setState('kanban.0.action', JSON.stringify({
    cmd: 'moveCard', board: 'familie', cardId: 'c_abc123', column: 'done'
}));
```

The adapter executes the command and clears the state again.

---

## Live sync & deep links

- **WebSocket `/ws`:** on every change the server sends a `dirty` message to all open views, which reload the affected board. All devices see changes almost instantly.
- **Polling fallback:** if the WebSocket is unavailable, the UI periodically checks for changes using `?rev=`.
- **Deep link:** `…/?board=<id>&card=<id>` opens the given card directly – this is how notification e-mails link ("Open card in board").

---

## ioBroker states & objects

Besides the UI, the adapter creates states you can use in scripts, VIS/Lovelace or Node-RED:

| State | Type | Meaning |
|---|---|---|
| `kanban.0.info.connection` | bool | Web server running. |
| `kanban.0.lastEvent` | json | Last triggered event (`{event, ts, board, card, detail}`) – ideal as a script trigger. |
| `kanban.0.action` | json (writable) | Command input, see [Other integration paths](#other-integration-paths). |
| `kanban.0.info.apiSecret` | string | Internal REST-API write token (from 0.1.1). |
| `kanban.0.boards.<id>.data` | json | Full board (cards, columns, labels). |
| `kanban.0.boards.<id>.rev` | number | Revision (increments on every change – for polling). |
| `kanban.0.boards.<id>.cardCount` | number | Number of cards in the board. |
| `kanban.0.boards.<id>.overdueCount` | number | Overdue cards in the board. |
| `kanban.0.users.<name>.assignedCount` | number | Open cards assigned to this person. |
| `kanban.0.users.<name>.overdueCount` | number | Of those, overdue. |
| `kanban.0.users.<name>.overdueList` | json | List of overdue cards (title + board/column). |

The `boards.*` and `users.*` mirror states are handy for dashboards ("Björn: 3 open, 1 overdue") or automations without querying the REST API.

---

## Language / internationalization

The interface is **multilingual**. The default language follows the **system language configured in ioBroker**; the language can optionally be fixed in the instance settings.

Translations live as **one file per language** under `www/i18n/` (e.g. `de.json`, `en.json`). Currently **five languages** are included: **German, English, French, Dutch and Italian** (selectable in the instance "Language" dropdown: Auto/de/en/fr/nl/it). Further languages can be added simply by dropping in another JSON file with the same keys. If no file exists for the requested language, English is used as fallback.

---

## FAQ & pitfalls

- **No e-mails arrive.** Delivery depends entirely on the configured `email` adapter. Check the credentials there (modern mailboxes often require OAuth2 instead of a password). The Kanban adapter only hands over the message.
- **The `.ics` is not attached.** The attachment is only created if **"Calendar invite"** is enabled on the card **and** a **due date** is set.
- **Time without a date disappears.** A time is always tied to a due date – without a date it is discarded.
- **Color selection.** The adapter deliberately uses an **embedded** color picker (not the native system dialog), so the full color space including hex input is available on every device, mobile included.
- **Custom design (theming).** Via **instance settings → General → "Custom CSS"** you can restyle the UI. It is based on CSS variables you can override – e.g. for a black-and-orange look (inspired by Lovelace):

  ```css
  :root, html[data-theme="dark"] {
    --bg: #000000;                  /* page background */
    --surface: #161616;             /* cards & dialogs */
    --surface2: rgba(10,10,10,.55); /* column background */
    --text: #f5f5f5;
    --border: rgba(255,152,0,.3);   /* borders (everywhere) */
    --accent: #ff9800 !important;   /* accent color */
  }
  .column { border: 1px solid var(--border); }
  ```

  Key variables: `--bg`, `--surface`, `--surface2`, `--text`, `--muted`, `--border`, `--accent`, `--danger`, `--warn`, `--radius`. The `!important` on `--accent` is required because the accent color is also set via the config field.
- **A webhook command fails with "card 'undefined' does not exist".** Almost always the wrong ID field: it is `cardId` or `id`, **not** `card`.
- **New columns missing in a shared URL.** The `columns=` filter is static. If a column is added later, the view must be shared again. In the "Share view" dialog itself, columns are detected live.
