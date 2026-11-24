---
name: review
description: Quality Gates für Flows und Screens – Flow-Integrität, DS-Konformität, Patterns, Barrierefreiheit, Heuristiken und Wissensstand. Verwenden vor Übergaben, Tests oder Reviews, oder wenn die Person fragt, ob ein Flow „fertig“ ist.
argument-hint: "[flow,ds,patterns,a11y,heuristics,wissen]"
---

# Review: Quality Gates

Prüfbereiche aus `$ARGUMENTS` (ohne Angabe: alle). Ergebnisse als Befundliste mit Schwere (**blockiert** / **sollte** / **könnte**), Ort (Flow-Knoten, Screen, `data-wf`) und konkretem Vorschlag. Dateien nur ändern, wenn die Person das möchte.

| Bereich | Prüfung | Werkzeug |
|---|---|---|
| **flow** | Ja/Nein-Pfade, Erreichbarkeit, Sackgassen, Hotspots im Code | `flow_validate` |
| **ds** | nur DS-Komponenten, erlaubte Props und Tokens, Regeln (z. B. eine primäre Aktion), DS-Lücken | `screen_lint` |
| **patterns** | Verlangen Patterns Zustände oder Pfade, die fehlen? (Fehlerpfad beim Absenden, Leerzustand, Bestätigung) | `ds_patterns`, `flow_get` |
| **a11y** | WCAG 2.2: Beschriftungen, Fokusreihenfolge (Reihenfolge im Code), Zielgrößen, Fehlermeldungen mit Ausweg, A11y-Hinweise des Manifests | `screen_get`, `ds_component` |
| **heuristics** | Heuristiken nach Nielsen, Konsistenz zum DS, Sprache der Nutzer:innen | Subagent `ux-critic` |
| **wissen** | Schritte ohne Grundlage, riskante Annahmen ohne Test, Widersprüche | `knowledge_status` |

Am Ende: Gesamturteil in einem Satz und die drei wichtigsten nächsten Schritte. Methodenwissen: Skill `ux-methods` (Referenz `heuristics.md`).
