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

Story Map (`wireflow/journey@2`). Bis zu den Bedarfen ohne Lösung; erst Anforderungen nennen Screens (Knoten-IDs im Flow).

```json
{
  "schema": "wireflow/journey@2",
  "id": "jrn_termin", "title": "Arzttermin online buchen", "variant": "ist",
  "persona": "Berufstätig, wenig Zeit", "scenario": "Hautausschlag – Termin noch diese Woche",
  "phases": [
    { "id": "ph_finden", "title": "Praxis finden", "emotion": -1, "flow": "flw_buchung",
      "opportunities": ["Nächster freier Termin in der Liste"],
      "steps": [
        { "id": "st_kasse", "text": "Kassenzulassung klären",
          "painPoints": [{ "id": "pp_frei", "text": "Freie Termine und Kassenzulassung nicht auf einen Blick", "insight": "ins_frei" }],
          "needs": [
            { "id": "bd_kasse", "text": "Vor der Wahl einer Praxis wissen, ob sie meine Versicherung annimmt.",
              "insight": "ins_frei", "solves": ["pp_frei"],
              "requirements": [{ "id": "an_kasse", "text": "In der Übersicht bei jeder Praxis sehen, ob sie gesetzlich Versicherte annimmt.", "screens": ["scr_ergebnisse"] }] }
          ] }
      ] }
  ]
}
```

**Bedarfe** formulieren, was Menschen brauchen – aus ihrer Sicht, mit einem Verb, ohne Bauteile. Die Art ergibt sich aus dem Verb:

| Art | Verben | Beispiel |
|---|---|---|
| Information | wissen, erkennen, verstehen, sehen | Vor der Wahl einer Praxis wissen, ob sie meine Versicherung annimmt. |
| Entscheidung | vergleichen, auswählen, einschätzen | Praxen nach dem nächsten freien Termin vergleichen. |
| Handlung | angeben, ändern, absagen, verschieben | Angeben, wie ich versichert bin. |

Ein „um …“ oder „weil …“ hilft, ist aber kein Muss. Das ältere Format (`actions[]` und `painPoints[]` je Phase) wird beim Laden übernommen.
