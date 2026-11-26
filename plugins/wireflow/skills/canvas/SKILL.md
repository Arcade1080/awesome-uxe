---
name: canvas
description: Öffnet den Wireflow-Canvas – eine lokale Web-App, in der Screens aus echten DS-Komponenten gerendert, angeordnet, verbunden und als Prototyp durchgeklickt werden. Verwenden, wenn die Person Flows oder Screens sehen, mit der Maus gestalten oder Claude auf eine Auswahl im Canvas ansetzen will.
argument-hint: "[flow-id]"
---

# Canvas öffnen

1. `canvas_open` aufrufen. Das Werkzeug startet den Canvas (nur auf `127.0.0.1`, mit Zugangstoken im Link) und gibt die URL zurück.
2. Der Person den Link nennen und in einem Satz sagen, was sie dort tun kann.
3. Läuft Claude Code in der Cloud oder auf einem anderen Rechner, ist `127.0.0.1` dort nicht erreichbar: Dann im Terminal der Person `wireflow serve --open` im Repository vorschlagen.

## Was der Canvas kann

- **Design:** Screens als echte Komponenten; Elemente anklicken und im Inspector Props, Text und Interaktion ändern; Komponenten aus der Liste auf Screens ziehen; Elemente per Drag & Drop umordnen; Screens am Titel verschieben; Wireframe/Hi-Fi umschalten. Alles wird als Code in die Screen-Module geschrieben.
- **Prototyp:** den Flow durchklicken; Variablen steuern Entscheidungen; fehlende Pfade werden gemeldet.
- **Journey:** Story Map – Phasen, Schritte, Pain Points und Bedarfe ohne Lösung; darunter Anforderungen mit Screens. Bearbeitbar; speichert in die Journey-Datei. Offene Punkte liefert auch `journey_get`.
- **Wissen:** Insights, Annahmen nach Risiko, offene Fragen.

## Zusammenarbeit mit Claude

- Änderungen von Claude (`screen_edit`, `flow_edit`, `variant_create` …) erscheinen sofort im Canvas; der bearbeitete Screen leuchtet, Werkzeug-Aufrufe stehen im Chat.
- Was die Person auswählt, liest Claude mit `canvas_selection` – „ändere das Ausgewählte“ funktioniert ohne IDs.
- Rückgängig: Strg/⌘+Z im Canvas oder das Werkzeug `undo`.

## Chat im Canvas

Die rechte Spalte hat drei Reiter: **Design** (Inspector), **Code** (Screen-Modul und Stories, markiertes Element) und **Chat**. Chat-Nachrichten, Aufträge aus dem **Kontextmenü** (Rechtsklick, Taste `.`: Varianten Strikt/Geführt/Frei, Review mit Persona, Weiter, Zustände) und aus **Lückenkarten** gehen an diese Sitzung:

- **Über den Plugin-Monitor `canvas-chat`** (Standard) kommt jede Nachricht sofort als Benachrichtigung: „Nachricht aus dem Wireflow-Canvas (chat_id …): „…“ – Auswahl: …“. Dann `canvas_inbox` aufrufen.
- **Mit Kanal** (Research Preview, optional) als `<channel … chat_id="…" screen="…" element="…">` – nur, wenn kein Monitor läuft.
- **Ohne beides** erinnern die Hooks beim nächsten Prompt bzw. am Ende eines Schritts; dann `canvas_inbox` aufrufen.
- **Immer** mit `canvas_reply` antworten (chat_id übernehmen), kurz und konkret. Varianten mit `variant_create` anlegen, Reviews nur berichten, nichts ändern.
