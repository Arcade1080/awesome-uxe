# Screen-Module

Ein Screen-Modul ist eine React-Komponente in `.wireflow/screens/<name>.screen.tsx`. Der Canvas rendert sie mit dem Bundler des Projekts und den echten Komponenten des Design Systems. Die Code-Brücke liest sie als Baum, ändert sie strukturiert und schreibt sie deterministisch zurück.

## Regeln

1. **Imports:** nur das DS-Paket (laut Manifest), `@wireflow/runtime`, Typen und Daten aus `../fixtures/…` sowie Pfade aus `project.screens.allowedImports` (z. B. Produkt-Komponenten für dokumentierte DS-Lücken).
2. **Elemente:** nur Komponenten des DS. Kein HTML (`<div>`), kein `style`, kein `className`. Layout über Layout-Komponenten und Token-Props (`gap="space.3"`).
3. **Props:** nur Props aus dem Manifest; `enum`-Werte einhalten; Token-Props mit Token-Namen (`space.4`), nie freie Werte.
4. **IDs:** jedes Element hat `data-wf="<id>"` – stabil, sprechend, eindeutig im Screen (`btn_buchen`, `tf_email`). Hotspots im Flow verweisen darauf.
5. **Interaktion:** `onPress={flow.trigger('<id>')}` für Verbindungen aus dem Flow, `onBack={flow.back}` für Zurück.
6. **Daten:** über Props der Screen-Komponente, typisiert über Fixtures; keine erfundenen Werte im Markup, wenn sie aus Daten kommen.
7. **Struktur:** genau ein `export function <Name>Screen(props)`, das mit `return (<Wurzel …>)` JSX liefert. Ausdrücke in `{…}` sind erlaubt, bleiben aber auf dem Canvas Code-Blöcke (nicht strukturell bearbeitbar).

## Zustände

Stories in `<name>.stories.tsx` (Storybook CSF 3): `Standard` mit Fixture-Daten, dazu Zustände, die Patterns verlangen (`Leer`, `Fehler`, `Laden`). Im Flow wählt `story` den Zustand eines Knotens.

```tsx
import type { Meta, StoryObj } from '@storybook/react';
import { ProfilTermineScreen } from './profil.screen';
import { termin } from '../fixtures/termin';

const meta = { title: 'Termin buchen/profil', component: ProfilTermineScreen } satisfies Meta<typeof ProfilTermineScreen>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Standard: Story = { args: termin.auswahl };
export const KeineTermine: Story = { args: { ...termin.auswahl, zeiten: [] } };
```

## Prüfung

`screen_lint` (und der Hook nach jedem Schreiben) melden: HTML-Elemente, `style`/`className`, unbekannte Props, falsche Enum- oder Token-Werte, fehlende Pflicht-Props, veraltete Komponenten, Regeln wie „höchstens eine primäre Aktion“ und DS-Lücken. Ziel: DS-Konformität 100 % oder bewusst dokumentierte Lücke.
