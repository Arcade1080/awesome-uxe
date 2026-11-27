import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFlow, applyFlowOp } from '../src/core/flows.js';
import { flowIssues } from '../src/core/flow.js';
import { loadProject } from '../src/core/project.js';
import { tempProject } from './helpers.js';

test('Flows wie Seiten: anlegen, umbenennen, Ebenen umordnen', () => {
  const root = tempProject();
  const a = createFlow(loadProject(root), 'Onboarding');
  const b = createFlow(loadProject(root), 'Onboarding');
  assert.notEqual(a.flow, b.flow);
  assert.notEqual(a.file, b.file);
  let m = loadProject(root);
  const fresh = m.flows.find(f => f.id === a.flow);
  assert.equal(fresh.nodes.length, 0);
  assert.deepEqual(flowIssues(fresh, m).filter(i => i.level === 'error'), [], 'leerer Flow ohne Fehler');
  applyFlowOp(m, a.flow, { op: 'setFlow', title: 'Erste Schritte' });
  assert.throws(() => applyFlowOp(loadProject(root), a.flow, { op: 'setFlow', title: ' ' }), /Titel fehlt/);
  m = loadProject(root);
  assert.equal(m.flows.find(f => f.id === a.flow).title, 'Erste Schritte');
  const main = m.flows.find(f => f.id === 'flw_buchung');
  const last = main.nodes.at(-1).id;
  applyFlowOp(m, 'flw_buchung', { op: 'reorderNode', id: last, index: 0 });
  assert.equal(loadProject(root).flows.find(f => f.id === 'flw_buchung').nodes[0].id, last);
});

test('Sektionen: anlegen, mit Inhalt verschieben, Phase verknüpfen, löschen', () => {
  const root = tempProject();
  const m = loadProject(root);
  const r = applyFlowOp(m, 'flw_buchung', { op: 'addSection', title: 'Praxis finden', x: -300, y: -100, w: 1500, h: 900, phase: 'ph_finden' });
  let f = loadProject(root).flows.find(x => x.id === 'flw_buchung');
  assert.deepEqual(f.sections.map(s => [s.id, s.title, s.phase]), [[r.section, 'Praxis finden', 'ph_finden']]);
  const [a, b] = f.nodes;
  applyFlowOp(loadProject(root), 'flw_buchung', { op: 'moveGroup', moves: [{ id: a.id, x: a.x + 100, y: a.y }, { id: b.id, x: b.x + 100, y: b.y }], sections: [{ id: r.section, x: -200, y: -100 }] });
  f = loadProject(root).flows.find(x => x.id === 'flw_buchung');
  assert.equal(f.nodes[0].x, a.x + 100);
  assert.equal(f.sections[0].x, -200);
  applyFlowOp(loadProject(root), 'flw_buchung', { op: 'updateSection', id: r.section, props: { title: 'Finden', w: 50, phase: null } });
  f = loadProject(root).flows.find(x => x.id === 'flw_buchung');
  assert.equal(f.sections[0].title, 'Finden');
  assert.equal(f.sections[0].w, 120, 'Mindestbreite');
  assert.equal(f.sections[0].phase, undefined);
  applyFlowOp(loadProject(root), 'flw_buchung', { op: 'removeNodes', ids: [a.id, b.id] });
  f = loadProject(root).flows.find(x => x.id === 'flw_buchung');
  assert.ok(!f.nodes.some(n => n.id === a.id || n.id === b.id));
  assert.ok(!f.edges.some(e => [a.id, b.id].includes(e.from) || [a.id, b.id].includes(e.to)));
  applyFlowOp(loadProject(root), 'flw_buchung', { op: 'removeSection', id: r.section });
  assert.equal(loadProject(root).flows.find(x => x.id === 'flw_buchung').sections.length, 0);
});

test('Neuer Screen ohne Intents: Seiten-Container und Titel nach Namen', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const root = tempProject();
  const mf = path.join(root, '.wireflow', 'ds', 'manifest.json');
  const man = JSON.parse(fs.readFileSync(mf, 'utf8'));
  man.components = [{ name: 'ActionBar', props: { children: { type: 'node' } } }, { name: 'Stack', props: { children: { type: 'node' } } }, { name: 'Heading', props: { children: { type: 'string' } } }];
  fs.writeFileSync(mf, JSON.stringify(man));
  const r = applyFlowOp(loadProject(root), 'flw_buchung', { op: 'addScreen', title: 'Leer' });
  const src = fs.readFileSync(path.join(root, '.wireflow', r.ref), 'utf8');
  assert.match(src, /<Stack data-wf="[\w-]+">\s*<Heading data-wf="[\w-]+">Leer<\/Heading>/);
});

test('Screens: Gerätegröße Mobile, Tablet, Desktop', () => {
  const root = tempProject();
  const r = applyFlowOp(loadProject(root), 'flw_buchung', { op: 'addScreen', title: 'Übersicht', device: 'desktop' });
  let n = loadProject(root).flows.find(f => f.id === 'flw_buchung').nodes.find(x => x.id === r.node);
  assert.equal(n.device, 'desktop');
  applyFlowOp(loadProject(root), 'flw_buchung', { op: 'setNode', id: r.node, props: { device: 'tablet' } });
  n = loadProject(root).flows.find(f => f.id === 'flw_buchung').nodes.find(x => x.id === r.node);
  assert.equal(n.device, 'tablet');
  applyFlowOp(loadProject(root), 'flw_buchung', { op: 'setNode', id: r.node, props: { device: null } });
  n = loadProject(root).flows.find(f => f.id === 'flw_buchung').nodes.find(x => x.id === r.node);
  assert.equal(n.device, undefined, 'null = Standard des Projekts');
  assert.throws(() => applyFlowOp(loadProject(root), 'flw_buchung', { op: 'setNode', id: r.node, props: { device: 'watch' } }), /unbekannt/);
});
