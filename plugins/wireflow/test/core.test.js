import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadProject, flowById, undoLast } from '../src/core/project.js';
import { lintScreen } from '../src/core/lint.js';
import { flowIssues, toMermaid } from '../src/core/flow.js';
import { flowKnowledge, openAssumptions } from '../src/core/knowledge.js';
import { tokensCss, searchDs } from '../src/core/ds.js';
import { applyOp, writeScreen } from '../src/core/screens.js';
import { applyFlowOp } from '../src/core/flows.js';
import { initProject, scanExports } from '../src/core/init.js';
import { EXAMPLE, tempProject, read, ids } from './helpers.js';

test('Beispielprojekt: DS-Konformität, Flow-Befunde, Wissensstand', () => {
  const m = loadProject(EXAMPLE);
  const pct = Object.fromEntries(Object.values(m.screens).map(s => [s.ref, lintScreen(s, m).score.pct]));
  assert.equal(pct['screens/bestaetigung.screen.tsx'], 83, 'SuccessMark ist eine dokumentierte DS-Lücke');
  for (const [ref, p] of Object.entries(pct)) if (!ref.includes('bestaetigung')) assert.equal(p, 100, ref);
  for (const s of Object.values(m.screens)) assert.equal(lintScreen(s, m).errors.length, 0, s.ref);

  const f = flowById(m, 'flw_buchung');
  const issues = flowIssues(f, m);
  assert.deepEqual(issues.map(i => i.code), ['decision-no'], 'nur der absichtlich fehlende Nein-Pfad');
  assert.equal(issues[0].ref, 'dec_slot');

  const k = flowKnowledge(f, m.knowledge).counts;
  assert.deepEqual(k, { widerspruch: 0, offen: 2, annahme: 1, hinweis: 1, belegt: 4 });
  assert.equal(openAssumptions(m.knowledge)[0].id, 'ann_slot_5min', 'wichtig und ohne Evidenz zuerst');

  assert.match(toMermaid(f, m), /dec_slot\{"Slot noch frei\?"\}/);
  assert.match(tokensCss(m), /--color-action-primary:#0b6e79/);
  assert.match(tokensCss(m), /\[data-wf-mode="wireframe"\]\{--color-action-primary:#52525b/);
  assert.ok(searchDs(m, 'feedback error').some(r => r.name === 'Alert'));
});

test('Lint erkennt HTML, style, falsche Enums, freie Werte und Regeln', () => {
  const m = loadProject(EXAMPLE);
  const src = `import { Page, Button } from '@acme/ui';
export function X() {
  return (
    <Page data-wf="p" padding="16px">
      <div data-wf="d">x</div>
      <Button data-wf="a" variant="primary" style={{ color: 'red' }}>A</Button>
      <Button data-wf="b" variant="primary" size="xl">B</Button>
    </Page>
  );
}`;
  const r = writeScreen(m, 'screens/x-lint.screen.tsx', src);
  assert.equal(r.ok, false);
  const msgs = r.lint.errors.map(e => e.msg).join('\n');
  assert.match(msgs, /HTML-Element <div>/);
  assert.match(msgs, /„style“/);
  assert.match(msgs, /size="xl" ist nicht erlaubt/);
  assert.match(msgs, /padding="16px" ist ein freier Wert/);
  assert.ok(r.lint.warnings.some(w => /2 primäre Aktionen/.test(w.msg)));
  assert.equal(fs.existsSync(path.join(EXAMPLE, '.wireflow/screens/x-lint.screen.tsx')), false, 'bei Fehlern nicht geschrieben');
});

test('Screen-Operationen schreiben stabilen Code und lassen sich rückgängig machen', () => {
  const root = tempProject();
  const ref = 'screens/profil.screen.tsx';
  const before = read(root, ref);
  let m = loadProject(root);

  const ins = applyOp(m, ref, { op: 'insert', component: 'Alert', index: 3, props: { tone: 'danger', title: 'Termin vergeben' }, text: 'Bitte andere Uhrzeit wählen.' });
  assert.equal(ins.selected, 'alert_1');
  let src = read(root, ref);
  assert.match(src, /import \{ Page, AppBar, Card, Avatar, ChipGroup, Text, Spacer, Button, Alert \} from '@acme\/ui';/);
  assert.deepEqual(ids(src), ['page', 'ab', 'card_arzt', 'ch_tag', 'alert_1', 'ch_uhr', 'tx_res', 'spacer', 'btn_weiter']);
  assert.match(src, /title=\{`\$\{arzt\.fach\} · \$\{arzt\.adresse\}`\}/, 'Ausdrücke bleiben unverändert');

  m = loadProject(root);
  applyOp(m, ref, { op: 'move', id: 'alert_1', delta: -2 });
  applyOp(loadProject(root), ref, { op: 'setProp', id: 'tx_res', name: 'tone', value: 'default' });
  applyOp(loadProject(root), ref, { op: 'setText', id: 'btn_weiter', text: 'Weiter zur Anmeldung' });
  const dup = applyOp(loadProject(root), ref, { op: 'duplicate', id: 'ch_uhr' });
  assert.equal(dup.selected, 'chipgroup_1');
  src = read(root, ref);
  assert.deepEqual(ids(src), ['page', 'ab', 'alert_1', 'card_arzt', 'ch_tag', 'ch_uhr', 'chipgroup_1', 'tx_res', 'spacer', 'btn_weiter']);
  assert.match(src, /data-wf="tx_res" tone="default"/);
  assert.match(src, />Weiter zur Anmeldung<\/Button>/);
  assert.equal(lintScreen(loadProject(root).screens[ref], loadProject(root)).errors.length, 0);

  applyOp(loadProject(root), ref, { op: 'remove', id: 'alert_1' });
  assert.doesNotMatch(read(root, ref), /Alert/, 'Import wird mit entfernt');
  assert.throws(() => applyOp(loadProject(root), ref, { op: 'insert', component: 'Marquee' }), /keine Komponente des Design Systems/);

  for (let i = 0; i < 6; i++) undoLast();
  assert.equal(read(root, ref), before, 'sechs Schritte rückgängig = Ausgangszustand');
});

test('Flow-Operationen: Screen anlegen, verbinden, Hotspot im Code verdrahten', () => {
  const root = tempProject();
  let m = loadProject(root);
  const add = applyFlowOp(m, 'flw_buchung', { op: 'addScreen', title: 'Termin vergeben', x: 2400, y: 1000 });
  assert.equal(add.node, 'scr_termin_vergeben');
  assert.equal(add.ref, 'screens/termin-vergeben.screen.tsx');
  const created = read(root, add.ref);
  assert.match(created, /export function TerminVergebenScreen\(\)/);
  assert.match(created, /<Heading data-wf="heading_1" level=\{2\}>Termin vergeben<\/Heading>/);
  assert.match(read(root, 'screens/termin-vergeben.stories.tsx'), /export const Standard: Story = \{\};/);

  m = loadProject(root);
  applyFlowOp(m, 'flw_buchung', { op: 'connect', from: 'dec_slot', to: add.node, label: 'Nein', when: 'else' });
  m = loadProject(root);
  assert.deepEqual(flowIssues(flowById(m, 'flw_buchung'), m).filter(i => i.level !== 'info'), []);

  // Hotspot: Button ohne Handler wird mit flow.trigger verdrahtet, Runtime-Import ergänzt.
  applyOp(m, add.ref, { op: 'insert', component: 'Button', props: { variant: 'primary' }, text: 'Anderen Termin wählen' });
  m = loadProject(root);
  const wired = applyFlowOp(m, 'flw_buchung', { op: 'connect', from: add.node, el: 'button_1', to: 'scr_profil', label: 'Neu wählen' });
  assert.equal(wired.wired, true);
  const src = read(root, add.ref);
  assert.match(src, /onPress=\{flow\.trigger\('button_1'\)\}/);
  assert.match(src, /import \{ flow \} from '@wireflow\/runtime';/);

  m = loadProject(root);
  applyFlowOp(m, 'flw_buchung', { op: 'moveNode', id: 'scr_suche', x: 13, y: 27 });
  const f = JSON.parse(read(root, 'flows/buchung.flow.json'));
  assert.deepEqual([f.nodes[0].x, f.nodes[0].y], [13, 27]);
  assert.equal(f.file, undefined, 'interne Felder werden nicht gespeichert');
});

test('init legt .wireflow an und entwirft das Manifest aus den Exporten', () => {
  const root = tempProject();
  fs.rmSync(path.join(root, '.wireflow'), { recursive: true });
  const r = initProject(root, { dsPackage: '@acme/ui' });
  assert.ok(r.created.includes('.wireflow/project.json'));
  assert.ok(r.created.includes('.wireflow/.gitignore'));
  const manifest = JSON.parse(read(root, 'ds/manifest.json'));
  const names = manifest.components.map(c => c.name);
  for (const n of ['Page', 'Button', 'Alert', 'ChipGroup']) assert.ok(names.includes(n), n);
  assert.deepEqual(manifest.tokens.files, ['packages/acme-ui/tokens/acme.tokens.json']);
  assert.deepEqual(scanExports(path.join(root, 'packages/acme-ui')).entry, 'src/index.ts');
  const again = initProject(root, { dsPackage: '@acme/ui' });
  assert.deepEqual(again.created, [], 'bestehende Dateien bleiben unverändert');
});
