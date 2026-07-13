# iobroker.kanban

Kanban board adapter for ioBroker with its **own web server**, live sync, webhooks, multi-user support and e-mail notifications (including calendar invites) via the `email` adapter.

![Kanban board](docs/en/img/board.png)

📖 **Full documentation:** [English](docs/en/README.md) · [Deutsch](docs/de/README.md)

## Installation

> This adapter is **not** (yet) in the official ioBroker repository — install it directly from GitHub.

**Via the admin UI:** *Adapters* tab → **GitHub/Octocat icon** ("install from custom URL") → *custom / ANY* tab → enter this URL and install:

```
https://github.com/bmueller77/iobroker.kanban
```

**Via the command line** (on the ioBroker host):

```bash
iobroker url https://github.com/bmueller77/iobroker.kanban
```

Then create an instance `kanban.0` and open the web UI: `http://<host>:8095/`

> ⚠️ Adapters installed from GitHub receive **no automatic updates** and run "at your own risk". To update, simply install again as above.

## Features

- **Own web server** (default port 8095) — the web UI is served directly by the adapter; no `iobroker upload` needed for UI updates
- **Multiple boards** with freely configurable columns (name, order, WIP limit, "done" flag)
- **Cards** with title, Markdown description, assignees, due date (optionally with time), labels, color, priority, checklist, link, location and calendar invite
- **Recurring tasks** (daily/weekly/monthly/yearly, n-th weekday, n-th working day incl. public-holiday calculation)
- **Drag & drop** (mouse + touch), live sync across all open views via WebSocket (polling fallback)
- **Multi-user without login**: user registry in the admin config; active user chosen in the UI or via URL parameter
- **E-mail notifications** via `iobroker.email` on assignment, due date and card events (toggleable per event type and per user)
- **Webhooks inbound** (token-secured) and **outbound** (JSON POST on events)
- **Share view**: dialog to build filtered, embeddable links
- **iframe-friendly** (no frame headers) with `?embed=1` mode for Lovelace & co.
- **Multilingual** (de, en, fr, nl, it), theming (light/dark/auto, accent color, custom CSS)

## Web UI / URL parameters

`http://<host>:8095/` with optional parameters (excerpt — full list in the [docs](docs/en/README.md#sharing-views--url-parameters)):

| Parameter | Effect |
|---|---|
| `board=<id>` | preselect a board |
| `user=<name>` | set the active user |
| `filter=1` | show only the active user's cards |
| `label=<id,id>` | label **blacklist**: hide cards with these labels |
| `columns=<id,id>` | show only these columns |
| `doneLimit=N` | in done columns show only N cards (`0` = none, omit = all) |
| `theme=light\|dark\|auto` | force a theme |
| `embed=1` | borderless view without the header bar (for iframes) |
| `card=<id>` | open a card dialog directly (deep link from e-mails) |
| `lang=de\|en\|fr\|nl\|it` | force a language |

### Lovelace embedding

```yaml
type: iframe
url: http://<host>:8095/?board=family&embed=1&theme=auto&user=user1
aspect_ratio: 75%
```

## REST API

For integrations on the local network (the same API the web UI uses). **Reading** (`GET`) is open; **writing** (`POST`/`PATCH`/`DELETE`) requires a token from 0.1.1 (`X-Kanban-Token`; the web UI sends it automatically) — see [Security](docs/en/README.md#security--access-control).

| Method | Route | Purpose |
|---|---|---|
| GET | `/api/boards` | board list |
| POST | `/api/boards` | create a board `{title}` |
| GET | `/api/boards/:id` | board JSON; with `?rev=<n>` → `{unchanged:true}` if current |
| PATCH | `/api/boards/:id` | `{title?, columns?, labels?}` |
| DELETE | `/api/boards/:id` | delete a board |
| POST | `/api/boards/:id/cards` | create a card |
| PATCH | `/api/boards/:id/cards/:cardId` | update a card partially |
| POST | `/api/boards/:id/cards/:cardId/move` | `{columnId, order?}` |
| DELETE | `/api/boards/:id/cards/:cardId` | delete a card |

## Webhooks & commands

External systems (scripts, agents) modify boards/cards token-secured via `POST /webhook/<token>/action`. The same command vocabulary applies as for `sendTo` and the `action` state:

```bash
curl -X POST http://<host>:8095/webhook/<token>/action \
  -H 'Content-Type: application/json' \
  -d '{"cmd":"addCard","board":"family","title":"Buy milk","assignees":["user1"],"due":"2026-07-15"}'
```

Commands: `listBoards`, `getBoard`, `addBoard`, `deleteBoard`, `addCard`, `updateCard`, `moveCard`, `doneCard`, `deleteCard`. From ioBroker scripts:

```js
sendTo('kanban.0', 'addCard', { board: 'family', title: 'From a script' }, res => log(JSON.stringify(res)));
setState('kanban.0.action', JSON.stringify({ cmd: 'doneCard', board: 'family', cardId: 'c_xyz' }));
```

**Outbound webhooks** send a JSON POST to configured URLs on events (`cardCreated, cardUpdated, cardMoved, cardAssigned, cardDone, cardDeleted, cardDue`). Details in the [docs](docs/en/README.md#webhooks--inbound).

## States (for scripts/visualization)

| State | Content |
|---|---|
| `kanban.0.boards.<id>.data` | full board as JSON (read-only) |
| `kanban.0.boards.<id>.rev` / `.cardCount` / `.overdueCount` | revision & counters |
| `kanban.0.users.<name>.assignedCount` / `.overdueCount` / `.overdueList` | per user |
| `kanban.0.lastEvent` | last event as JSON (can trigger scripts) |
| `kanban.0.action` | command input (write JSON, cleared after processing) |

## Security

From **0.1.1**: token-secured write API, Markdown preview sanitized with DOMPurify (no stored XSS), a Content Security Policy and safe link schemes only. The web UI works without a login — the token blocks third-party websites/CSRF but is **not** a substitute for network isolation. For hard isolation, bind the port to the LAN only or put an authenticating reverse proxy in front. Details: [Security & access control](docs/en/README.md#security--access-control).

## Requirements

- js-controller ≥ 6.0.11, Node.js ≥ 18
- For e-mail notifications: a configured `iobroker.email` instance
- Optional: `iobroker.feiertage` for region-accurate public-holiday calculation of the working-day recurrences

## Changelog

- **0.1.3** — Fix: the column task count now respects the active person/label filter (previously showed the column total)
- **0.1.2** — "Share view": `doneLimit` distinguishes empty=all / 0=none; label filter is now a blacklist (new labels stay visible)
- **0.1.1** — Security: token-protected write API, sanitized Markdown preview, CSP, safe link schemes
- **0.1.0** — Initial release

## License

MIT © 2026 Björn Müller
