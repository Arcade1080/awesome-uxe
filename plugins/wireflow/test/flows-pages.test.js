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
