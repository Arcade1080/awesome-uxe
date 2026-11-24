---
name: prototype
description: Prototyp eines Flows vorbereiten und testen – alle Hotspots verdrahten, Entscheidungen über Variablen steuerbar machen, Pfade prüfen und Testaufgaben für Usability-Tests anlegen, die offene Annahmen prüfen. Verwenden vor Tests mit Nutzer:innen oder um einen Flow durchzuspielen.
argument-hint: "[flow-id] [--task \"aufgabe\"]"
---

# Prototyp vorbereiten und testen

Der Prototyp ist der Flow selbst: Die Screen-Module laufen mit den echten Komponenten, Verbindungen und Entscheidungen kommen aus der Flow-Datei. Es gibt keinen zweiten Bauweg.

## Ablauf

1. **Vollständigkeit.** `flow_validate`. Für jede Kante mit `el` muss das Element im Code `flow.trigger('<el>')` auslösen (`flow_edit connect` verdrahtet das). Jede Entscheidung braucht Ja- und Nein-Pfad; jeder Screen einen Ausgang oder `exit: true`.
2. **Zustände und Daten.** Realistische Fixtures; Stories für die Zustände, die im Test vorkommen.
3. **Testaufgaben** (mit `--task` oder aus den Annahmen): Für die riskantesten offenen Annahmen (`knowledge_get` → `annahmenNachRisiko`) je eine Aufgabe formulieren – Szenario in Alltagssprache, ohne UI-Begriffe, mit Erfolgskriterium und der Annahme, die sie prüft. Speichern unter `.wireflow/research/tests/<flow>-aufgaben.md`.
4. **Durchspielen.** `canvas_open`, Modus Prototyp. Varianten der Variablen durchgehen (z. B. angemeldet / nicht angemeldet). Gefundene Lücken beheben oder benennen.
5. **Nach dem Test.** Beobachtungen mit `/wireflow:research` erfassen; Annahmen auf `bestätigt` oder `widerlegt` setzen – der Wissensstand der Flow-Schritte ändert sich mit.
