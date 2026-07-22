#!/usr/bin/env python3
"""
Referenz: lokaler Ollama-Agent (z.B. Hermes) liest und schreibt das ioBroker-
Kanban-Board per Function-Calling. Alles lokal im Netz, kein HTTPS nötig.

Ablauf: Das LLM entscheidet, WELCHES Tool mit WELCHEN Argumenten. Dieses Skript
(die "Glue"-Schicht) führt den eigentlichen HTTP-Aufruf zum Kanban-Adapter aus
und gibt das Ergebnis ans Modell zurück. Die kniffligen Feldnamen (cmd, id vs.
cardId) sind hier fest verdrahtet – das Modell sieht nur saubere Argumente.

Voraussetzungen:  pip install requests   +   ein tool-fähiges Modell in Ollama
(z.B.  ollama pull hermes3 ).
"""
import json
import requests

# ---- Konfiguration -------------------------------------------------------
OLLAMA_URL = "http://localhost:11434/api/chat"      # Ollama auf demselben Host
MODEL      = "hermes3"                                # tool-fähiges Modell
KANBAN_URL = "http://192.168.1.10:8095/webhook/DEIN_INBOUND_TOKEN/action"

SYSTEM_PROMPT = (
    "Du bist ein Assistent, der ein Kanban-Board verwaltet. "
    "Bevor du etwas schreibst oder änderst, lies mit kanban_get_board das aktuelle "
    "Board, um die gültigen Spalten-IDs (columnId), Label-IDs und Benutzer-IDs (name) "
    "zu kennen. Datumsangaben immer im Format YYYY-MM-DD. Antworte dem Nutzer knapp "
    "auf Deutsch, wenn die Aufgabe erledigt ist."
)

# ---- Kanban-Aufruf -------------------------------------------------------
def kanban(cmd, **fields):
    r = requests.post(KANBAN_URL, json={"cmd": cmd, **fields}, timeout=15)
    r.raise_for_status()
    return r.json()

# ---- Tool-Dispatcher: Toolname -> Kanban-Kommando ------------------------
def run_tool(name, args):
    try:
        if name == "kanban_get_boards":
            return kanban("getBoards")
        if name == "kanban_get_board":
            return kanban("getBoard", boardId=args["boardId"])
        if name == "kanban_add_card":
            return kanban("addCard", **args)
        if name == "kanban_update_card":
            return kanban("updateCard", **args)          # args enthält board + cardId + Felder
        if name == "kanban_move_card":
            return kanban("moveCard", **args)            # board + cardId + columnId
        if name == "kanban_done_card":
            return kanban("doneCard", **args)            # board + cardId
        if name == "kanban_delete_card":
            return kanban("deleteCard", board=args["board"], id=args["cardId"])  # HIER: id, nicht cardId
        return {"error": f"unbekanntes Tool: {name}"}
    except Exception as e:
        return {"error": str(e)}

# ---- Tool-Schemas (OpenAI/Ollama-Format) ---------------------------------
def obj(props, required):
    return {"type": "object", "properties": props, "required": required}

S = {"type": "string"}
CARD_FIELDS = {
    "board": S, "title": S, "columnId": S, "description": S, "due": S, "dueTime": S,
    "assignees": {"type": "array", "items": S}, "labels": {"type": "array", "items": S},
    "priority": {"type": "integer"}, "location": S, "link": S, "calendarInvite": {"type": "boolean"},
}
TOOLS = [
    {"type": "function", "function": {"name": "kanban_get_boards",
        "description": "Liste aller Boards (id, Titel, Kartenzahl).",
        "parameters": obj({}, [])}},
    {"type": "function", "function": {"name": "kanban_get_board",
        "description": "Ein Board komplett lesen: Spalten, Labels, alle Karten.",
        "parameters": obj({"boardId": S}, ["boardId"])}},
    {"type": "function", "function": {"name": "kanban_add_card",
        "description": "Neue Karte anlegen. Pflicht: board, title.",
        "parameters": obj(CARD_FIELDS, ["board", "title"])}},
    {"type": "function", "function": {"name": "kanban_update_card",
        "description": "Karte ändern. Pflicht: board, cardId. Nur zu ändernde Felder mitgeben.",
        "parameters": obj({**CARD_FIELDS, "cardId": S}, ["board", "cardId"])}},
    {"type": "function", "function": {"name": "kanban_move_card",
        "description": "Karte in eine andere Spalte verschieben.",
        "parameters": obj({"board": S, "cardId": S, "columnId": S}, ["board", "cardId", "columnId"])}},
    {"type": "function", "function": {"name": "kanban_done_card",
        "description": "Karte als erledigt markieren.",
        "parameters": obj({"board": S, "cardId": S}, ["board", "cardId"])}},
    {"type": "function", "function": {"name": "kanban_delete_card",
        "description": "Karte löschen.",
        "parameters": obj({"board": S, "cardId": S}, ["board", "cardId"])}},
]

# ---- Chat-Loop -----------------------------------------------------------
def chat(user_text, max_steps=6):
    messages = [{"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_text}]
    for _ in range(max_steps):
        resp = requests.post(OLLAMA_URL, json={
            "model": MODEL, "messages": messages, "tools": TOOLS, "stream": False,
        }, timeout=120).json()
        msg = resp["message"]
        messages.append(msg)
        calls = msg.get("tool_calls")
        if not calls:
            return msg.get("content", "")
        for tc in calls:
            fn = tc["function"]
            args = fn["arguments"] if isinstance(fn["arguments"], dict) else json.loads(fn["arguments"])
            result = run_tool(fn["name"], args)
            messages.append({"role": "tool", "content": json.dumps(result, ensure_ascii=False)})
    return "(Maximale Anzahl Schritte erreicht.)"

if __name__ == "__main__":
    import sys
    frage = " ".join(sys.argv[1:]) or "Welche Karten sind im Board 'familie' offen und wer ist zuständig?"
    print(chat(frage))
