"""
kanban_skill.py — Wiederverwendbarer Skill für lokale (Ollama-)Agenten, um das
ioBroker-Kanban-Board zu lesen und zu schreiben.

Framework-unabhängig, ohne externe Abhängigkeiten (nur Standardbibliothek).
Zwei Nutzungsarten:

  1) Direkt aus Agenten-Code:
       from kanban_skill import KanbanSkill
       kb = KanbanSkill("http://192.168.1.10:8095", "DEIN_INBOUND_TOKEN")
       board = kb.get_board("familie")
       kb.add_card("familie", "Müll rausbringen", due="2026-07-15", assignees=["bjoern"])

  2) Als LLM-Werkzeuge (Ollama/OpenAI Function-Calling):
       resp = ollama_chat(model, messages, tools=kb.tools)      # kb.tools -> Schemas
       for call in resp["message"].get("tool_calls", []):
           result = kb.run(call["function"]["name"], call["function"]["arguments"])
       # Ergebnis (dict) als role:"tool"-Nachricht zurück ans Modell geben.

Die kniffligen Rohschnittstellen-Details (Kommandonamen, Feldname `id` vs.
`cardId`) sind hier gekapselt — das LLM sieht nur saubere Argumente.
"""

import json
import urllib.request
import urllib.error

__all__ = ["KanbanSkill", "KanbanError"]


class KanbanError(RuntimeError):
    """Fehler beim Zugriff auf das Kanban-Board."""


class KanbanSkill:
    #: Empfohlener System-Prompt-Baustein für den Agenten.
    SYSTEM_PROMPT = (
        "Du kannst ein Kanban-Board lesen und verwalten. Lies vor jeder Änderung "
        "mit kanban_get_board das Board, um gültige Spalten-IDs (columnId), "
        "Label-IDs und Benutzer-IDs (Feld 'name') zu kennen — rate sie nie. "
        "Datumsangaben immer als YYYY-MM-DD, Uhrzeiten als HH:MM."
    )

    def __init__(self, base_url, token, timeout=15):
        """base_url z.B. 'http://192.168.1.10:8095', token = Inbound-Token des Adapters."""
        self.endpoint = f"{base_url.rstrip('/')}/webhook/{token}/action"
        self.timeout = timeout

    # ---- Rohaufruf -------------------------------------------------------
    def _call(self, cmd, **fields):
        body = {"cmd": cmd}
        body.update({k: v for k, v in fields.items() if v is not None})
        data = json.dumps(body).encode("utf-8")
        req = urllib.request.Request(
            self.endpoint, data=data, method="POST",
            headers={"Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as r:
                return json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", "replace")
            raise KanbanError(f"HTTP {e.code}: {detail}") from e
        except urllib.error.URLError as e:
            raise KanbanError(f"Verbindung fehlgeschlagen: {e.reason}") from e

    # ---- High-Level-API (direkt aus Code nutzbar) ------------------------
    def get_boards(self):
        """Liste aller Boards (id, Titel, Kartenzahl)."""
        return self._call("getBoards")

    def get_board(self, board):
        """Ein Board komplett: Spalten, Labels, alle Karten."""
        return self._call("getBoard", boardId=board)

    def add_card(self, board, title, columnId=None, description=None, due=None,
                 dueTime=None, assignees=None, labels=None, priority=None,
                 location=None, link=None, calendarInvite=None, recurrence=None):
        """Neue Karte anlegen (nur board + title sind Pflicht)."""
        return self._call("addCard", board=board, title=title, columnId=columnId,
                          description=description, due=due, dueTime=dueTime,
                          assignees=assignees, labels=labels, priority=priority,
                          location=location, link=link, calendarInvite=calendarInvite,
                          recurrence=recurrence)

    def update_card(self, board, cardId, **fields):
        """Karte ändern — nur zu ändernde Felder als kwargs übergeben."""
        return self._call("updateCard", board=board, cardId=cardId, **fields)

    def move_card(self, board, cardId, columnId):
        """Karte in eine andere Spalte verschieben."""
        return self._call("moveCard", board=board, cardId=cardId, columnId=columnId)

    def done_card(self, board, cardId):
        """Karte als erledigt markieren (löst ggf. Wiederholung aus)."""
        return self._call("doneCard", board=board, cardId=cardId)

    def delete_card(self, board, cardId):
        """Karte löschen. (Rohschnittstelle erwartet 'id' — hier gekapselt.)"""
        return self._call("deleteCard", board=board, id=cardId)

    # ---- LLM-Werkzeuge (Ollama/OpenAI Function-Calling) ------------------
    @property
    def tools(self):
        """Tool-Schemas im OpenAI/Ollama-Format (Liste für den `tools`-Parameter)."""
        S = {"type": "string"}
        card = {
            "board": S, "title": S, "columnId": S, "description": S, "due": S, "dueTime": S,
            "assignees": {"type": "array", "items": S}, "labels": {"type": "array", "items": S},
            "priority": {"type": "integer", "description": "0 normal, 1 hoch, 2 dringend"},
            "location": S, "link": S, "calendarInvite": {"type": "boolean"},
        }

        def fn(name, desc, props, required):
            return {"type": "function", "function": {
                "name": name, "description": desc,
                "parameters": {"type": "object", "properties": props, "required": required},
            }}

        return [
            fn("kanban_get_boards", "Liste aller Boards (id, Titel, Kartenzahl).", {}, []),
            fn("kanban_get_board", "Ein Board komplett lesen: Spalten, Labels, alle Karten.",
               {"board": S}, ["board"]),
            fn("kanban_add_card", "Neue Karte anlegen. Pflicht: board, title.",
               card, ["board", "title"]),
            fn("kanban_update_card", "Karte ändern. Pflicht: board, cardId. Nur zu ändernde Felder mitgeben.",
               {**card, "cardId": S}, ["board", "cardId"]),
            fn("kanban_move_card", "Karte in eine andere Spalte verschieben.",
               {"board": S, "cardId": S, "columnId": S}, ["board", "cardId", "columnId"]),
            fn("kanban_done_card", "Karte als erledigt markieren.",
               {"board": S, "cardId": S}, ["board", "cardId"]),
            fn("kanban_delete_card", "Karte löschen.",
               {"board": S, "cardId": S}, ["board", "cardId"]),
        ]

    #: Toolname -> Methode
    _DISPATCH = {
        "kanban_get_boards": "get_boards",
        "kanban_get_board": "get_board",
        "kanban_add_card": "add_card",
        "kanban_update_card": "update_card",
        "kanban_move_card": "move_card",
        "kanban_done_card": "done_card",
        "kanban_delete_card": "delete_card",
    }

    def run(self, name, args):
        """Einen Tool-Call des LLM ausführen. Gibt IMMER ein dict zurück
        (bei Fehlern {'error': ...}), damit das Modell darauf reagieren kann."""
        method = self._DISPATCH.get(name)
        if not method:
            return {"error": f"unbekanntes Tool: {name}"}
        if isinstance(args, str):
            try:
                args = json.loads(args or "{}")
            except json.JSONDecodeError:
                return {"error": "Argumente sind kein gültiges JSON"}
        try:
            return getattr(self, method)(**(args or {}))
        except TypeError as e:
            return {"error": f"falsche/fehlende Argumente: {e}"}
        except KanbanError as e:
            return {"error": str(e)}


# Mini-Selbsttest:  python3 kanban_skill.py <base_url> <token> [board]
if __name__ == "__main__":
    import sys
    base = sys.argv[1] if len(sys.argv) > 1 else "http://192.168.1.10:8095"
    tok = sys.argv[2] if len(sys.argv) > 2 else ""
    kb = KanbanSkill(base, tok)
    print("Tools:", [t["function"]["name"] for t in kb.tools])
    print("Boards:", json.dumps(kb.get_boards(), ensure_ascii=False))
    if len(sys.argv) > 3:
        b = kb.get_board(sys.argv[3])
        print("Spalten:", [c["title"] for c in b.get("columns", [])],
              "| Karten:", len(b.get("cards", [])))
