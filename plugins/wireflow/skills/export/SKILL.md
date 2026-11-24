---
name: export
description: Exporte aus dem Wireflow-Projekt – Mermaid-Diagramm, Markdown-Spezifikation mit Interaktionen und Akzeptanzkriterien, Übergabe der Screen-Module an die Entwicklung. Verwenden für Handoff, Dokumentation oder Tickets.
argument-hint: "mermaid | spec | handoff [flow-id]"
---

# Exportieren

- **mermaid** – `export` mit `format: "mermaid"`: Flowchart des Flows für Doku, Pull Requests oder Wikis.
- **spec** – `export` mit `format: "spec"`: Markdown mit Diagramm, Screens, Zuständen (Stories), Interaktionen und Akzeptanzkriterien (Gegeben / wenn / dann) sowie offenen Befunden. Unter `docs/` oder `.wireflow/exports/` speichern, wenn die Person das möchte.
- **handoff** – Die Screen-Module **sind** der Code: Sie nutzen nur das DS und `@wireflow/runtime`. Für die Übernahme ins Produkt:
  1. `flow.trigger('<id>')` durch den Router/Handler der App ersetzen (gleiche Signatur: Funktion, die einen Handler liefert) oder `@wireflow/runtime` per Alias auf ein Modul der App zeigen lassen.
  2. Fixtures durch echte Datenquellen ersetzen; die Prop-Typen der Screens sind der Vertrag.
  3. Stories bleiben als Storybook-Stories nutzbar (CSF 3).
  4. Offene Annahmen und DS-Lücken in die Übergabe aufnehmen.

Ohne Angabe eines Flows den ersten Flow nehmen; bei mehreren nachfragen.
