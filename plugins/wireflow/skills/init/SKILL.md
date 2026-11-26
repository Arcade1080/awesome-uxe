---
name: init
description: Richtet Wireflow Studio im aktuellen Repository ein – legt .wireflow/ an und verknüpft das Design System (Komponenten, Props, Tokens, Patterns), damit Screens aus echtem Code entstehen. Verwenden, wenn ein Repository noch kein .wireflow/ hat oder die Person ihr Design System verbinden will.
argument-hint: "[npm-Paket des Design Systems]"
---

# Wireflow Studio einrichten

Ziel: Am Ende rendert der Canvas Screens aus den **echten Komponenten** des Design Systems (DS), und Claude kennt deren Props, Richtlinien und Patterns.

## Ablauf

1. **Stand prüfen.** `project_status` aufrufen. Gibt es schon ein Projekt, nur fehlende Teile ergänzen.
2. **Design System finden.** Paket aus `$ARGUMENTS` nehmen. Sonst suchen:
   - `package.json` (auch Workspaces/Monorepo): DS-Pakete wie `@primer/react`, `@mui/material`, `@chakra-ui/react` oder ein eigenes `@firma/ui`
   - Storybook (`.storybook/`, `*.stories.tsx`), Token-Dateien (`*.tokens.json`, `tokens/`), DS-Dokumentation
   - Gibt es mehrere Kandidaten, die Person fragen. Nichts raten.
3. **Anlegen.** `project_init` mit `dsPackage` aufrufen. Das legt `.wireflow/` an: `project.json`, einen Manifest-Entwurf aus den Exporten des Pakets, gefundene Token-Dateien und eine leere Wissensbasis. Bestehende Dateien bleiben unverändert.
4. **Manifest vervollständigen.** Den Subagent `ds-curator` beauftragen, `.wireflow/ds/manifest.json` aus den Quellen zu füllen:
   - je Komponente: `category`, `status`, `description`, `props` (Typ, `enum`, `required`, `default` = Standardwert wie im Code, `type: "token"` mit `group`, `type: "node"` für Slots, `type: "handler"` für Ereignisse), `defaults` (Props und Text für neue Instanzen auf dem Canvas), `intents`, `guidelines`, `a11y`, `rules`
   - `styles`: CSS-Einstieg des DS (z. B. die Theme- und Größen-CSS aus `@primer/primitives` oder `"@firma/ui/styles.css"`)
   - `provider`: braucht das DS einen Provider (Theme, Grundstile), eine kleine Datei `.wireflow/ds/provider.tsx` anlegen, deren Standard-Export `{ children, mode }` bekommt (`mode`: `hifi`, `wireframe`, `dark`), und hier eintragen
   - `passthrough`: Element, an das eine Komponente native Attribute durchreicht (z. B. `"button"`, `"input"`); dann gelten `onClick`, `type`, `value`, `placeholder` usw. nicht als fremde Props
   - Liefert das DS eigene Metadaten mit (z. B. `@primer/react/generated/components.json`), daraus ableiten statt abschreiben
   - `tokens.files` (DTCG oder Style-Dictionary-JSON mit `name`/`value`) und `tokens.modes`: `wireframe` (Graustufen) und, falls das DS ihn hat, `dark` (Dunkelmodus der Screens)
   - Patterns als Karten unter `.wireflow/ds/patterns/*.md` (Frontmatter: `id`, `name`, `status`, `ausloeser`, `regeln`; Text: wann welche Komponente, welche Zustände der Flow braucht)
5. **Renderer prüfen.** Im Terminal `wireflow doctor` ausführen. `esbuild`, `react` und `react-dom` müssen aus dem Projekt auflösbar sein. Fehlt esbuild, der Person `npm i -D esbuild` vorschlagen (nicht ungefragt installieren).
6. **Bericht.** Kurz zusammenfassen: gefundene Komponenten, Patterns, Tokens, erkannte Lücken. Nächste Schritte nennen: `/wireflow:research` (Wissen erfassen), `/wireflow:journey`, `/wireflow:flow`, `/wireflow:canvas`.

## Regeln

- Nichts erfinden: Was nicht aus Code, Typen, Storybook oder Doku des DS hervorgeht, bleibt leer oder wird als offen markiert.
- Screens dürfen später nur Komponenten aus dem Manifest nutzen – deshalb lieber vollständig als schnell.
- `.wireflow/` gehört ins Repository (wird committet); `.wireflow/.canvas-state.json` ist ignoriert.
