import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseModule, printModule, findById, insertEl, makeEl, ensureIds, setProp, setText, moveEl, removeEl, getAttr, scanExpr } from '../src/core/jsx.js';

const SRC = `import { Page, AppBar, Card, Avatar, Button } from '@acme/ui';
import { flow } from '@wireflow/runtime';

export function Profil({ arzt }: Props) {
  return (
    <Page data-wf="root" padding="space.4" gap="space.3">
      <AppBar data-wf="ab" title="Termin wählen" onBack={flow.back} />
      <Card data-wf="card" title={arzt.name} subtitle={\`\${arzt.fach} · \${arzt.ort}\`}
        media={<Avatar initials={arzt.kuerzel} />} />
      {/* Kommentar bleibt */}
      <Button data-wf="btn" variant="primary" onPress={flow.trigger('btn')}>Weiter</Button>
    </Page>
  );
}
`;

test('Ausdrücke mit Strings, Templates und Klammern', () => {
  const s = "{a ? '}' : `x${ {b:1}.b }y`}rest";
  assert.equal(s.slice(scanExpr(s, 0)), 'rest');
});

test('parsen und unverändert wieder ausgeben (Rundreise)', () => {
  const mod = parseModule(SRC);
  assert.equal(mod.name, 'Profil');
  assert.equal(mod.root.name, 'Page');
  const out = printModule(mod);
  const again = printModule(parseModule(out));
  assert.equal(again, out, 'Ausgabe ist stabil');
  assert.match(out, /subtitle=\{`\$\{arzt\.fach\} · \$\{arzt\.ort\}`\}/);
  assert.match(out, /\{\/\* Kommentar bleibt \*\/\}/);
  assert.match(out, /<Button data-wf="btn" variant="primary" onPress=\{flow\.trigger\('btn'\)\}>Weiter<\/Button>/);
});

test('einfügen, Props setzen, Text, verschieben, entfernen, Import-Abgleich', () => {
  const mod = parseModule(SRC);
  const el = makeEl('Alert', { tone: 'info', title: 'Hinweis' }, 'Kurz erklärt');
  insertEl(mod.root, 1, el);
  ensureIds(mod.root);
  const id = getAttr(el, 'data-wf');
  assert.equal(id, 'alert_1');
  setProp(findById(mod.root, 'btn').node, 'variant', 'secondary');
  setText(findById(mod.root, 'btn').node, 'Später');
  assert.ok(moveEl(mod.root, 'btn', null, 0));
  const out = printModule(mod, { pkg: '@acme/ui', known: new Set(['Page', 'AppBar', 'Card', 'Avatar', 'Button', 'Alert']) });
  assert.match(out, /import \{ Page, AppBar, Card, Avatar, Button, Alert \} from '@acme\/ui';/);
  const kids = parseModule(out).root.children.filter(c => c.type === 'el').map(c => getAttr(c, 'data-wf'));
  assert.deepEqual(kids, ['btn', 'ab', 'alert_1', 'card']);
  assert.match(out, /variant="secondary"[^>]*>Später<\/Button>/);
  removeEl(mod.root, 'alert_1');
  const out2 = printModule(mod, { pkg: '@acme/ui', known: new Set(['Page', 'AppBar', 'Card', 'Avatar', 'Button', 'Alert']) });
  assert.doesNotMatch(out2, /Alert/);
});

test('Fehlermeldungen nennen die Zeile', () => {
  assert.throws(() => parseModule('export function X() {\n  return (\n    <Page>\n      <Button>\n    </Page>\n  );\n}'), /Zeile/);
});
