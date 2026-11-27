# Die zwei Kernargumente

> Kontext für alle, die an Wireflow Studio arbeiten – Menschen wie Claude. Stand: 27.11.2026.
> Zurück zum [Konzept](README.md)

Zwei Argumente tragen das Werkzeug. Jede Funktion sollte mindestens eines davon stärken; eine Funktion, die keines stärkt, braucht eine gute Begründung.

## 1. Jede Designentscheidung ist auf Signale zurückführbar

Alle Designentscheidungen lassen sich auf **Research, Best Practices oder ähnliche Signale** zurückführen. Das ist das Kernargument für dieses Werkzeug.

| Signal | Beispiele | Wo es heute liegt |
|---|---|---|
| Research | Insights mit Belegen, Interviews, Usability-Tests | `.wireflow/knowledge/`, `.wireflow/research/` |
| Best Practices | anerkannte Richtlinien und Standards: WCAG, Plattform-Guidelines, Heuristiken, Erkenntnisse aus Studien | für Claude als Methodenwissen in `skills/ux-methods/references/`; als Signal mit Quelle noch nicht modelliert (siehe [Offen](#offen)) |
| Etabliertes der Organisation | Patterns, Richtlinien, frühere Entscheidungen | `.wireflow/ds/`, `.wireflow/decisions/` |
| Daten | Analytics, Support-Anfragen, Suchanfragen | als Beleg eines Insights in `.wireflow/knowledge/` |

Was daraus folgt:

- **Eine Entscheidung nennt ihre Signale.** Wo keines vorliegt, wird sie ausdrücklich als Annahme festgehalten – sichtbar, und mit dem, was sie prüfen würde.
- **Signale sind unterschiedlich stark.** Ein einzelnes Vorbild aus einer anderen App zeigt eine Möglichkeit, belegt aber nicht, dass sie bei den eigenen Nutzer:innen funktioniert. Vorschläge von Claude sind keine Signale; Claude nennt die Signale, auf die es sich stützt.
- **Die Spur bleibt lesbar.** Von jedem Screen und jeder Variante führt „Warum?“ zur Entscheidung, von dort zu den Signalen und zu dem, was verworfen wurde (`.wireflow/decisions/*.md`).

## 2. Das bestehende Design System – mehr als Komponenten

Das zweite Argument ist das **bestehende Design System**. Das bedeutet nicht nur Komponenten, sondern auch **Patterns und Best Practices: Was sich innerhalb einer Organisation etabliert hat, wird berücksichtigt.**

Dazu gehören:

- Komponenten, Props und Tokens (`.wireflow/ds/manifest.json`),
- Patterns: wann welche Lösung passt und welche Zustände verlangt sind (`.wireflow/ds/patterns/*.md`),
- Richtlinien und Regeln: Barrierefreiheit, Inhalt und Ton, Konventionen (`guidelines`, `a11y` und `rules` der Komponenten im Manifest),
- getroffene Entscheidungen: was die Organisation schon entschieden hat und warum (`.wireflow/decisions/`).

Was daraus folgt:

- **Zuerst das Bestehende.** Claude gestaltet mit dem, was es schon gibt, und folgt den Patterns der Organisation. Abweichungen sind erlaubt, werden aber markiert und begründet – als DS-Lücke oder als bewusste Ausnahme.
- **Etabliertes ist selbst ein Signal** im Sinne von Argument 1: „So machen wir das hier, weil …“ zählt, wenn das Warum dokumentiert ist.
- **Prüfungen messen am ganzen Design System,** nicht nur an der Komponentenliste: Lint und Review prüfen auch Patterns, Richtlinien und frühere Entscheidungen.

## Wie beides zusammenspielt

Argument 1 sagt, *warum* eine Lösung gewählt wurde. Argument 2 sagt, *womit* sie gebaut wird und welche Erfahrung der Organisation sie berücksichtigt. Zusammen unterscheiden sie Wireflow Studio von Prompt-to-UI-Werkzeugen: Die Ergebnisse sind begründet und übernehmbar.

## Offen

- Best Practices als eigene Signalart in der Wissensbasis: Quelle, Geltungsbereich, Stand und wer sie für die Organisation übernommen hat.
- Gewichtung von Signalen in Vergleichen und Reviews, etwa eigenes Research vor allgemeiner Best Practice.
- Wie Organisationen ihre etablierten Lösungen pflegen, ohne ein zweites Dokumentationssystem aufzubauen.
