// Journeys speichern – gemeinsam für MCP-Werkzeug und Canvas.
import path from 'node:path';
import { writeJson } from './project.js';
import { normalizeJourney, validateJourney } from './journey.js';

const slug = s => String(s).toLowerCase().normalize('NFKD').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '') || 'journey';

/** Normalisiert, prüft und schreibt eine Journey; gibt den Pfad relativ zu .wireflow/ zurück. */
export function saveJourney(model, input) {
  const j = normalizeJourney(input);
  validateJourney(j);
  const existing = model.journeys.find(x => x.id === j.id);
  const rel = existing?.file || `journeys/${slug(j.title || j.id)}.journey.json`;
  const { file: _f, ...data } = j;
  writeJson(path.join(model.wf, rel), data);
  return { file: rel, journey: data };
}
