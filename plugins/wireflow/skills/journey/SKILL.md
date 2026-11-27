---
name: journey
description: User Journey als Story Map mappen – Phasen, Schritte, Pain Points, Bedarfe und Anforderungen bis zu den Screens, verknüpft mit belegtem Wissen. Verwenden, um aus Research, Interviews oder Teamwissen eine Ist- oder Soll-Journey zu erstellen oder zu ändern; Grundlage für /wireflow:flow.
argument-hint: "[quellen] [--persona <name>] [--soll]"
---

# User Journey mappen

Eine Journey beschreibt das Erleben über die Zeit – vor, während und nach der Nutzung des Produkts. Sie ist der Ausgangspunkt für Flows: Pain Points und Chancen zeigen, wo Screens etwas verbessern müssen.

## Ablauf

1. **Kontext klären.** `knowledge_get` und vorhandene Journeys (`journey_get`) lesen. Quellen aus `$ARGUMENTS` (Dateien unter `.wireflow/research/`, Notizen) lesen. Persona und Szenario mit der Person abstimmen, falls unklar.
2. **Story Map entwerfen** (`wireflow/journey@2`). 4–7 Phasen aus Sicht der Nutzer:innen (nicht des Systems). Je Phase optional `emotion` (−2 bis +2, nur mit Material), `opportunities`, `flow`. Darunter `steps[]`, je Schritt:
   - `text`: was Menschen erreichen wollen, mit Verb, ohne Lösung („Passende Zeit finden“, nicht „Kalender öffnen“; kein Slot, Login, Button)
   - `painPoints[]`: `{ id, text, insight? }` – mit Insight-ID, wenn belegt; sonst ohne Beleg lassen und als Annahme anlegen (`knowledge_upsert`)
   - `needs[]` (Bedarfe): `{ id, text, insight?, solves[], requirements[] }` – was Menschen brauchen, aus ihrer Sicht und mit Verb („Wissen, ob die Praxis meine Versicherung annimmt.“). Keine strenge Schablone; die Art (Information, Entscheidung, Handlung) ergibt sich aus dem Verb. `solves` nennt die Pain-Point-IDs, die der Bedarf adressiert.
   - `requirements[]` (Anforderungen): `{ id, text, screens[], partial? }` – erst hier kommt das Produkt vor. `screens` sind Knoten-IDs aus dem Flow; `partial`, wenn ein Screen es nur halb löst.
3. **Speichern.** `journey_upsert` mit `{ id, title, variant: "ist"|"soll", persona, scenario, phases }`. Die Antwort enthält die offenen Punkte (`offen`): Pain Points ohne Bedarf, Bedarfe ohne Beleg oder Anforderung, Anforderungen ohne Screen, Lösungsbegriffe. Die wichtigsten davon nennen.
4. **Zeigen.** Im Canvas (Modus Journey) ist die Story Map bearbeitbar; Änderungen dort landen in derselben Datei. Unbelegte Stellen benennen und `/wireflow:research` für Lücken vorschlagen.

## Regeln

- Ist-Journey = was heute passiert (belegt). Soll-Journey = Hypothese, wie es sein sollte – ihre Verbesserungen sind Annahmen, bis sie getestet sind.
- Subagent `journey-analyst` für große Mengen Research-Material nutzen.
- Methodenwissen: Skill `ux-methods` (Referenz `journey-mapping.md`).
