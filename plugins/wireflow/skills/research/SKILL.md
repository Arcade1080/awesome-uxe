---
name: research
description: Wissen über Nutzer:innen und Domäne erfassen und pflegen – aus Interviews, Notizen, Tickets oder Studien Insights mit Belegen ableiten, Annahmen und offene Fragen festhalten, Inspiration aus ähnlichen Lösungen recherchieren. Verwenden, wenn Research-Material vorliegt, Annahmen geprüft werden sollen oder die Person wissen will, worauf ein Flow beruht.
argument-hint: "<dateien oder thema> | annahmen | inspiration <thema>"
---

# Wissen erfassen: das Warum hinter den Flows

Flows beruhen auf dem, was das Team über Nutzer:innen weiß – und machen sichtbar, was es **nicht** weiß. Die Wissensbasis liegt in `.wireflow/knowledge/` (`insights.json`, `assumptions.json`, `questions.json`). Werkzeuge: `knowledge_get`, `knowledge_upsert`, `knowledge_status`.

## Wissensstand

| Stufe | Bedeutung |
|---|---|
| **belegt** | Insight mit Fakten aus Research (Quelle mit Stelle, z. B. `p03#41-44` = Interview 3, Zeilen 41–44) |
| **Hinweis** | einzelne Beobachtung, noch nicht verdichtet |
| **Annahme** | plausibel, aber ungeprüft – mit Test, wie sie geprüft wird |
| **offen** | nichts bekannt – eine Frage |
| **Widerspruch** | Belege oder Tests widersprechen sich oder einer Annahme |

## Aufgaben (aus `$ARGUMENTS`)

- **Material auswerten** (Dateien oder eingefügter Text): Fakten extrahieren (wörtlich oder nah am Original, mit Quelle), zu Insights verdichten (`aussage`, `fakten[]`, `wissensstand`). Subagent `journey-analyst` hilft bei großen Mengen. Rohmaterial nach `.wireflow/research/` legen, falls es noch nicht im Repo ist – personenbezogene Daten vorher pseudonymisieren und die Person fragen.
- **annahmen**: Annahmen auflisten und nach Risiko ordnen (Wichtigkeit hoch und Evidenz keine zuerst). Kategorien: wünschenswert, machbar, tragfähig. Für jede einen günstigen Test vorschlagen (Interview, Prototyp-Test, Datenanalyse, Gespräch mit Fachleuten).
- **inspiration <thema>**: Subagent `research-scout` recherchiert ähnliche Lösungen in anderen Produkten und Domänen. Ergebnisse sind **Inspiration**, nie Belege: als Annahme mit `herkunft` (Quelle, URL) anlegen oder als Hinweis kennzeichnen.

## Regeln

- **Nie Nutzerwissen erfinden.** Ohne Quelle ist es eine Annahme oder eine offene Frage.
- Menschen entscheiden, was als belegt gilt. Claude schlägt vor, die Person bestätigt.
- Flows verweisen auf Wissen über `basis: { insights: [...], assumptions: [...] }` an Knoten und Kanten. Nach Änderungen `knowledge_status` für betroffene Flows zeigen.
