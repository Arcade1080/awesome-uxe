# Wireflow Studio – Plugin für Claude Code

Journeys, Wireflows und Prototypen aus **echtem Code des eigenen Design Systems** – mit einem Canvas im Browser, einer Wissensbasis zu Nutzer:innen und Claude als Co-Designer. Das Konzept dazu steht in [`concepts/wireflow-studio`](../../concepts/wireflow-studio/README.md); dieses Plugin setzt **Stufe 1 (Einzelmodus)** um.

```text
Design System verknüpfen → Wissen erfassen → Journey → Flow → Screens aus DS-Komponenten → Prototyp
```

## Installation

In Claude Code (ab 2.1):

```text
/plugin marketplace add arcade1080/awesome-uxe
/plugin install wireflow@awesome-uxe
```

Voraussetzungen im Projekt: Node.js ≥ 20, React-Design-System als npm-Paket (auch Workspace), `react`, `react-dom` und `esbuild` als (Dev-)Abhängigkeiten. Der Canvas bündelt Screens mit dem esbuild **des Projekts** – so rendern genau die Komponenten, die auch das Produkt nutzt.

## Schnellstart

```text
/wireflow:init @firma/ui        Projekt anlegen, Design System verknüpfen
/wireflow:research interviews/   Insights mit Belegen, Annahmen, offene Fragen
/wireflow:journey                Journey mit Pain Points und Wissensstand
/wireflow:flow                   Wireflow mit Entscheidungen und Fehlerpfaden
/wireflow:hifi                   Screens als Code aus DS-Komponenten
/wireflow:canvas                 Canvas öffnen: ansehen, anordnen, verbinden
/wireflow:prototype              Durchklicken, Testaufgaben aus Annahmen
/wireflow:review                 Quality Gates: Flow, DS, Patterns, A11y, Wissen
/wireflow:export spec            Mermaid, Spezifikation, Übergabe
```

Natürliche Sprache funktioniert genauso: „Gestalte den Fehlerfall für vergebene Termine nach dem Pattern Speichern“ oder – mit Auswahl im Canvas – „mach das Ausgewählte zur primären Aktion“.

## Beispiel ausprobieren

```bash
cd plugins/wireflow/examples/acme-health
npm install                       # esbuild, react, react-dom; Acme UI als Workspace
node ../../bin/wireflow serve --open
```

Das Beispiel enthält ein kleines, fiktives Design System (Acme UI: 14 Komponenten, Tokens, drei Patterns), Research-Wissen, eine Journey und einen Buchungs-Flow mit sechs Screens. Ein Pfad fehlt absichtlich („Slot noch frei?“ → Nein) – der Canvas zeigt ihn rot, der Prototyp meldet ihn, und im Inspector lässt er sich mit einem neuen Screen schließen.

## Was im Repository entsteht

```text
.wireflow/
├── project.json                 Name, Viewport, erlaubte Imports
├── ds/manifest.json             Komponenten, Props, Defaults, Intents, Richtlinien, Tokens, Regeln
├── ds/patterns/*.md             Pattern-Karten: wann welche Komponente, verlangte Zustände
├── knowledge/                   insights.json, assumptions.json, questions.json
├── research/                    Rohmaterial (pseudonymisiert), Testaufgaben
├── journeys/*.journey.json      Phasen, Emotion, Pain Points mit Belegen, Chancen
├── flows/*.flow.json            Screens, Entscheidungen, Kanten von Elementen zu Zielen
├── screens/*.screen.tsx         Screen-Module: React aus DS-Komponenten
├── screens/*.stories.tsx        Zustände als Storybook-Stories (CSF 3)
└── fixtures/*.ts                typisierte Testdaten
```

Alles ist Text und gehört ins Git: Reviews, Diffs und Branches funktionieren wie bei Code.

### Screen-Module

```tsx
import { Page, AppBar, Alert, Button } from '@acme/ui';
import { flow } from '@wireflow/runtime';

export function SlotVergebenScreen() {
  return (
    <Page data-wf="page" padding="space.4" gap="space.3">
      <AppBar data-wf="ab" title="Termin wählen" onBack={flow.back} />
      <Alert data-wf="al_vergeben" tone="danger" title="Termin gerade vergeben">Ihre Angaben bleiben erhalten.</Alert>
      <Button data-wf="btn_neu" variant="primary" size="lg" onPress={flow.trigger('btn_neu')}>Anderen Termin wählen</Button>
    </Page>
  );
}
```

Regeln: nur Komponenten aus dem Manifest, kein HTML, kein `style`/`className`, Props und Tokens laut Manifest, stabile `data-wf`-IDs. Der Canvas liest solche Module als Baum, ändert sie strukturiert (Einfügen, Verschieben, Props, Text) und schreibt sie deterministisch zurück; Ausdrücke in `{…}` bleiben unverändert erhalten. `@wireflow/runtime` liefert nur `flow.trigger(id)`, `flow.back` und `flow.vars` – im Produkt ersetzt ein Alias es durch den eigenen Router.

## Bausteine

| Baustein | Datei | Aufgabe |
|---|---|---|
| Skills | `skills/*/SKILL.md` | `/wireflow:init`, `ds`, `research`, `journey`, `flow`, `hifi`, `canvas`, `prototype`, `review`, `export`; Methodenwissen in `ux-methods` |
| Subagents | `agents/*.md` | `ds-curator`, `journey-analyst`, `flow-architect`, `ui-composer`, `ux-critic`, `research-scout` |
| MCP-Server | `.mcp.json` → `wireflow mcp` | 23 Werkzeuge: Projekt, DS, Journeys, Flows, Screens, Wissen, Canvas, Export, Rückgängig |
| Hooks | `hooks/hooks.json` | `SessionStart`: Projektstatus als Kontext; `PostToolUse`: prüft jede Datei unter `.wireflow/` – Fehler gehen an Claude zurück |
| CLI | `bin/wireflow` | `init`, `serve`, `status`, `validate`, `lint`, `export`, `doctor` – im Plugin auf dem `PATH`, ohne Plugin für CI |
| Canvas | `src/canvas/` | lokaler Server (nur `127.0.0.1`, Token im Link) und Web-App ohne Build |

Keine Laufzeit-Abhängigkeiten: Das Plugin nutzt nur Node.js; React und esbuild kommen aus dem Projekt.

## Canvas

- **Design:** Screens als echte Komponenten auf einer unendlichen Fläche. Element anklicken → Inspector mit Props laut Manifest (Enums, Tokens, Text), Interaktion (Ziel im Flow), Richtlinien und Prüfung. Komponenten aus der Liste auf Screens ziehen oder mit „+“ einfügen; Elemente per Drag & Drop umordnen; Entf, ⌘/Strg+D, Alt+↑/↓, ⌘/Strg+Z. Screens am Titel verschieben. Kanten starten am auslösenden Element. Wireframe/Hi-Fi tauscht nur Tokens.
- **Prototyp:** derselbe Code, klickbar. Variablen steuern Entscheidungen; fehlende Pfade und unverbundene Elemente werden gemeldet; Klick ins Leere zeigt Hotspots.
- **Journey:** Phasen mit Emotionskurve, Pain Points mit Wissensstand und Beleg.
- **Wissen:** Wissensstand je Flow-Schritt, Insights mit Belegen, Annahmen nach Risiko, offene Fragen – jeweils mit „Genutzt in“.
- **Live:** Ändert Claude oder ein Editor eine Datei, aktualisiert sich der Canvas sofort und markiert die betroffenen Screens. Die Auswahl im Canvas liest Claude mit `canvas_selection`.

## Entwicklung

```bash
cd plugins/wireflow
npm test                          # node:test – Code-Brücke, Flows, MCP, Canvas-Server
claude plugin validate .          # Plugin-Manifest prüfen
```

## Grenzen von Stufe 1

- Einzelmodus: ein Canvas pro Rechner; Zusammenarbeit läuft über Git. Team-Server, gemeinsame Räume und Kommentare sind [Phase 2 des Konzepts](../../concepts/wireflow-studio/README.md).
- Renderer: React mit esbuild. Andere Frameworks (Vue, Web Components) folgen über Renderer-Adapter.
- Die Code-Brücke versteht eine TSX-Teilmenge (eine exportierte Screen-Funktion mit `return (<…>)`). Alles andere bleibt als Code-Block erhalten.
- Figma-Export, visuelle Diffs und Screenshots im Review sind noch nicht enthalten.
