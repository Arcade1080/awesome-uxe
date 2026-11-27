# Kontext für dieses Repository

Das Repository enthält die Awesome-Liste zu UX Engineering (`README.md`), das Konzept „Wireflow Studio“ (`concepts/wireflow-studio/`) und dessen Umsetzung als Claude-Code-Plugin (`plugins/wireflow/`).

## Wireflow Studio: die zwei Kernargumente

Bei jeder Arbeit an Wireflow Studio – Konzept, Plugin, Canvas, Skills – gelten diese beiden Argumente. Ausführlich: [`concepts/wireflow-studio/kernargumente.md`](concepts/wireflow-studio/kernargumente.md).

1. **Nachvollziehbare Entscheidungen.** Jede Designentscheidung lässt sich auf Research, Best Practices oder ähnliche Signale zurückführen. Wo kein Signal vorliegt, wird sie als Annahme sichtbar. Das ist das Kernargument für das Werkzeug.
2. **Das bestehende Design System.** Gemeint sind nicht nur Komponenten, sondern auch Patterns, Best Practices und alles, was sich in der Organisation etabliert hat. Es wird berücksichtigt; Abweichungen werden markiert und begründet.

Eine neue Funktion sollte mindestens eines davon stärken.

## Arbeitsweise

- Doku und Oberfläche des Plugins sind auf Deutsch.
- Tests des Plugins: `cd plugins/wireflow && npm test`.
