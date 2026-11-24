---
id: notification-messaging
name: Notification messaging
status: stable
owner: ds-team
ausloeser:
  - intent: feedback.*
entscheidung:
  - wenn: { reichweite: [seite, abschnitt] }
    nutze: Alert
  - wenn: { reichweite: [feld, aktion] }
    nutze: Text (tone=muted, nahe am Feld)
regeln:
  - Erfolg sparsam melden; oft reicht der Kontext der Interaktion.
  - Fehler erklären und einen Ausweg anbieten.
---

Meldungen passen ihre Komponente der Reichweite an. Fehler beim Buchen sind eine Seitenmeldung
(Alert, tone=danger) mit klarer nächster Aktion.
