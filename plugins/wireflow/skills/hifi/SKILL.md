---
name: hifi
description: Screens eines Flows als echten Code aus Komponenten des Design Systems gestalten – Layout, Inhalte, Zustände (Stories) und Hotspots, geprüft gegen DS-Regeln und Patterns. Verwenden, um Screens auszuarbeiten, Varianten zu erzeugen oder ausgewählte Elemente im Canvas zu ändern.
argument-hint: "[flow-id | screen] [--variants <n>]"
---

# Screens aus dem Design System gestalten

Jeder Screen ist ein **Screen-Modul** (`.wireflow/screens/<name>.screen.tsx`): eine React-Komponente nur aus Komponenten des DS. Wireframe und Hi-Fi sind derselbe Code – der Wireframe-Modus tauscht nur Tokens. Zustände sind Storybook-Stories (`<name>.stories.tsx`).

## Ablauf

1. **Ziel bestimmen.** Aus `$ARGUMENTS` (Flow oder Screen). Bezieht sich die Person auf „das hier“ oder „das Ausgewählte“: `canvas_selection` lesen.
2. **Kontext laden.** `flow_get` (Interaktionen, Wissen), `screen_get` (aktueller Code), passende Patterns (`ds_patterns`) und Komponenten (`ds_search`, `ds_component`).
3. **Gestalten** (Subagent `ui-composer` für mehrere Screens parallel):
   - nur Komponenten aus dem DS-Paket; Layout über Props und Tokens (`padding="space.4"`), kein `style`, kein `className`, kein HTML
   - jedes Element bekommt eine stabile `data-wf`-ID (z. B. `btn_buchen`); Hotspots aus dem Flow brauchen genau diese IDs
   - Interaktionen: `onPress={flow.trigger('btn_buchen')}`, Zurück: `onBack={flow.back}` – aus `@wireflow/runtime`
   - Daten über Props und typisierte Fixtures (`.wireflow/fixtures/*.ts`), keine Fantasie-Werte im Markup
   - Zustände als Stories: `Standard` plus, was Patterns verlangen (`Leer`, `Fehler`, `Laden`)
4. **Schreiben.** Kleine Änderungen mit `screen_edit` (insert, move, setProp, setText …), ganze Screens mit `screen_write`. Beide prüfen gegen das Manifest; Fehler beheben, bis die DS-Konformität 100 % ist oder Lücken bewusst dokumentiert sind.
5. **Varianten** (`--variants n` oder aus dem Kontextmenü): mit `variant_create` anlegen – sie erscheinen im Canvas neben dem Original. Modus beachten:
   - `strict`: nur DS-Komponenten, Props, Tokens und Patterns; Aufbau nah am Original (DS-Lücken werden abgelehnt)
   - `guided`: DS-Komponenten, Aufbau und Hierarchie frei; Patterns und belegte Insights als Leitplanke
   - `free`: kreativ, auch ungewöhnlich; DS-Lücken erlaubt, aber im Begründungssatz nennen
   Hotspot-IDs aus dem Flow beibehalten, damit die Person die Variante im Canvas **tauschen** kann. Je Variante einen Satz Begründung (`rationale`).
6. **Zeigen.** Im Canvas erscheint jede Änderung sofort. Kurz sagen, was sich geändert hat und warum (Pattern, Insight, Richtlinie).

## Beispiel

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

Methodenwissen: Skill `ux-methods` (Referenz `screen-module.md`).
