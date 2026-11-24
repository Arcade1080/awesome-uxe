---
name: ds
description: Design System im Wireflow-Projekt untersuchen und pflegen – Manifest mit dem Code abgleichen (sync), Komponenten und Patterns finden (search), Lücken und fehlende Angaben zeigen (audit, gaps), Patterns erfassen. Verwenden bei Fragen wie „Welche Komponente für …?“, „Was fehlt im DS?“ oder nach DS-Updates.
argument-hint: "sync | audit | gaps | search <begriff> | pattern <name>"
---

# Design System untersuchen und pflegen

Das Manifest `.wireflow/ds/manifest.json` beschreibt, was Screens nutzen dürfen. Patterns (`.wireflow/ds/patterns/*.md`) sagen, **wann** welche Komponente passt und welche Zustände ein Flow braucht. Beides ist die Grundlage für alle Screens.

Aufgabe aus `$ARGUMENTS` lesen, dann:

- **search <begriff>** – `ds_search` (Name, Intent, Richtlinie), danach `ds_component` für Details. Antwort: passende Komponente(n), wichtige Props, Richtlinien, passendes Pattern (`ds_patterns`).
- **sync** – Subagent `ds-curator` gleicht das Manifest mit dem Code ab: neue/entfernte Exporte, geänderte Props (TypeScript-Typen, Storybook-ArgTypes), veraltete Komponenten (`status: "deprecated"`, `replacedBy`). Änderungen als Liste zeigen, dann schreiben.
- **audit** – Für jede Komponente prüfen: Beschreibung, Props mit Typen, `defaults`, `intents`, `guidelines`, `a11y`. Für das DS insgesamt: `styles`, Token-Dateien, Wireframe-Modus, Patterns. Ergebnis als Tabelle „vorhanden / fehlt“ mit Priorität.
- **gaps** – DS-Lücken zeigen: Elemente in Screens, die keine DS-Komponente sind (`screen_lint`, Warnungen mit „DS-Lücke“), plus `manifest.gaps`. Je Lücke: Intent, Workaround heute, Vorschlag fürs DS-Team.
- **pattern <name>** – Pattern-Karte anlegen oder ergänzen: Auslöser (Intents), Entscheidungsregeln (wann welche Komponente), verlangte Zustände und Pfade (z. B. Fehlerpfad beim Speichern), Regeln. Quelle angeben (DS-Doku, Team-Entscheidung).

## Regeln

- Props nie erfinden. Quelle ist der Code des DS (Typen, Storybook, Doku).
- Lücken sind Information, kein Fehler: dokumentieren statt mit Eigenbau überdecken.
- Nach Änderungen am Manifest `screen_lint` laufen lassen – betroffene Screens nennen.
