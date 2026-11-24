---
name: journey
description: User Journey mappen – Phasen, Handlungen, Emotionen, Pain Points und Chancen, verknüpft mit belegtem Wissen. Verwenden, um aus Research, Interviews oder Teamwissen eine Ist- oder Soll-Journey zu erstellen oder zu ändern; Grundlage für /wireflow:flow.
argument-hint: "[quellen] [--persona <name>] [--soll]"
---

# User Journey mappen

Eine Journey beschreibt das Erleben über die Zeit – vor, während und nach der Nutzung des Produkts. Sie ist der Ausgangspunkt für Flows: Pain Points und Chancen zeigen, wo Screens etwas verbessern müssen.

## Ablauf

1. **Kontext klären.** `knowledge_get` und vorhandene Journeys (`journey_get`) lesen. Quellen aus `$ARGUMENTS` (Dateien unter `.wireflow/research/`, Notizen) lesen. Persona und Szenario mit der Person abstimmen, falls unklar.
2. **Phasen entwerfen.** 4–7 Phasen aus Sicht der Nutzer:innen (nicht des Systems). Je Phase:
   - `actions`: was Menschen tun (Verben)
   - `emotion`: −2 bis +2, nur wenn das Material es hergibt; sonst weglassen
   - `painPoints`: `{ text, insight }` – mit Insight-ID, wenn belegt; ohne Beleg als Annahme anlegen (`knowledge_upsert`) und verlinken
   - `opportunities`: Chancen für das Produkt
   - `flow`: Flow-ID, wenn eine Phase im Produkt stattfindet
3. **Speichern.** `journey_upsert` mit `{ id, title, variant: "ist"|"soll", persona, scenario, phases }`.
4. **Zeigen.** Im Canvas (Modus Journey) ist jeder Pain Point mit seinem Wissensstand markiert. Unbelegte Stellen benennen und `/wireflow:research` für Lücken vorschlagen.

## Regeln

- Ist-Journey = was heute passiert (belegt). Soll-Journey = Hypothese, wie es sein sollte – ihre Verbesserungen sind Annahmen, bis sie getestet sind.
- Subagent `journey-analyst` für große Mengen Research-Material nutzen.
- Methodenwissen: Skill `ux-methods` (Referenz `journey-mapping.md`).
