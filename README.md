# ioBroker.kanban

Kanban-Board-Adapter für ioBroker mit **eigenem Webserver**, Live-Sync, Webhooks, Multiuser-Support und E-Mail-Benachrichtigungen (inkl. Kalender-Einladung) über den `email`-Adapter.

![Kanban-Board](docs/de/img/board.png)

📖 **Ausführliche Dokumentation:** [Deutsch](docs/de/README.md) · [English](docs/en/README.md)

## Installation

> Dieser Adapter ist (noch) **nicht** im offiziellen ioBroker-Repo — Installation direkt von GitHub.

**Über die Admin-Oberfläche:** Reiter *Adapter* → **GitHub-/Octocat-Symbol** („aus eigener Quelle installieren") → Reiter *beliebig / ANY* → folgende URL eintragen und installieren:

```
https://github.com/bmueller77/iobroker.kanban
```

**Über die Kommandozeile** (auf dem ioBroker-Host):

```bash
iobroker url https://github.com/bmueller77/iobroker.kanban
```

Anschließend eine Instanz `kanban.0` anlegen und die Web-UI öffnen: `http://<host>:8095/`

> ⚠️ Von GitHub installierte Adapter erhalten **keine automatischen Updates** und laufen „auf eigene Gefahr". Für ein Update einfach erneut wie oben installieren.

## Features

- **Eigener Webserver** (Standard-Port 8095) — Web-UI direkt vom Adapter ausgeliefert, kein `iobroker upload` bei UI-Updates nötig
- **Mehrere Boards** mit frei konfigurierbaren Spalten (Name, Reihenfolge, WIP-Limit, „Erledigt"-Flag)
- **Karten** mit Titel, Markdown-Beschreibung, Zuständigen, Fälligkeitsdatum (optional mit Uhrzeit), Labels, Farbe, Priorität, Checkliste, Link, Ort und Kalender-Einladung
- **Wiederkehrende Aufgaben** (täglich/wöchentlich/monatlich/jährlich, n-ter Wochentag, n-ter Arbeitstag inkl. Feiertagsberechnung)
- **Drag & Drop** (Maus + Touch), Live-Sync zwischen allen offenen Ansichten über WebSocket (Polling-Fallback)
- **Multiuser ohne Login**: Benutzer-Registry in der Admin-Config; aktiver Benutzer per UI-Auswahl oder URL-Parameter
- **E-Mail-Benachrichtigungen** via `iobroker.email` bei Zuweisung, Fälligkeit und Karten-Ereignissen (je Ereignistyp und je Benutzer abschaltbar)
- **Webhooks eingehend** (Token-gesichert) und **ausgehend** (JSON-POST bei Ereignissen)
- **Ansicht teilen**: Dialog zum Erzeugen gefilterter, einbettbarer Links
- **iframe-tauglich** (keine Frame-Header) mit `?embed=1`-Modus für Lovelace & Co.
- **Mehrsprachig** (de, en, fr, nl, it), Theming (hell/dunkel/auto, Akzentfarbe, eigenes CSS)

## Web-UI / URL-Parameter

`http://<host>:8095/` mit optionalen Parametern (Auszug — vollständige Liste in der [Doku](docs/de/README.md#ansichten-teilen--url-parameter)):

| Parameter | Wirkung |
|---|---|
| `board=<id>` | Board vorauswählen |
| `user=<name>` | aktiven Benutzer setzen |
| `filter=1` | nur Karten des aktiven Benutzers anzeigen |
| `label=<id,id>` | Label-**Blacklist**: Karten mit diesen Labels ausblenden |
| `columns=<id,id>` | nur diese Spalten anzeigen |
| `doneLimit=N` | in Erledigt-Spalten nur N Karten (`0` = keine, weglassen = alle) |
| `theme=light\|dark\|auto` | Theme erzwingen |
| `embed=1` | randlose Ansicht ohne Kopfzeile (für iframes) |
| `card=<id>` | Karten-Dialog direkt öffnen (Deep-Link aus E-Mails) |
| `lang=de\|en\|fr\|nl\|it` | Sprache erzwingen |

### Lovelace-Einbindung

```yaml
type: iframe
url: http://<host>:8095/?board=familie&embed=1&theme=auto&user=user1
aspect_ratio: 75%
```

## REST-API

Für Integrationen im Heimnetz (dieselbe API, die die Web-UI nutzt). **Lesen** (`GET`) ist offen; **Schreiben** (`POST`/`PATCH`/`DELETE`) erfordert ab 0.1.1 einen Token (`X-Kanban-Token`; die Web-UI schickt ihn automatisch mit) — siehe [Sicherheit](docs/de/README.md#sicherheit--zugriffsschutz).

| Methode | Route | Zweck |
|---|---|---|
| GET | `/api/boards` | Board-Liste |
| POST | `/api/boards` | Board anlegen `{title}` |
| GET | `/api/boards/:id` | Board-JSON; mit `?rev=<n>` → `{unchanged:true}` wenn aktuell |
| PATCH | `/api/boards/:id` | `{title?, columns?, labels?}` |
| DELETE | `/api/boards/:id` | Board löschen |
| POST | `/api/boards/:id/cards` | Karte anlegen |
| PATCH | `/api/boards/:id/cards/:cardId` | Karte partiell ändern |
| POST | `/api/boards/:id/cards/:cardId/move` | `{columnId, order?}` |
| DELETE | `/api/boards/:id/cards/:cardId` | Karte löschen |

## Webhooks & Kommandos

Externe Systeme (Skripte, Agenten) verändern Boards/Karten token-gesichert über `POST /webhook/<token>/action`. Es gilt dasselbe Kommando-Vokabular wie bei `sendTo` und dem `action`-State:

```bash
curl -X POST http://<host>:8095/webhook/<token>/action \
  -H 'Content-Type: application/json' \
  -d '{"cmd":"addCard","board":"familie","title":"Milch kaufen","assignees":["user1"],"due":"2026-07-15"}'
```

Kommandos: `listBoards`, `getBoard`, `addBoard`, `deleteBoard`, `addCard`, `updateCard`, `moveCard`, `doneCard`, `deleteCard`. Aus ioBroker-Skripten:

```js
sendTo('kanban.0', 'addCard', { board: 'familie', title: 'Aus Skript' }, res => log(JSON.stringify(res)));
setState('kanban.0.action', JSON.stringify({ cmd: 'doneCard', board: 'familie', cardId: 'c_xyz' }));
```

**Ausgehende Webhooks** senden bei Ereignissen (`cardCreated, cardUpdated, cardMoved, cardAssigned, cardDone, cardDeleted, cardDue`) einen JSON-POST an konfigurierte URLs. Details in der [Doku](docs/de/README.md#webhooks--eingehend).

## States (für Skripte/Visualisierung)

| State | Inhalt |
|---|---|
| `kanban.0.boards.<id>.data` | komplettes Board als JSON (read-only) |
| `kanban.0.boards.<id>.rev` / `.cardCount` / `.overdueCount` | Revision & Zähler |
| `kanban.0.users.<name>.assignedCount` / `.overdueCount` / `.overdueList` | je Benutzer |
| `kanban.0.lastEvent` | letztes Ereignis als JSON (triggerbar) |
| `kanban.0.action` | Kommando-Eingang (JSON schreiben, wird nach Verarbeitung geleert) |

## Sicherheit

Ab **0.1.1**: token-gesicherte Schreib-API, mit DOMPurify bereinigte Markdown-Vorschau (kein gespeichertes XSS), Content-Security-Policy und nur sichere Link-Schemata. Die Web-UI arbeitet ohne Login 