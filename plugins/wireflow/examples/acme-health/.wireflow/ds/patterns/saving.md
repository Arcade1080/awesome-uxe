---
id: saving
name: Speichern und Absenden
status: stable
owner: ds-team
ausloeser:
  - intent: action.save
  - intent: action.submit
flow:
  zustaende: [ungespeichert, sendet, gespeichert, fehler]
  pfade:
    - { von: fehler, nach: ungespeichert, trigger: erneut-versuchen }
regeln:
  - Eingaben gehen bei Fehlern nie verloren.
---

Jede Aktion, die Daten sendet, braucht im Flow einen Fehlerpfad – inklusive Weg zurück.
