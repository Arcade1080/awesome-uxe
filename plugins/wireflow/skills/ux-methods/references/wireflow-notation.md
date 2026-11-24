# Wireflow-Notation

## Knoten

| Typ | Felder | Bedeutung |
|---|---|---|
| `screen` | `id`, `title`, `ref` (Screen-Modul), `story` (Zustand), `x`, `y`, `exit`, `basis` | ein Screen in einem Zustand |
| `decision` | `id`, `label` (Frage), `var` (Variable), `x`, `y`, `basis` | Verzweigung nach Systemzustand oder Eingabe |

IDs: `scr_<name>`, `dec_<name>`. Titel in der Sprache der Nutzer:innen.

## Kanten

| Feld | Bedeutung |
|---|---|
| `from`, `to` | Knoten-IDs |
| `el` | `data-wf`-ID des auslösenden Elements im Screen (Hotspot) – Pflicht bei Screens |
| `label` | Aktion in Worten („Buchen“) |
| `when` | an Entscheidungen: Variable (`angemeldet`), Negation (`!angemeldet`) oder `else` |
| `set` | setzt Variablen beim Folgen (`{ "angemeldet": true }`) |
| `basis` | Wissen, auf dem die Verbindung beruht |

## Regeln

- **Jede Entscheidung hat Ja und Nein.** Ein fehlender Pfad ist der häufigste Fehler in Flows; der Canvas zeigt ihn rot.
- **Fehlerpfade:** Was Daten sendet, braucht einen Fehlerpfad mit Weg zurück (Pattern „Speichern und Absenden“); Eingaben bleiben erhalten.
- **Zustände statt Kopien:** Ein Screen in anderem Zustand ist eine Story (`story`), kein neuer Screen – außer der Zustand hat eigene Interaktionen.
- **Ausstiege markieren:** Endpunkte bekommen `exit: true`, sonst gelten sie als Sackgasse.
- **Rücksprünge** über `flow.back` im Code brauchen keine Kante.

## Layout

Screens 360 × 740; Hauptpfad von links nach rechts mit ~520 Abstand in x; Entscheidungen zwischen den Screens bei y ≈ 300; Nebenpfade darunter (y ≈ 1000). Kanten starten am Element und enden links am Ziel; `route` (`fs`, `ts`, `tx`, `k`) nur, wenn es ohne unübersichtlich wird.
