# Wissen: Atomic Research und Annahmen

## Kette

**Quelle → Fakt → Insight → Flow-Schritt.** Fakten verweisen auf die Stelle im Material (`p03#41-44` = Interview 3, Zeilen 41–44). Insights verdichten mehrere Fakten zu einer Aussage. Flow-Knoten und -Kanten verweisen über `basis` auf Insights und Annahmen.

## Wissensstände

| Stufe | Wann |
|---|---|
| belegt | Insight mit Fakten aus mehreren Quellen oder eine bestätigte Annahme |
| Hinweis | Insight mit dünner Grundlage (eine Quelle) |
| Annahme | nur Annahmen als Grundlage |
| offen | keine Grundlage verknüpft |
| Widerspruch | widerlegte Annahme oder widersprüchliche Insights |

## Annahmen nach Risiko

Jede Annahme: `aussage`, `kategorie` (wünschenswert · machbar · tragfähig), `wichtigkeit` (hoch · mittel · niedrig), `evidenz` (keine · schwach · stark), `test` (`methode`, `frage`), `status` (offen · bestätigt · widerlegt), optional `herkunft`.
Zuerst testen: **hohe Wichtigkeit, keine Evidenz**. Günstige Tests: kurze Interviews, Prototyp-Tests mit Aufgaben, Datenauswertung, Gespräch mit Fachleuten.

## Inspiration ist kein Beleg

Lösungen aus anderen Produkten oder Domänen (z. B. Platzreservierung beim Ticketing) sind wertvolle Ideen. Sie werden als Annahme mit `herkunft` erfasst – bis Research mit den eigenen Nutzer:innen sie stützt.

## Formate

```json
{ "id": "ins_slot_weg", "aussage": "Slots werden zwischen Auswahl und Absenden vergeben.", "fakten": ["p03#41-44", "p07#18"], "wissensstand": "belegt" }
{ "id": "ann_slot_5min", "aussage": "Fünf Minuten Reservierung reichen.", "kategorie": "wünschenswert", "wichtigkeit": "hoch", "evidenz": "keine", "test": { "methode": "Prototyp-Test", "frage": "Wie lange brauchen Neupatient:innen?" }, "status": "offen" }
{ "id": "q_gast", "frage": "Würden Nutzer:innen ohne Konto buchen?", "methode": "Interview", "status": "offen" }
```
