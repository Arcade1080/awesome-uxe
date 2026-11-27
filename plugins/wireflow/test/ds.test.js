import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { flattenTokens } from '../src/core/ds.js';
import { lintScreen } from '../src/core/lint.js';
import { loadProject } from '../src/core/project.js';
import { startCanvas } from '../src/canvas/server.js';
import { tempProject, hasRenderer } from './helpers.js';

test('Tokens: DTCG und Style-Dictionary-Ausgabe (z. B. Primer Primitives)', () => {
  const dtcg = flattenTokens({ color: { text: { $type: 'color', $value: '#111' } } });
  assert.deepEqual(dtcg.map(t => [t.path, t.value]), [['color.text', '#111']]);
  const sd = flattenTokens({ 'fgColor-default': { name: 'fgColor-default', value: '#1f2328', type: 'color', original: { $value: '{base.color.neutral.13}' } }, 'space-lg': { name: 'space-lg', value: '1rem', key: '{space.lg}' } });
  assert.deepEqual(sd.map(t => [t.path, t.value]), [['fgColor-default', '#1f2328'], ['space-lg', '1rem']]);
});

test('Lint: Komponenten mit passthrough nehmen native Attribute an', () => {
  const root = tempProject();
  const m = loadProject(root);
  const btn = m.manifest.components.find(c => c.name === 'Button');
  const src = m.screens['screens/pruefen.screen.tsx'];
  const tree = JSON.parse(JSON.stringify(src.tree));
  const b = (function find(n) { if (n.name === 'Button') return n; for (const c of n.children || []) { const r = find(c); if (r) return r; } return null; })(tree);
  b.attrs.push({ name: 'type', kind: 'str', raw: 'submit' }, { name: 'onClick', kind: 'expr', raw: 'x' });
  const without = lintScreen({ ...src, tree }, m).warnings.filter(w => /Prop „(type|onClick)“/.test(w.msg));
  assert.equal(without.length, 2);
  btn.passthrough = 'button';
  const withPt = lintScreen({ ...src, tree }, m).warnings.filter(w => /Prop „(type|onClick)“/.test(w.msg));
  assert.equal(withPt.length, 0);
});

test('Renderer: Provider des Design Systems umschließt jeden Screen und bekommt den Modus', { skip: !hasRenderer() && 'Renderer nicht installiert' }, async () => {
  const root = tempProject();
  const wf = path.join(root, '.wireflow');
  fs.writeFileSync(path.join(wf, 'ds', 'provider.tsx'), "export default function P({ children, mode }) { return <section data-provider={mode}>{children}</section>; }\n");
  const mf = path.join(wf, 'ds', 'manifest.json');
  fs.writeFileSync(mf, JSON.stringify({ ...JSON.parse(fs.readFileSync(mf, 'utf8')), provider: '.wireflow/ds/provider.tsx' }));
  const c = await startCanvas({ root, port: 0 });
  try {
    const r0 = await fetch(c.url, { redirect: 'manual' });
    const cookie = r0.headers.get('set-cookie').split(';')[0];
    const js = await (await fetch(`http://127.0.0.1:${c.port}/bundle.js`, { headers: { cookie } })).text();
    assert.match(js, /data-provider/);
    assert.match(js, /mode: W\.mode \|\| "hifi"|mode: W\.mode \|\| 'hifi'/);
  } finally {
    await c.close();
  }
});

test('Einfügen: Pflicht-Props mit Platzhaltern, Unterkomponenten nur in ihrer Komponente', async () => {
  const { applyOp } = await import('../src/core/screens.js');
  const root = tempProject();
  const mf = path.join(root, '.wireflow', 'ds', 'manifest.json');
  const man = JSON.parse(fs.readFileSync(mf, 'utf8'));
  man.components.push(
    { name: 'Hinweis', props: { title: { type: 'node', required: true }, tone: { type: 'string', enum: ['info', 'warn'], required: true }, items: { type: 'code', ts: 'Item[]', required: true } } },
    { name: 'Leiste', props: { children: { type: 'node' } } },
    { name: 'Leiste.Knopf', props: { children: { type: 'node', required: true } } },
  );
  fs.writeFileSync(mf, JSON.stringify(man));
  const ref = 'screens/pruefen.screen.tsx';
  const root0 = loadProject(root).screens[ref].tree.id;
  const r = applyOp(loadProject(root), ref, { op: 'insert', component: 'Hinweis', parent: root0 });
  assert.deepEqual(r.filled.sort(), ['items', 'title', 'tone']);
  const src = fs.readFileSync(path.join(root, '.wireflow', ref), 'utf8');
  assert.match(src, /<Hinweis data-wf="[\w-]+" title="Titel" tone="info" items=\{\[\]\} \/>/);
  assert.throws(() => applyOp(loadProject(root), ref, { op: 'insert', component: 'Leiste.Knopf', parent: root0 }), /gehört in eine <Leiste>/);
  const l = applyOp(loadProject(root), ref, { op: 'insert', component: 'Leiste', parent: root0 });
  const k = applyOp(loadProject(root), ref, { op: 'insert', component: 'Leiste.Knopf', parent: l.selected });
  assert.ok(k.selected);
  assert.match(fs.readFileSync(path.join(root, '.wireflow', ref), 'utf8'), /<Leiste\.Knopf data-wf="[\w-]+">Knopf<\/Leiste\.Knopf>/);
});
