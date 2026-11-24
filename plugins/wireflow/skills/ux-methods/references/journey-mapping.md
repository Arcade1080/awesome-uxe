# Journey Mapping

## Aufbau

- **Persona und Szenario:** wer, in welcher Situation, mit welchem Ziel. Ein Szenario pro Journey.
- **Phasen (4–7):** aus Sicht der Nutzer:innen benannt („Praxis finden“, nicht „Suchseite“). Phasen beginnen vor dem Produkt und enden danach.
- **Handlungen:** Verben, beobachtbar.
- **Emotion:** −2 (sehr negativ) bis +2 (sehr positiv), nur mit Grundlage im Material.
- **Pain Points:** konkret und belegt (`insight`) – sonst als Annahme anlegen.
- **Chancen:** Lösungsideen, offen formuliert; sie werden im Flow zu Annahmen, bis sie getestet sind.
- **Flow-Verweis:** Phasen, die im Produkt stattfinden, verweisen auf einen Flow.

## Ist und Soll

- **Ist:** beschreibt heute – Grundlage sind Research und Daten.
- **Soll:** beschreibt das Ziel – jede Verbesserung ist eine Annahme mit Test.

## Häufige Fehler

- Systemschritte statt Erleben („API-Aufruf“).
- Emotionen ohne Beleg.
- Ein Pain Point pro Phase „weil es schön aussieht“ – nur echte, belegte Probleme.
- Lösungen als Pain Points verkleidet („Es fehlt ein Filter“) – stattdessen das Problem dahinter.

## Format

```json
{
  "schema": "wireflow/journey@1",
  "id": "jrn_termin", "title": "Arzttermin online buchen", "variant": "ist",
  "persona": "Berufstätig, wenig Zeit", "scenario": "Hautausschlag – Termin noch diese Woche",
  "phases": [
    { "id": "ph_finden", "title": "Praxis finden", "actions": ["Praxen suchen"], "emotion": -1,
      "painPoints": [{ "text": "Freie Termine nicht auf einen Blick", "insight": "ins_frei" }],
      "opportunities": ["Nächster freier Termin in der Liste"], "flow": "flw_buchung" }
  ]
}
```
