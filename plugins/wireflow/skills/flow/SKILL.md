---
name: flow
description: Wireflow erstellen oder ändern – Screens, Entscheidungen und Verbindungen von konkreten Elementen (Hotspots) zu Zielen, mit Fehler- und Randpfaden laut DS-Patterns und Verweisen auf das Wissen. Verwenden, um aus einer Journey, einer Beschreibung oder bestehendem Code einen Flow abzuleiten.
argument-hint: "[journey-id | beschreibung | --from-code <pfad>]"
---

# Wireflow erstellen

Ein Wireflow verbindet Screens über die Elemente, die eine Aktion auslösen: Die Kante startet am Button, nicht am Screen. Entscheidungen (Rauten) verzweigen nach Variablen. Jeder Screen ist ein Screen-Modul aus echten DS-Komponenten.

## Ablauf

1. **Grundlage lesen.** `project_status`, die Journey (`journey_get`), `knowledge_get`, relevante Patterns (`ds_patterns`). Quelle aus `$ARGUMENTS`: Journey-ID, Beschreibung oder mit `--from-code` bestehende Routen/Seiten.
2. **Struktur entwerfen** (Subagent `flow-architect` für größere Flows):
   - Happy Path zuerst, dann Entscheidungen (`type: "decision"`, `label` als Frage, `var` als Variable)
   - je Entscheidung **beide** Pfade: `when: "<var>"` (Ja) und `when: "else"` (Nein)
   - Pfade, die Patterns verlangen – z. B. beim Speichern/Absenden einen Fehlerpfad mit Weg zurück, leere Zustände, Laden
   - Einstieg (`entry`), Ausstiege (`exit: true`), Variablen mit Startwerten (`variables`)
   - `basis` an Knoten und Kanten: Insights und Annahmen, auf denen der Schritt beruht
3. **Anlegen.**
   - Neuer Flow: `flow_upsert` mit `{ id, title, journey, entry, variables, nodes, edges }`
   - Schrittweise: `flow_edit` – `addScreen {title, x, y}` legt ein Screen-Modul aus DS-Komponenten an; `connect {from, el, to, label}` verbindet und verdrahtet `flow.trigger('<el>')` im Code; `addDecision`, `setNode`, `setEntry`, `setVariable`
   - Layout: Screens 360 × 740, Abstand ~520 in x; Entscheidungen zwischen den Screens (y ≈ 300); Nebenpfade darunter (y ≈ 1000)
4. **Prüfen.** `flow_validate`: fehlende Ja/Nein-Pfade, unerreichbare Screens, Sackgassen, fehlende Hotspots im Code. Alles beheben oder bewusst offen lassen und benennen.
5. **Weiter.** Screens ausarbeiten mit `/wireflow:hifi`, ansehen mit `/wireflow:canvas`, durchklicken mit `/wireflow:prototype`.

## Format (Auszug)

```json
{ "from": "scr_profil", "el": "btn_weiter", "to": "dec_login", "label": "Weiter" }
{ "from": "dec_login", "to": "scr_pruefen", "label": "Ja", "when": "angemeldet" }
{ "from": "dec_login", "to": "scr_login", "label": "Nein", "when": "else" }
{ "from": "scr_login", "el": "btn_login", "to": "scr_pruefen", "label": "Anmelden", "set": { "angemeldet": true } }
```

Methodenwissen: Skill `ux-methods` (Referenz `wireflow-notation.md`).
