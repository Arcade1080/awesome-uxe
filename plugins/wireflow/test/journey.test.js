import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { normalizeJourney, validateJourney, journeyGaps, needType, solutionTerm } from '../src/core/journey.js';
import { loadProject } from '../src/core/project.js';
import { startCanvas } from '../src/canvas/server.js';
import { tempProject, read } from './helpers.js';

test('Journey: altes Format wird zur Story Map, IDs bleiben stabil', () => {
  const old = { id: 'j', title: 'Alt', phases: [
    { id: 'ph_a', title: 'Finden', emotion: -1, opportunities: ['x'], actions: ['Suchen', 'Vergleichen'], painPoints: [{ text: 'Zu viel', insight: 'ins_1' }] },
    { id: 'ph_b', title: 'Leer', painPoints: ['Nur Text'] },
  ] };
  const a = normalizeJourney(old), b = normalizeJourney(old);
  assert.equal(a.schema, 'wireflow/journey@2');
  assert.deepEqual(a, b);
  assert.deepEqual(a.phases[0].steps.map(s => s.text), ['Suchen', 'Vergleichen']);
  assert.deepEqual(a.phases[0].steps[0].painPoints, [{ id: 'ph_a_p1', text: 'Zu viel', insight: 'ins_1' }]);
  assert.equal(a.phases[0].emotion, -1);
  assert.equal(a.phases[0].actions, undefined);
  assert.equal(a.phases[1].steps[0].text, 'Leer');
  assert.equal(a.phases[1].steps[0].painPoints[0].text, 'Nur Text');
  assert.ok(validateJourney(a));
});

test('Journey: Prüfung, Befunde und Hilfen', () => {
  const j = normalizeJourney({ id: 'j', phases: [{ id: 'p', title: 'P', steps: [{ id: 's', text: 'Slot wählen', painPoints: [{ id: 'pp', text: 'Weg' }], needs: [{ id: 'n', text: 'Wissen, ob frei', requirements: [{ id: 'r', text: 'Freie Zeiten sehen', screens: [] }] }] }] }] });
  const arts = journeyGaps(j, { knowledge: { insights: [] }, flows: [] }).map(g => g.art).sort();
  assert.deepEqual(arts, ['annahme', 'loesung', 'pain', 'screen']);
  j.phases[0].steps[0].needs[0].solves = ['gibt-es-nicht'];
  assert.throws(() => validateJourney(j), /unbekannte Pain Points/);
  j.phases[0].steps[0].needs[0].solves = [];
  j.phases[0].steps[0].needs[0].id = 's';
  assert.throws(() => validateJourney(j), /Doppelte id/);
  assert.equal(needType('Praxen vergleichen, um zu wissen …'), 'ent');
  assert.equal(needType('Wissen, bis wann ich absagen kann'), 'info');
  assert.equal(needType('Ruhe haben'), null);
  assert.equal(solutionTerm('Im Dropdown wählen').word, 'Bauteil');
});

test('Journey: Beispiel ist eine gültige Story Map, Canvas speichert über /api/journey', async () => {
  const root = tempProject();
  const m = loadProject(root);
  const j = m.journeys[0];
  assert.equal(j.schema, 'wireflow/journey@2');
  assert.ok(validateJourney(j));
  const nodes = new Set(m.flows.flatMap(f => f.nodes.map(n => n.id)));
  for (const r of j.phases.flatMap(p => p.steps).flatMap(s => s.needs).flatMap(n => n.requirements)) for (const s of r.screens) assert.ok(nodes.has(s), `Screen ${s} fehlt im Flow`);
  assert.ok(!journeyGaps(j, m).some(g => g.art === 'beleg'), 'alle Belege verweisen auf echte Insights');

  const c = await startCanvas({ root, port: 0 });
  try {
    const r0 = await fetch(c.url, { redirect: 'manual' });
    const cookie = r0.headers.get('set-cookie').split(';')[0];
    const base = `http://127.0.0.1:${c.port}`;
    const { file: _f, ...data } = j;
    data.phases[0].steps.push({ id: 'st_neu', text: 'Neu', painPoints: [], needs: [] });
    const ok = await fetch(`${base}/api/journey`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ journey: data }) });
    assert.equal(ok.status, 200);
    const saved = JSON.parse(read(root, j.file));
    assert.equal(saved.schema, 'wireflow/journey@2');
    assert.equal(saved.phases[0].steps.at(-1).text, 'Neu');
    assert.equal(saved.file, undefined);
    data.phases[0].steps.at(-1).needs.push({ id: 'bd_x', text: 'x', solves: ['nope'], requirements: [] });
    const bad = await fetch(`${base}/api/journey`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ journey: data }) });
    assert.ok(bad.status >= 400);
    assert.equal(JSON.parse(read(root, j.file)).phases[0].steps.at(-1).needs.length, 0, 'ungültige Journey wird nicht geschrieben');
    const cross = await fetch(`${base}/api/journey`, { method: 'POST', headers: { cookie, origin: 'http://evil.example', 'content-type': 'application/json' }, body: JSON.stringify({ journey: data }) });
    assert.equal(cross.status, 403);
  } finally {
    await c.close();
  }
  assert.ok(fs.existsSync(path.join(root, '.wireflow', j.file)));
});
