#!/usr/bin/env python3
"""
Agenten-Dispatcher für das ioBroker-Kanban-Board.

Empfängt die AUSGEHENDEN Webhooks des Adapters und triggert – je nachdem, WEM
eine Karte zugewiesen wurde – den passenden Agenten.

Einrichtung im Adapter (Instanzeinstellungen → Tab „Webhooks (ausgehend)"):
    name:   Agenten-Dispatcher
    url:    http://<HOST-DIESES-SKRIPTS>:5005/kanban
    events: cardAssigned        (oder * für alle; hier reicht cardAssigned)

Start:  python3 agent-webhook-dispatcher.py

Der Adapter sendet bei JEDER Zuweisung ein JSON wie:
    {
      "event": "cardAssigned",
      "ts": "2026-07-13T09:12:00.000Z",
      "board": { "id": "familie", "title": "Familie" },
      "card":  { "id": "c_...", "title": "...", "description": "...",
                 "assignees": ["nina"], "due": "2026-07-20", ... },
      "detail": { "assignee": "nina", "by": "webhook:hermes" }
    }
`detail.assignee` ist die Benutzer-ID (Feld `name` der Registry, NICHT der Anzeigename).
Wird eine Karte mehreren zugewiesen, kommt PRO Person ein eigener Webhook.
"""
import json
import threading
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

LISTEN_PORT = 5005

# Benutzer-ID  ->  Trigger für den Agenten.
# Variante A (unten genutzt): HTTP-Endpunkt des Agenten, bekommt den Task als JSON.
# Menschliche Nutzer (z.B. bjoern/heike) einfach weglassen -> werden ignoriert.
AGENT_ENDPOINTS = {
    "nina":   "http://127.0.0.1:5101/trigger",
    "hermes": "http://127.0.0.1:5102/trigger",
}


def trigger_agent(assignee, task):
    url = AGENT_ENDPOINTS.get(assignee)
    if not url:
        print(f"  kein Agent für '{assignee}' hinterlegt – übersprungen")
        return
    try:
        req = urllib.request.Request(
            url, data=json.dumps(task).encode("utf-8"),
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=15) as r:
            print(f"  → Agent '{assignee}' getriggert (HTTP {r.status})")
    except Exception as e:
        print(f"  ! Fehler beim Triggern von '{assignee}': {e}")


def process(event):
    if event.get("event") != "cardAssigned":
        return
    assignee = (event.get("detail") or {}).get("assignee")
    card = event.get("card") or {}
    board = event.get("board") or {}
    task = {
        "assignee": assignee,
        "board": board.get("id"),
        "cardId": card.get("id"),
        "title": card.get("title"),
        "description": card.get("description"),
        "due": card.get("due"),
        "dueTime": card.get("dueTime"),
        "priority": card.get("priority"),
        "labels": card.get("labels"),
        "link": card.get("link"),
        "location": card.get("location"),
    }
    print(f"cardAssigned: '{task['title']}' → {assignee}")
    trigger_agent(assignee, task)


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length) if length else b"{}"
        # sofort 200 quittieren (der Adapter hat nur ~5 s Timeout) …
        self.send_response(200)
        self.send_header("Content-Length", "0")
        self.end_headers()
        # … und die eigentliche Arbeit im Hintergrund erledigen
        try:
            event = json.loads(body)
        except json.JSONDecodeError:
            return
        threading.Thread(target=process, args=(event,), daemon=True).start()

    def log_message(self, *a):
        pass  # eigenes Logging in process()


if __name__ == "__main__":
    print(f"Agenten-Dispatcher lauscht auf 0.0.0.0:{LISTEN_PORT} (POST /kanban)")
    ThreadingHTTPServer(("0.0.0.0", LISTEN_PORT), Handler).serve_forever()
