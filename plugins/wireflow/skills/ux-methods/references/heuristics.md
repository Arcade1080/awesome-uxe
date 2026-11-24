# Review: Heuristiken, Barrierefreiheit, Patterns

## Heuristiken (nach Nielsen), übersetzt auf Wireflows

1. **Status sichtbar:** Lädt, sendet, reserviert? Zustände als Stories vorhanden?
2. **Sprache der Nutzer:innen:** Titel, Labels, Buttons ohne Systembegriffe.
3. **Kontrolle und Freiheit:** Zurück, Abbrechen, Rückgängig – auf jedem Screen klar?
4. **Konsistenz:** gleiche Aktion, gleiche Komponente und gleiche Bezeichnung; DS-Richtlinien eingehalten.
5. **Fehler vermeiden:** Bestätigung vor folgenreichen Aktionen; sinnvolle Vorbelegung.
6. **Erkennen statt Erinnern:** Auswahl sichtbar, Zusammenfassung vor dem Absenden.
7. **Flexibilität:** Abkürzungen für Wiederkehrende (z. B. gespeicherte Daten) ohne Hürden für Neue.
8. **Reduziert:** eine primäre Aktion pro Screen; nur, was für die Entscheidung nötig ist.
9. **Fehler erkennen und beheben:** Fehlermeldungen erklären Ursache und Ausweg; Eingaben bleiben erhalten.
10. **Hilfe:** wo nötig, am Ort des Bedarfs.

## WCAG 2.2 – Prüfpunkte im Screen-Code

- Jedes Eingabefeld hat ein sichtbares Label (`label`-Prop); Fehler beziehen sich auf das Feld.
- Fokusreihenfolge = Reihenfolge im Code; logisch von oben nach unten.
- Zielgrößen mindestens 24 × 24 CSS-Pixel (2.5.8); primäre Aktionen groß (`size="lg"`).
- Kontrast kommt aus den Tokens des DS – nicht überschreiben (ohnehin verboten).
- Status- und Fehlermeldungen als Live-Region (DS-Komponente mit passender Rolle, z. B. Alert).
- Keine Information nur über Farbe (Icons oder Text ergänzen).
- A11y-Hinweise im Manifest der Komponente beachten.

## Pattern-Checks

Für jedes Pattern des DS: Auslöser (Intents) im Flow finden, dann prüfen, ob die verlangten Zustände und Pfade existieren – zum Beispiel beim Absenden: Senden, Erfolg, Fehler mit Weg zurück; bei Listen: Leerzustand.
